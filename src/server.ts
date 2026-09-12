/**
 * MCP server bootstrap.
 *
 * Creates the MCP server over stdio transport and registers the assistant's
 * tools. `registerTool` (the SDK's non-deprecated API) registers the underlying
 * `tools/list` and `tools/call` request handlers and validates input against the
 * zod schemas automatically.
 *
 * Tool handlers receive the shared {@link SharePointClient} via closure so the
 * auth/transport layer stays decoupled from business logic.
 *
 * @module server
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './config';
import { SERVICE_NAME, SERVICE_VERSION } from './constants';
import { createLogger } from './logging';
import {
  SharePointAuditService,
  type AIActionEntry,
  type AuditService,
} from './services/audit-service';
import { PermissionService } from './services/permission-service';
import { SharePointClient } from './sharepoint/client';
import {
  createGetMilestonesByProjectHandler,
  getMilestonesByProjectSchema,
} from './tools/milestone-tools';
import {
  createGetProjectByIdHandler,
  createQueryProjectDataHandler,
  createSearchProjectsHandler,
  getProjectByIdSchema,
  queryProjectDataSchema,
  searchProjectsSchema,
} from './tools/project-tools';
import { createGetTasksByProjectHandler, getTasksByProjectSchema } from './tools/task-tools';
import {
  analyzeMilestoneDelaySchema,
  checkPlanHealthSchema,
  createAnalyzeMilestoneDelayHandler,
  createCheckPlanHealthHandler,
  createGetProjectStatisticsHandler,
  getProjectStatisticsSchema,
} from './tools/analytics-tools';
import {
  createCreateEscalationHandler,
  createEscalationSchema,
  createGetEscalationsByProjectHandler,
  createUpdateEscalationHandler,
  getEscalationsByProjectSchema,
  updateEscalationSchema,
} from './tools/escalation-tools';
import {
  createGetAuditLogsHandler,
  createGetUserPermissionsHandler,
  getAuditLogsSchema,
  getUserPermissionsSchema,
} from './tools/security-tools';
import { bootstrapBackgroundServices } from './runtime';
import type { RetrievalService } from './rag/retrieval-service';
import { createSearchDocumentsHandler, searchDocumentsSchema } from './tools/document-tools';

type ToolHandler<Args> = (args: Args) => CallToolResult | Promise<CallToolResult>;

/** Wraps a read handler so every call is recorded to the audit log. */
function withAudit<Args extends { userId?: string }>(
  handler: ToolHandler<Args>,
  audit: AuditService,
  toolName: string,
): (args: Args) => Promise<CallToolResult> {
  return async (args) => {
    const started = Date.now();
    try {
      const result = await handler(args);
      await auditSafely(audit, {
        toolName,
        parameters: args as unknown as Record<string, unknown>,
        userId: args.userId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        result: { isError: false, contentLength: result.content.length },
      });
      return result;
    } catch (error) {
      await auditSafely(audit, {
        toolName,
        parameters: args as unknown as Record<string, unknown>,
        userId: args.userId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        result: { isError: true, error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  };
}

/** Best-effort audit write — auditing must never break a tool call. */
async function auditSafely(audit: AuditService, entry: AIActionEntry): Promise<void> {
  try {
    await audit.logAIAction(entry);
  } catch {
    // Intentionally swallowed.
  }
}

/** Injectable server dependencies (overridden in tests). */
export interface ServerOptions {
  audit?: AuditService;
  permissions?: PermissionService;
  retrieval?: RetrievalService;
}

/**
 * Creates and configures the MCP server (without connecting a transport).
 *
 * @param client - The SharePoint client used by every data-access tool.
 * @param name - Server name reported during MCP initialization.
 * @param version - Server version reported during MCP initialization.
 * @param options - Optional audit/permission overrides for tests.
 * @returns A configured {@link McpServer}.
 */
export function createServer(
  client: SharePointClient,
  name: string = SERVICE_NAME,
  version: string = SERVICE_VERSION,
  options: ServerOptions = {},
): McpServer {
  const server = new McpServer({ name, version });
  const audit = options.audit ?? new SharePointAuditService(client);
  const permissions = options.permissions ?? new PermissionService(undefined, client);

  server.registerTool(
    'query_project_data',
    {
      description: 'Query SharePoint list items from Projects, Tasks, or Milestones.',
      inputSchema: queryProjectDataSchema,
    },
    withAudit(createQueryProjectDataHandler(client, permissions), audit, 'query_project_data'),
  );

  server.registerTool(
    'get_project_by_id',
    {
      description: 'Fetch a single project and its related tasks and milestones.',
      inputSchema: getProjectByIdSchema,
    },
    withAudit(createGetProjectByIdHandler(client, permissions), audit, 'get_project_by_id'),
  );

  server.registerTool(
    'get_tasks_by_project',
    {
      description: 'List tasks for a project, optionally filtered by status.',
      inputSchema: getTasksByProjectSchema,
    },
    withAudit(createGetTasksByProjectHandler(client, permissions), audit, 'get_tasks_by_project'),
  );

  server.registerTool(
    'get_milestones_by_project',
    {
      description: 'List milestones for a project, sorted by due date ascending.',
      inputSchema: getMilestonesByProjectSchema,
    },
    withAudit(
      createGetMilestonesByProjectHandler(client, permissions),
      audit,
      'get_milestones_by_project',
    ),
  );

  server.registerTool(
    'search_projects',
    {
      description: 'Search projects by title or description using a substring match.',
      inputSchema: searchProjectsSchema,
    },
    withAudit(createSearchProjectsHandler(client, permissions), audit, 'search_projects'),
  );

  server.registerTool(
    'check_plan_health',
    {
      description:
        'Assess project health (score, status, issues) from tasks, milestones, and budget.',
      inputSchema: checkPlanHealthSchema,
    },
    withAudit(createCheckPlanHealthHandler(client), audit, 'check_plan_health'),
  );

  server.registerTool(
    'analyze_milestone_delay',
    {
      description: 'Analyze the cascading impact of delaying a milestone by a number of days.',
      inputSchema: analyzeMilestoneDelaySchema,
    },
    withAudit(createAnalyzeMilestoneDelayHandler(client), audit, 'analyze_milestone_delay'),
  );

  server.registerTool(
    'get_project_statistics',
    {
      description: 'Return progress statistics and estimated completion for a project.',
      inputSchema: getProjectStatisticsSchema,
    },
    withAudit(createGetProjectStatisticsHandler(client), audit, 'get_project_statistics'),
  );

  server.registerTool(
    'create_escalation',
    {
      description: 'Open a new escalation against a project.',
      inputSchema: createEscalationSchema,
    },
    createCreateEscalationHandler(client, { audit }),
  );

  server.registerTool(
    'update_escalation',
    {
      description: 'Update an escalation (project and creator are immutable).',
      inputSchema: updateEscalationSchema,
    },
    createUpdateEscalationHandler(client, { audit }),
  );

  server.registerTool(
    'get_escalations_by_project',
    {
      description: 'List escalations for a project, optionally filtered by status.',
      inputSchema: getEscalationsByProjectSchema,
    },
    withAudit(
      createGetEscalationsByProjectHandler(client, permissions),
      audit,
      'get_escalations_by_project',
    ),
  );

  server.registerTool(
    'get_audit_logs',
    {
      description: 'Query the AI audit log with optional filters.',
      inputSchema: getAuditLogsSchema,
    },
    createGetAuditLogsHandler(audit),
  );

  server.registerTool(
    'get_user_permissions',
    {
      description: 'Inspect a user\u2019s AD groups and the projects they can access.',
      inputSchema: getUserPermissionsSchema,
    },
    withAudit(createGetUserPermissionsHandler(permissions, client), audit, 'get_user_permissions'),
  );

  server.registerTool(
    'search_documents',
    {
      description:
        'Semantic search over SharePoint document libraries (RAG) with citations and permission filtering.',
      inputSchema: searchDocumentsSchema,
    },
    withAudit(
      createSearchDocumentsHandler(options.retrieval, { audit }),
      audit,
      'search_documents',
    ),
  );

  return server;
}

/**
 * Starts the MCP server over stdio, with structured startup/shutdown logging
 * and graceful shutdown on SIGINT/SIGTERM.
 */
export async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel, config.serviceName);

  const client = await SharePointClient.connect(config.sharepoint);
  const { permissions, retrieval } = await bootstrapBackgroundServices(client, config, logger);

  const server = createServer(client, config.serviceName, config.serviceVersion, {
    permissions,
    retrieval,
  });
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logger.info({ event: 'server_started', version: config.serviceVersion }, 'MCP server started');

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ event: 'shutdown_initiated', signal }, 'Shutting down');
    void server
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error({ error }, 'Error during shutdown');
        process.exit(1);
      });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Run the server only when executed directly (not when imported by tests).
if (require.main === module) {
  main().catch((error: unknown) => {
    // Config may have failed before logging was available; fall back to stderr.
    console.error(error);
    process.exit(1);
  });
}
