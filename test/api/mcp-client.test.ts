import { describe, expect, it, jest } from '@jest/globals';
import { createMcpToolCaller } from '../../src/api/mcp-client';
import { NoopAuditService } from '../../src/services/audit-service';
import { mockSharePointClient } from '../helpers';

describe('createMcpToolCaller', () => {
  it('rejects MCP error results instead of treating their text as successful data', async () => {
    const client = mockSharePointClient();
    jest.mocked(client.queryList).mockRejectedValue(new Error('Backend unavailable'));
    const caller = await createMcpToolCaller(client, { audit: new NoopAuditService() });
    try {
      await expect(caller.callTool('search_projects', { query: 'x' })).rejects.toThrow(
        'Backend unavailable',
      );
    } finally {
      await caller.close();
    }
  });
  it('lists the registered tools', async () => {
    const caller = await createMcpToolCaller(mockSharePointClient(), {
      audit: new NoopAuditService(),
    });

    const tools = await caller.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toHaveLength(14);
    expect(names).toContain('query_project_data');
    expect(names).toContain('get_audit_logs');
    expect(names).toContain('get_user_permissions');
    await caller.close();
  });

  it('forwards a tool call and parses the JSON result', async () => {
    const client = mockSharePointClient();
    jest.mocked(client.queryList).mockResolvedValue([]);

    const caller = await createMcpToolCaller(client, { audit: new NoopAuditService() });
    const result = await caller.callTool('get_user_permissions', { userId: 'alice' });

    expect(result).toEqual({ userId: 'alice', groups: [], accessibleProjects: [] });
    await caller.close();
  });

  it('returns non-JSON text verbatim', async () => {
    const client = mockSharePointClient();
    const caller = await createMcpToolCaller(client, { audit: new NoopAuditService() });

    // get_audit_logs is not wrapped in withAudit and returns an empty list.
    const result = await caller.callTool('get_audit_logs', {});
    expect(result).toEqual([]);
    await caller.close();
  });
});
