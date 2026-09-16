import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AIActionEntry,
  AuditLogFilters,
  AuditService,
  DataAccessEntry,
  SecurityEventEntry,
} from './audit-service';
import { redactSecrets } from './log-redaction';

/** Durable local audit storage for installations without custom SharePoint lists. */
export class FileAuditService implements AuditService {
  public constructor(private readonly path: string) {}
  private async write(action: string, entry: object): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await appendFile(this.path, JSON.stringify(redactSecrets({ ...entry, action })) + '\n', {
      mode: 0o600,
    });
  }
  public logAIAction(entry: AIActionEntry): Promise<void> {
    return this.write('AI_ACTION', entry);
  }
  public logDataAccess(entry: DataAccessEntry): Promise<void> {
    return this.write(`DATA_${entry.action}`, entry);
  }
  public logSecurityEvent(entry: SecurityEventEntry): Promise<void> {
    return this.write('SECURITY', entry);
  }
  public async getAuditLogs(filters: AuditLogFilters = {}): Promise<unknown[]> {
    let contents: string;
    try {
      contents = await readFile(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return contents
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter(
        (row) =>
          (!filters.userId || row.userId === filters.userId) &&
          (!filters.action || row.action === filters.action) &&
          (!filters.from || String(row.timestamp) >= filters.from) &&
          (!filters.to || String(row.timestamp) <= filters.to),
      )
      .slice(-500);
  }
}
