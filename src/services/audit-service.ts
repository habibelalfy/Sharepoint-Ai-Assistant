/**
 * Audit logging: writes AI actions, data access, and security events to the
 * `AI_AuditLog` SharePoint list and supports querying them back.
 *
 * @module services/audit-service
 */
import { LIST_NAMES } from '../constants';
import { AUDIT_LOG_FIELDS, mapItem } from '../mappers/sharepoint-mapper';
import type { SharePointClient } from '../sharepoint/client';
import { redactSecrets } from './log-redaction';

export type DataAccessAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';

export type SecurityEventType =
  'PERMISSION_DENIED' | 'UNAUTHORIZED_ACCESS' | 'SUSPICIOUS_ACTIVITY' | 'AUTH_FAILURE';

export interface AIActionEntry {
  toolName: string;
  parameters: Record<string, unknown>;
  userId?: string;
  timestamp: string;
  result?: unknown;
  durationMs?: number;
}

export interface DataAccessEntry {
  listName: string;
  itemId?: number;
  action: DataAccessAction;
  userId?: string;
  timestamp: string;
}

export interface SecurityEventEntry {
  eventType: SecurityEventType;
  userId?: string;
  details: string;
  timestamp: string;
}

export interface AuditLogFilters {
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface AuditService {
  logAIAction(entry: AIActionEntry): Promise<void>;
  logDataAccess(entry: DataAccessEntry): Promise<void>;
  logSecurityEvent(entry: SecurityEventEntry): Promise<void>;
  getAuditLogs(filters?: AuditLogFilters): Promise<unknown[]>;
}

/** Persists audit entries to the `AI_AuditLog` list (Phase 5 implementation). */
export class SharePointAuditService implements AuditService {
  public constructor(
    private readonly client: SharePointClient,
    private readonly ipAddress: string = '',
  ) {}

  public async logAIAction(entry: AIActionEntry): Promise<void> {
    await this.write({
      title: entry.toolName,
      toolName: entry.toolName,
      action: 'AI_ACTION',
      parameters: entry.parameters,
      userId: entry.userId,
      timestamp: entry.timestamp,
      durationMs: entry.durationMs,
      result: entry.result,
    });
  }

  public async logDataAccess(entry: DataAccessEntry): Promise<void> {
    await this.write({
      title: entry.listName,
      toolName: '',
      action: `DATA_${entry.action}`,
      parameters: { listName: entry.listName, itemId: entry.itemId },
      userId: entry.userId,
      timestamp: entry.timestamp,
    });
  }

  public async logSecurityEvent(entry: SecurityEventEntry): Promise<void> {
    await this.write({
      title: entry.eventType,
      toolName: '',
      action: 'SECURITY',
      parameters: { details: entry.details },
      userId: entry.userId,
      timestamp: entry.timestamp,
    });
  }

  public async getAuditLogs(filters: AuditLogFilters = {}): Promise<unknown[]> {
    const clauses: string[] = [];
    if (filters.userId) {
      clauses.push(`UserId eq '${escapeOData(filters.userId)}'`);
    }
    if (filters.action) {
      clauses.push(`Action eq '${escapeOData(filters.action)}'`);
    }
    if (filters.from) {
      clauses.push(`Timestamp ge datetime'${filters.from}'`);
    }
    if (filters.to) {
      clauses.push(`Timestamp le datetime'${filters.to}'`);
    }
    const rows = await this.client.queryList(LIST_NAMES.AI_AUDIT_LOG, {
      filter: clauses.length > 0 ? clauses.join(' and ') : undefined,
    });
    return rows.map((row) => mapItem(row, AUDIT_LOG_FIELDS));
  }

  private async write(input: {
    title: string;
    toolName: string;
    action: string;
    parameters: Record<string, unknown>;
    userId?: string;
    timestamp: string;
    durationMs?: number;
    result?: unknown;
  }): Promise<void> {
    await this.client.createItem(LIST_NAMES.AI_AUDIT_LOG, {
      Title: input.title,
      ToolName: input.toolName,
      Action: input.action,
      Parameters: JSON.stringify(redactSecrets(input.parameters)),
      UserId: input.userId ?? '',
      Timestamp: input.timestamp,
      Duration: input.durationMs ?? 0,
      Result: input.result !== undefined ? JSON.stringify(redactSecrets(input.result)) : '',
      IPAddress: this.ipAddress,
    });
  }
}

/** No-op audit service for tests and non-audited environments. */
export class NoopAuditService implements AuditService {
  public async logAIAction(entry: AIActionEntry): Promise<void> {
    void entry;
  }
  public async logDataAccess(entry: DataAccessEntry): Promise<void> {
    void entry;
  }
  public async logSecurityEvent(entry: SecurityEventEntry): Promise<void> {
    void entry;
  }
  public async getAuditLogs(filters?: AuditLogFilters): Promise<unknown[]> {
    void filters;
    return [];
  }
}

function escapeOData(value: string): string {
  return value.replace(/'/g, "''");
}
