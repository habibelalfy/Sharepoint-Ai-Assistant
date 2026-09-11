/**
 * Environment-driven application configuration.
 *
 * Loads `.env` (when present) via dotenv, then assembles a typed config object
 * and validates required variables. `loadConfig` fails fast with a
 * {@link ConfigError} if anything required is missing or malformed.
 *
 * @module config
 */
import { config as loadEnv } from 'dotenv';
import { DEFAULT_EMBEDDING_DIMENSIONS, SERVICE_NAME, SERVICE_VERSION } from './constants';
import { ConfigError } from './errors';

// Load .env into process.env if it exists; never throw when absent (production
// environments inject variables directly). `quiet` suppresses dotenv's tip.
loadEnv({ quiet: true });

/** Supported SharePoint authentication modes. */
export type AuthMode = 'ntlm' | 'kerberos';

/** Connection details for the on-premises SharePoint REST API. */
export interface SharePointConnectionConfig {
  siteUrl: string;
  username: string;
  password: string;
  domain: string;
  authMode: AuthMode;
}

/** Scheduled alert cron expressions. */
export interface AlertScheduleConfig {
  overdue: string;
  milestones: string;
  healthCheck: string;
}

/** Optional SMTP settings for alert delivery (see {@link SmtpEmailSender}). */
export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
}

/** RAG (retrieval-augmented generation) subsystem configuration. */
export interface RagConfig {
  /** True when both the pgvector and embedding services are configured. */
  enabled: boolean;
  /** Cron expression for the document indexer (`RAG_INDEX_SCHEDULE`). */
  schedule: string;
  /** Chunk size in characters (`RAG_CHUNK_SIZE`). */
  chunkSize: number;
  /** Chunk overlap in characters (`RAG_CHUNK_OVERLAP`). */
  chunkOverlap: number;
  /** Self-hosted embedding server base URL (`EMBEDDING_API_BASE_URL`). */
  embeddingApiBaseUrl: string;
  /** API-key placeholder for the embedding server (`EMBEDDING_API_KEY`). */
  embeddingApiKey: string;
  /** Embedding model name served by the TEI container (`EMBEDDING_MODEL_NAME`). */
  embeddingModelName: string;
  /** Expected embedding vector width (`EMBEDDING_DIMENSIONS`). */
  embeddingDimensions: number;
  /** PostgreSQL/pgvector connection string (`PGVECTOR_CONNECTION_STRING`). */
  pgvectorConnectionString: string;
}

/** Default cron schedules when env vars are absent (see `.env.example`). */
const DEFAULT_ALERT_SCHEDULES: AlertScheduleConfig = {
  overdue: '0 9 * * *',
  milestones: '0 10 * * *',
  healthCheck: '0 8 * * 1',
};

/** Default RAG tunables when env vars are absent (see `.env.example`). */
const DEFAULT_RAG_SCHEDULE = '0 2 * * *';
const DEFAULT_RAG_CHUNK_SIZE = 1000;
const DEFAULT_RAG_CHUNK_OVERLAP = 200;
const DEFAULT_EMBEDDING_MODEL_NAME = 'bge-large-en-v1.5';
const DEFAULT_EMBEDDING_API_KEY = 'not-needed';

/** Fully-assembled application configuration. */
export interface AppConfig {
  serviceName: string;
  serviceVersion: string;
  logLevel: string;
  sharepoint: SharePointConnectionConfig;
  alertSchedules: AlertScheduleConfig;
  /** Email recipients for scheduled alerts (comma-separated `ALERT_RECIPIENTS`). */
  alertRecipients: string[];
  /** Present when `SMTP_HOST` is configured; otherwise alerts log to console. */
  smtp?: SmtpConfig;
  /** RAG document-search configuration (additive subsystem, Phase 8). */
  rag: RagConfig;
}

/** Returns a trimmed value or throws if the variable is missing/empty. */
function requireString(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (value === undefined || value.trim() === '') {
    throw new ConfigError(`Missing required environment variable: ${key}`);
  }
  return value;
}

/** Splits a comma-separated env value into a trimmed, non-empty list. */
function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Parses a positive-integer env value, falling back to `fallback` when absent. */
function parsePositiveInt(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ConfigError(`Invalid ${key}: "${raw}" (expected a positive integer)`);
  }
  return parsed;
}

/**
 * Builds and validates the application config from an environment object.
 *
 * @param env - Environment to read from (defaults to `process.env`).
 * @returns The validated {@link AppConfig}.
 * @throws {ConfigError} If a required variable is missing or invalid.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const siteUrl = requireString(env, 'SHAREPOINT_SITE_URL');
  const username = requireString(env, 'SHAREPOINT_USERNAME');
  const password = requireString(env, 'SHAREPOINT_PASSWORD');
  const domain = requireString(env, 'SHAREPOINT_DOMAIN');

  const rawAuthMode = (env.SHAREPOINT_AUTH_MODE ?? 'kerberos').toLowerCase();
  if (rawAuthMode !== 'ntlm' && rawAuthMode !== 'kerberos') {
    throw new ConfigError(
      `Invalid SHAREPOINT_AUTH_MODE: "${rawAuthMode}" (expected "ntlm" or "kerberos")`,
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(siteUrl);
  } catch {
    throw new ConfigError(
      `Invalid SHAREPOINT_SITE_URL: "${siteUrl}" (must be a valid absolute URL)`,
    );
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ConfigError(
      `Invalid SHAREPOINT_SITE_URL protocol "${parsedUrl.protocol}" (expected http or https)`,
    );
  }

  const alertRecipients = parseList(env.ALERT_RECIPIENTS);

  let smtp: SmtpConfig | undefined;
  if (env.SMTP_HOST) {
    const port = env.SMTP_PORT ? Number(env.SMTP_PORT) : 25;
    smtp = {
      host: env.SMTP_HOST,
      port,
      from: requireString(env, 'SMTP_FROM'),
    };
  }

  // RAG is an additive, optional subsystem. It is enabled only when both the
  // self-hosted embedding server and the pgvector store are configured; setting
  // exactly one of the two is a misconfiguration.
  const embeddingApiBaseUrl = (env.EMBEDDING_API_BASE_URL ?? '').trim();
  const pgvectorConnectionString = (env.PGVECTOR_CONNECTION_STRING ?? '').trim();
  const hasEmbedding = embeddingApiBaseUrl.length > 0;
  const hasVectorStore = pgvectorConnectionString.length > 0;
  if (hasEmbedding !== hasVectorStore) {
    throw new ConfigError(
      'RAG requires both EMBEDDING_API_BASE_URL and PGVECTOR_CONNECTION_STRING (set both, or neither to disable document search)',
    );
  }

  const chunkSize = parsePositiveInt(env, 'RAG_CHUNK_SIZE', DEFAULT_RAG_CHUNK_SIZE);
  const chunkOverlap = parsePositiveInt(env, 'RAG_CHUNK_OVERLAP', DEFAULT_RAG_CHUNK_OVERLAP);
  if (chunkOverlap >= chunkSize) {
    throw new ConfigError(
      `Invalid RAG_CHUNK_OVERLAP "${chunkOverlap}": must be less than RAG_CHUNK_SIZE (${chunkSize})`,
    );
  }

  const rag: RagConfig = {
    enabled: hasEmbedding && hasVectorStore,
    schedule: env.RAG_INDEX_SCHEDULE ?? DEFAULT_RAG_SCHEDULE,
    chunkSize,
    chunkOverlap,
    embeddingApiBaseUrl,
    embeddingApiKey: env.EMBEDDING_API_KEY ?? DEFAULT_EMBEDDING_API_KEY,
    embeddingModelName: env.EMBEDDING_MODEL_NAME ?? DEFAULT_EMBEDDING_MODEL_NAME,
    embeddingDimensions: parsePositiveInt(
      env,
      'EMBEDDING_DIMENSIONS',
      DEFAULT_EMBEDDING_DIMENSIONS,
    ),
    pgvectorConnectionString,
  };

  return {
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    logLevel: env.LOG_LEVEL ?? 'info',
    sharepoint: {
      siteUrl,
      username,
      password,
      domain,
      authMode: rawAuthMode as AuthMode,
    },
    alertSchedules: {
      overdue: env.ALERT_SCHEDULE_OVERDUE ?? DEFAULT_ALERT_SCHEDULES.overdue,
      milestones: env.ALERT_SCHEDULE_MILESTONES ?? DEFAULT_ALERT_SCHEDULES.milestones,
      healthCheck: env.ALERT_SCHEDULE_HEALTHCHECK ?? DEFAULT_ALERT_SCHEDULES.healthCheck,
    },
    alertRecipients,
    smtp,
    rag,
  };
}
