import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SharePointAuditService } from '../../src/services/audit-service';
import { mockSharePointClient } from '../helpers';

describe('SharePointAuditService', () => {
  let client: ReturnType<typeof mockSharePointClient>;
  let audit: SharePointAuditService;

  beforeEach(() => {
    client = mockSharePointClient();
    audit = new SharePointAuditService(client, '10.0.0.1');
  });

  it('logAIAction writes a redacted AI_AuditLog row', async () => {
    jest.mocked(client.createItem).mockResolvedValue({ Id: 1 });
    await audit.logAIAction({
      toolName: 'query_project_data',
      parameters: { listName: 'Projects', password: 'hunter2' },
      userId: 'alice',
      timestamp: '2024-01-01T00:00:00.000Z',
      durationMs: 12,
      result: { id: 1 },
    });

    const createItem = jest.mocked(client.createItem);
    expect(createItem).toHaveBeenCalledWith(
      'AI_AuditLog',
      expect.objectContaining({
        Title: 'query_project_data',
        ToolName: 'query_project_data',
        Action: 'AI_ACTION',
        UserId: 'alice',
        Duration: 12,
        IPAddress: '10.0.0.1',
      }),
    );
    const row = createItem.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(row.Parameters).toContain('[REDACTED]');
    expect(row.Parameters).not.toContain('hunter2');
  });

  it('getAuditLogs builds a filter and maps rows', async () => {
    jest.mocked(client.queryList).mockResolvedValue([{ Id: 1, Title: 'x', Action: 'AI_ACTION' }]);
    const logs = await audit.getAuditLogs({ userId: 'alice', action: 'AI_ACTION' });
    expect(client.queryList).toHaveBeenCalledWith('AI_AuditLog', {
      filter: "UserId eq 'alice' and Action eq 'AI_ACTION'",
    });
    expect(logs).toEqual([expect.objectContaining({ id: 1 })]);
  });

  it('logSecurityEvent writes a SECURITY row', async () => {
    jest.mocked(client.createItem).mockResolvedValue({ Id: 1 });
    await audit.logSecurityEvent({
      eventType: 'AUTH_FAILURE',
      userId: 'alice',
      details: 'bad credentials',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    expect(client.createItem).toHaveBeenCalledWith(
      'AI_AuditLog',
      expect.objectContaining({ Title: 'AUTH_FAILURE', Action: 'SECURITY' }),
    );
  });
});
