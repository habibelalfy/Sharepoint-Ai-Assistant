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
import { loadConfig } from '../config';
import { createLogger } from '../logging';
import { SharePointAuditService, type AuditService } from '../services/audit-service';
import { SharePointClient } from '../sharepoint/client';
import { bootstrapBackgroundServices } from '../runtime';
import { ChatAgent } from '../llm/agent';
import { OpenAiCompatibleLLMProvider } from '../llm/provider';
import { mountChatRoutes } from './chat-routes';
import { createMcpToolCaller } from './mcp-client';
import { SlidingWindowRateLimiter } from './rate-limiter';

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
}

/** Builds the Express app (auth → rate limit → forward → audit). */
export function createGateway(options: GatewayOptions): express.Express {
  const app = express();
  app.use(express.json());

  // Health-check endpoint for monitoring/load balancers (no auth required).
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  });

  app.post('/api/mcp/tool', async (req, res) => {
    const identity = options.authenticate(req);
    if (!identity) {
      await options.audit.logSecurityEvent({
        eventType: 'AUTH_FAILURE',
        details: 'missing or invalid bearer token',
        timestamp: new Date().toISOString(),
      });
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
  const client = await SharePointClient.connect(config.sharepoint);
  const audit = new SharePointAuditService(client);

  // Start the same background services (scheduled alerts + RAG) as the stdio
  // server, and wire retrieval into the in-process MCP server so the
  // `search_documents` tool works through the gateway.
  const { permissions, retrieval } = await bootstrapBackgroundServices(client, config, logger);
  const caller = await createMcpToolCaller(client, { audit, permissions, retrieval });

  const secret = process.env.JWT_SIGNING_KEY ?? 'changeme';
  const authenticate = createBearerAuthenticator(createHmacTokenVerifier(secret));
  const rateLimiter = new SlidingWindowRateLimiter(120, 60_000);

  const app = createGateway({ callTool: caller.callTool, authenticate, rateLimiter, audit });

  // Chat endpoint + UI (optional, when an OpenAI-compatible LLM is configured).
  if (config.llm.enabled) {
    const provider = new OpenAiCompatibleLLMProvider({
      baseUrl: config.llm.baseUrl,
      apiKey: config.llm.apiKey,
      model: config.llm.model,
      temperature: config.llm.temperature,
    });
    const agent = new ChatAgent(provider, caller, { maxSteps: config.llm.maxSteps });
    mountChatRoutes(app, { agent, authenticate, rateLimiter });
    logger.info({ event: 'chat_enabled', model: config.llm.model }, 'LLM chat endpoint enabled');
  }

  const port = Number(process.env.HTTP_GATEWAY_PORT ?? 3001);
  app.listen(port, () => {
    logger.info({ event: 'gateway_started', port }, 'HTTP gateway started');
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
