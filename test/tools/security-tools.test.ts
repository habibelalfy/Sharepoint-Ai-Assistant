import { describe, expect, it, jest } from '@jest/globals';
import { NoopAuditService } from '../../src/services/audit-service';
import { PermissionService } from '../../src/services/permission-service';
import {
  createGetAuditLogsHandler,
  createGetUserPermissionsHandler,
  getAuditLogsSchema,
  getUserPermissionsSchema,
} from '../../src/tools/security-tools';
import { mockSharePointClient, resultText } from '../helpers';

describe('get_audit_logs', () => {
  it('returns mapped logs via the audit service', async () => {
    const audit = new NoopAuditService();
    jest.spyOn(audit, 'getAuditLogs').mockResolvedValue([{ id: 1, action: 'AI_ACTION' }]);

    const handler = createGetAuditLogsHandler(audit);
    const result = await handler({ userId: 'alice' });

    expect(audit.getAuditLogs).toHaveBeenCalledWith({ userId: 'alice' });
    expect(JSON.parse(resultText(result))).toEqual([{ id: 1, action: 'AI_ACTION' }]);
  });

  it('accepts optional filters via the schema', () => {
    expect(getAuditLogsSchema.userId.safeParse('x').success).toBe(true);
    expect(getAuditLogsSchema.from.safeParse('2024-01-01').success).toBe(true);
  });
});

describe('get_user_permissions', () => {
  it('lists groups and accessible projects', async () => {
    const client = mockSharePointClient();
    jest.mocked(client.queryList).mockResolvedValue([
      { Id: 1, Title: 'Public Project' },
      { Id: 2, Title: 'PMO Project', PermittedGroups: { results: ['PMO'] } },
    ]);
    const permissions = new PermissionService({ getUserADGroups: async () => ['PMO'] });

    const handler = createGetUserPermissionsHandler(permissions, client);
    const result = await handler({ userId: 'alice' });
    const parsed = JSON.parse(resultText(result));

    expect(parsed.groups).toEqual(['PMO']);
    expect(parsed.accessibleProjects).toEqual([
      { id: 1, title: 'Public Project' },
      { id: 2, title: 'PMO Project' },
    ]);
  });

  it('hides restricted projects from users without the group', async () => {
    const client = mockSharePointClient();
    jest.mocked(client.queryList).mockResolvedValue([
      { Id: 1, Title: 'Public Project' },
      { Id: 2, Title: 'PMO Project', PermittedGroups: { results: ['PMO'] } },
    ]);
    const permissions = new PermissionService({ getUserADGroups: async () => [] });

    const handler = createGetUserPermissionsHandler(permissions, client);
    const parsed = JSON.parse(resultText(await handler({ userId: 'bob' })));

    expect(parsed.accessibleProjects).toEqual([{ id: 1, title: 'Public Project' }]);
  });

  it('rejects an empty userId via the schema', () => {
    expect(getUserPermissionsSchema.userId.safeParse('').success).toBe(false);
  });
});
