/**
 * Shared compile-time constants.
 *
 * Kept dependency-free so they can be imported from anywhere (including the MCP
 * server bootstrap) without triggering configuration loading.
 *
 * @module constants
 */

/** Human-readable service name, used in logs and MCP server metadata. */
export const SERVICE_NAME = 'sharepoint-ai-assistant';

/** Service version, kept in sync with `package.json`. */
export const SERVICE_VERSION = '0.1.0';

/**
 * Canonical SharePoint list titles the assistant depends on.
 */
export const LIST_NAMES = {
  PROJECTS: 'Projects',
  TASKS: 'Tasks',
  MILESTONES: 'Milestones',
  ESCALATIONS: 'Escalations',
  ALERTS: 'Alerts',
  AI_AUDIT_LOG: 'AI_AuditLog',
} as const;

/** Union of the known list titles. */
export type ListName = (typeof LIST_NAMES)[keyof typeof LIST_NAMES];

/** Lists the generic `query_project_data` tool may read (write/audit lists excluded). */
export const QUERYABLE_LIST_NAMES = {
  PROJECTS: LIST_NAMES.PROJECTS,
  TASKS: LIST_NAMES.TASKS,
  MILESTONES: LIST_NAMES.MILESTONES,
} as const;

/** Union of the list titles the generic query tool accepts. */
export type QueryableListName = (typeof QUERYABLE_LIST_NAMES)[keyof typeof QUERYABLE_LIST_NAMES];

/** Valid escalation priorities (lowest → highest). */
export const ESCALATION_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'] as const;

/** Valid escalation statuses. */
export const ESCALATION_STATUSES = ['Open', 'In Progress', 'Resolved', 'Closed'] as const;

/** Status assigned to a newly created escalation. */
export const DEFAULT_ESCALATION_STATUS = 'Open';

/**
 * Default pgvector/embedding vector width. BAAI/bge-large-en-v1.5 (the default
 * embedding model) produces 1024-dimension vectors; the pgvector schema and the
 * embedding startup check both reference this value (see `src/rag/`).
 */
export const DEFAULT_EMBEDDING_DIMENSIONS = 1024;
