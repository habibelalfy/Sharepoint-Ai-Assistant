import { describe, expect, it } from '@jest/globals';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileAuditService } from '../../src/services/file-audit-service';

describe('FileAuditService', () => {
  it('persists redacted records and isolates caller queries across instances', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'audit-test-'));
    try {
      const path = join(directory, 'audit.jsonl');
      const audit = new FileAuditService(path);
      expect(await audit.getAuditLogs()).toEqual([]);
      await audit.logAIAction({
        toolName: 'search_projects',
        parameters: { password: 'private-value' },
        userId: 'alice',
        timestamp: '2026-09-12T00:00:00Z',
      });
      await audit.logSecurityEvent({
        eventType: 'AUTH_FAILURE',
        userId: 'bob',
        details: 'invalid token',
        timestamp: '2026-09-12T00:00:01Z',
      });
      const rows = await new FileAuditService(path).getAuditLogs({ userId: 'alice' });
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain('private-value');
      expect(rows[0]).toMatchObject({ toolName: 'search_projects', userId: 'alice' });
      await audit.logDataAccess({ listName: 'Projects', action: 'READ', userId: 'bob', timestamp: '2026-09-12T00:00:02Z' });
      expect(await audit.getAuditLogs({ action: 'DATA_READ' })).toEqual([expect.objectContaining({ action: 'DATA_READ', userId: 'bob' })]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
