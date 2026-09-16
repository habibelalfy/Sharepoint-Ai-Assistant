/**
 * Middle-tier HTTP gateway (Phase 6).
 *
 * Exposes `POST /api/mcp/tool { toolName, args }` to the SPFx web part:
 * authenticates the caller, applies rate limiting, forwards to the MCP server,
 * and audits every request.
 *
 * @module api/mcp-http-server
 */
import { createHmac } from 'node:crypto';
import express, { type Request } from 'express';
import { loadConfig, type AppConfig, type SharePointConnectionConfig } from '../config';
import { createLogger } from '../logging';
import { SharePointAuditService, type AuditService } from '../services/audit-service';
import { SharePointClient } from '../sharepoint/client';
import { bootstrapBackgroundServices } from '../runtime';
import { ChatAgent } from '../llm/agent';
import { OpenAiCompatibleLLMProvider } from '../llm/provider';
import { mountChatRoutes } from './chat-routes';
import { createMcpToolCaller } from './mcp-client';
import { SlidingWindowRateLimiter } from './rate-limiter';
import { FileAuditService } from '../services/file-audit-service';
import { ProjectServerClient } from '../sharepoint/project-server-client';
import { ProjectWorkspace } from '../sharepoint/project-workspace';
import { SharePointError } from '../errors';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { ProjectAnalytics } from '../analytics/project-analytics';
import { SnapshotStore } from '../analytics/snapshot-store';
import { mountAnalyticsRoutes } from './analytics-routes';

export interface CallerIdentity {
  userId: string;
}

export type Authenticator = (req: Request) => CallerIdentity | null;

export type TokenVerifier = (token: string) => string | null;

export interface GatewayOptions {
  callTool: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  authenticate: Authenticator;
  rateLimiter: SlidingWindowRateLimiter;
  audit: AuditService;
  configure?: (input: ConnectionSetupInput) => Promise<ConnectionSetupResult>;
}

export interface ConnectionSetupInput {
  sharePointUrl: string;
  username: string;
  password: string;
  llmUrl: string;
  llmKey: string;
  modelName: string;
}

export interface ConnectionSetupResult {
  userId: string;
  accessToken: string;
}

/** Builds the Express app (auth → rate limit → forward → audit). */
export function createGateway(options: GatewayOptions): express.Express {
  const app = express();
  app.use(express.json());

  // Health-check endpoint for monitoring/load balancers (no auth required).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.get('/api/session', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const identity = options.authenticate(req);
    if (!identity) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.json({ userId: identity.userId });
  });

  if (options.configure) {
    const configure = options.configure;
    const setupLimiter = new SlidingWindowRateLimiter(5, 60_000);
    app.post('/api/setup', async (req, res) => {
      res.set('Cache-Control', 'no-store');
      if (!setupLimiter.allow(`setup:${req.ip ?? 'unknown'}`)) {
        res.status(429).json({ error: 'Too many connection attempts. Wait one minute and retry.' });
        return;
      }
      const input = parseConnectionSetup(req.body);
      if (!input) {
        res.status(400).json({
          error: 'All connection fields are required and URLs must use HTTP or HTTPS.',
        });
        return;
      }
      try {
        const result = await configure(input);
        res.json(result);
      } catch (error) {
        if (error instanceof SharePointError && error.statusCode === 400) {
          res
            .status(400)
            .json({
              error:
                'SharePoint does not recognize this site URL. Enter the web-application hostname and PWA path configured in SharePoint Alternate Access Mappings.',
            });
          return;
        }
        if (error instanceof SharePointError && error.statusCode >= 500) {
          res.status(503).json({
            error:
              'SharePoint is temporarily unavailable. Retry the connection shortly; your credentials may still be correct.',
          });
          return;
        }
        // Never return upstream errors: they can contain credentials, host details,
        // or LLM-provider response bodies.
        res.status(401).json({ error: 'Connection failed. Check the URLs and credentials.' });
      }
    });
  }

  app.post('/api/mcp/tool', async (req, res) => {
    const identity = options.authenticate(req);
    if (!identity) {
      await options.audit
        .logSecurityEvent({
          eventType: 'AUTH_FAILURE',
          details: 'missing or invalid bearer token',
          timestamp: new Date().toISOString(),
        })
        .catch(() => undefined);
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    if (!options.rateLimiter.allow(identity.userId)) {
      res.status(429).json({ error: 'rate limit exceeded' });
      return;
    }

    const body = (req.body ?? {}) as { toolName?: unknown; args?: unknown };
    if (typeof body.toolName !== 'string') {
      res.status(400).json({ error: 'toolName is required' });
      return;
    }
    if (body.args !== undefined && (typeof body.args !== 'object' || body.args === null)) {
      res.status(400).json({ error: 'args must be an object' });
      return;
    }

    const args = { ...((body.args as Record<string, unknown>) ?? {}), userId: identity.userId };
    try {
      const result = await options.callTool(body.toolName, args);
      res.json({ result });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return app;
}

function parseConnectionSetup(value: unknown): ConnectionSetupInput | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  const keys = ['sharePointUrl', 'username', 'password', 'llmUrl', 'llmKey', 'modelName'] as const;
  if (keys.some((key) => typeof row[key] !== 'string' || String(row[key]).trim() === '')) {
    return null;
  }
  const sharePointUrl = validHttpUrl(String(row.sharePointUrl));
  const llmUrl = validHttpUrl(String(row.llmUrl));
  if (!sharePointUrl || !llmUrl) return null;
  return {
    sharePointUrl,
    username: String(row.username).trim(),
    password: String(row.password),
    llmUrl,
    llmKey: String(row.llmKey),
    modelName: String(row.modelName).trim(),
  };
}

function validHttpUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
      return null;
    }
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** HMAC verifier for JWT-style `header.payload.signature` tokens. */
export function createHmacTokenVerifier(secret: string): TokenVerifier {
  return (token) => {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const [header, payload, signature] = parts as [string, string, string];
    const expected = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    if (expected !== signature) {
      return null;
    }
    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >;
      if (typeof claims.exp === 'number' && claims.exp < Date.now() / 1000) {
        return null;
      }
      return typeof claims.sub === 'string' ? claims.sub : null;
    } catch {
      return null;
    }
  };
}

/** Mints an HMAC-signed token (used by tests and dev tooling). */
export function signHmacToken(secret: string, claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Bearer-token authenticator that returns the token's subject as the userId. */
export function createBearerAuthenticator(verify: TokenVerifier): Authenticator {
  return (req) => {
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) {
      return null;
    }
    const userId = verify(header.slice('Bearer '.length).trim());
    return userId ? { userId } : null;
  };
}

/** Authenticator that trusts a configured header (SharePoint context pass-through). */
export function createHeaderAuthenticator(headerName: string): Authenticator {
  return (req) => {
    const value = req.headers[headerName.toLowerCase()];
    const userId = Array.isArray(value) ? value[0] : value;
    return typeof userId === 'string' && userId.length > 0 ? { userId } : null;
  };
}

/** Production bootstrap: MCP client (in-process) + Express gateway. */
export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, config.serviceName);
  const audit =
    config.dataSource === 'project-server'
      ? new FileAuditService(config.auditLogPath)
      : new SharePointAuditService(await SharePointClient.connect(config.sharepoint));

  let active = await buildGatewayRuntime(config, audit, true);
  const reportingRuntime = active;

  const secret = process.env.JWT_SIGNING_KEY ?? 'changeme';
  const authenticate = createBearerAuthenticator(createHmacTokenVerifier(secret));
  const rateLimiter = new SlidingWindowRateLimiter(120, 60_000);

  const app = createGateway({
    callTool: (name, args) => active.caller.callTool(name, args),
    authenticate,
    rateLimiter,
    audit,
    configure: async (input) => {
      const sharepoint = connectionFromSetup(config.sharepoint, input);
      const nextConfig: AppConfig = {
        ...config,
        sharepoint,
        llm: {
          ...config.llm,
          enabled: true,
          baseUrl: input.llmUrl,
          apiKey: input.llmKey,
          model: input.modelName,
        },
      };
      const next = await buildGatewayRuntime(nextConfig, audit, false);
      try {
        await next.verifySharePoint();
      } catch (error) {
        await next.caller.close().catch(() => undefined);
        throw error;
      }
      const previous = active;
      active = next;
      await previous.caller.close().catch(() => undefined);
      const accessToken = signHmacToken(secret, {
        sub: sharepoint.username,
        exp: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
      });
      logger.info(
        {
          event: 'interactive_connection_configured',
          sharePointHost: new URL(sharepoint.siteUrl).host,
        },
        'Interactive SharePoint and LLM connection configured',
      );
      return { userId: sharepoint.username, accessToken };
    },
  });

  // The route delegates to the current runtime, allowing the setup form to
  // replace both clients without restarting the process.
  mountChatRoutes(app, {
    agent: { chat: (messages, userId) => active.agent.chat(messages, userId) },
    authenticate,
    rateLimiter,
  });
  mountAnalyticsRoutes(app, {
    authenticate,
    rateLimiter,
    dataset: (userId) => active.caller.callTool('get_reporting_dataset', { userId }),
    reportUrl: process.env.POWER_BI_REPORT_URL,
    powerBiToken: process.env.POWER_BI_DATASET_TOKEN,
    powerBiDataset: async () => {
      if (!reportingRuntime.analytics)
        throw new Error('Project Server reporting is not configured.');
      const dataset = await reportingRuntime.analytics.dataset();
      await audit.logAIAction({
        toolName: 'power_bi_dataset_export',
        userId: config.sharepoint.username,
        timestamp: new Date().toISOString(),
        parameters: {},
        result: { isError: false },
      });
      return dataset;
    },
  });
  if (config.dataSource === 'project-server') {
    let collecting = false;
    const collect = async () => {
      if (collecting) return;
      collecting = true;
      try {
        await active.analytics?.dataset();
      } catch {
        logger.warn(
          { event: 'progress_snapshot_failed' },
          'Progress snapshot failed; next hourly collection will retry.',
        );
      } finally {
        collecting = false;
      }
    };
    const timer = setInterval(
      () => {
        void collect();
      },
      60 * 60 * 1000,
    );
    timer.unref();
    void collect();
  }
  logger.info({ event: 'chat_enabled', model: config.llm.model }, 'LLM chat endpoint enabled');

  const port = Number(process.env.HTTP_GATEWAY_PORT ?? 3001);
  app.listen(port, () => {
    logger.info({ event: 'gateway_started', port }, 'HTTP gateway started');
  });
}

interface GatewayRuntime {
  analytics?: ProjectAnalytics;
  caller: Awaited<ReturnType<typeof createMcpToolCaller>>;
  agent: ChatAgent;
  verifySharePoint: () => Promise<void>;
}

async function buildGatewayRuntime(
  config: AppConfig,
  audit: AuditService,
  startBackgroundServices: boolean,
): Promise<GatewayRuntime> {
  const client = await SharePointClient.connect(config.sharepoint);
  const projectServer =
    config.dataSource === 'project-server'
      ? await ProjectServerClient.connect(config.sharepoint)
      : undefined;
  const projectWorkspace =
    config.dataSource === 'project-server'
      ? await ProjectWorkspace.connect(config.sharepoint, {
          users: config.projectPlan.writeUsers,
          projects: config.projectPlan.writeProjects,
        })
      : undefined;
  const background = startBackgroundServices
    ? await bootstrapBackgroundServices(
        client,
        config,
        createLogger(config.logLevel, config.serviceName),
      )
    : { permissions: undefined, retrieval: undefined };
  const analytics = projectServer
    ? new ProjectAnalytics(
        projectServer,
        new SnapshotStore(
          join(
            dirname(config.auditLogPath),
            'progress-' +
              createHash('sha256')
                .update(config.sharepoint.siteUrl.replace(/\/+$/, '').toLowerCase())
                .digest('hex') +
              '.json',
          ),
        ),
      )
    : undefined;
  const caller = await createMcpToolCaller(client, {
    analytics,
    audit,
    permissions: background.permissions,
    retrieval: background.retrieval,
    projectServer,
    projectWorkspace,
  });
  const provider = new OpenAiCompatibleLLMProvider({
    baseUrl: config.llm.baseUrl,
    apiKey: config.llm.apiKey,
    model: config.llm.model,
    temperature: config.llm.temperature,
    maxTokens: config.llm.maxTokens,
  });
  return {
    analytics,
    caller,
    agent: new ChatAgent(provider, caller, { maxSteps: config.llm.maxSteps }),
    verifySharePoint: async () => {
      if (projectServer) await projectServer.projects('', 1);
      else await client.queryList('Projects', { top: 1 });
    },
  };
}

function connectionFromSetup(
  current: SharePointConnectionConfig,
  input: ConnectionSetupInput,
): SharePointConnectionConfig {
  const separator = input.username.indexOf('\\');
  const domain = separator > 0 ? input.username.slice(0, separator) : current.domain;
  const username = separator > 0 ? input.username.slice(separator + 1) : input.username;
  if (!domain || !username) throw new Error('Invalid SharePoint username');
  return {
    siteUrl: input.sharePointUrl,
    username,
    password: input.password,
    domain,
    authMode: 'ntlm',
  };
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
