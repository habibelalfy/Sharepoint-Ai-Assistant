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
import { SERVICE_NAME, SERVICE_VERSION } from './constants';
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

/** Default cron schedules when env vars are absent (see `.env.example`). */
const DEFAULT_ALERT_SCHEDULES: AlertScheduleConfig = {
  overdue: '0 9 * * *',
  milestones: '0 10 * * *',
  healthCheck: '0 8 * * 1',
};

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
  };
}
