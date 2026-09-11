import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SharePointError } from '../../src/errors';
import { NoopAuditService } from '../../src/services/audit-service';
import {
  createCreateEscalationHandler,
  createGetEscalationsByProjectHandler,
  createUpdateEscalationHandler,
  getEscalationsByProjectSchema,
  updateEscalationSchema,
} from '../../src/tools/escalation-tools';
import { mockSharePointClient, resultText } from '../helpers';

const FIXED_NOW = new Date('2024-01-15T00:00:00.000Z');
const projectRow = { Id: 5, Title: 'Project Alpha' };
const escalationRow = { Id: 9, Title: 'Escalation: Project Alpha', Status: 'Open' };

describe('escalation tools', () => {
  let client: ReturnType<typeof mockSharePointClient>;

  beforeEach(() => {
    client = mockSharePointClient();
  });

  describe('create_escalation', () => {
    it('builds the correctly-shaped item and returns the created escalation', async () => {
      jest.mocked(client.getItemById).mockResolvedValue(projectRow);
      jest.mocked(client.createItem).mockResolvedValue(escalationRow);

      const handler = createCreateEscalationHandler(client, { now: () => FIXED_NOW });
      const result = await handler({ projectId: '5', issue: 'Budget blown', priority: 'High' });

      expect(client.createItem).toHaveBeenCalledWith('Escalations', {
        Title: 'Escalation: Project Alpha',
        ProjectId: 5,
        IssueDescription: 'Budget blown',
        Priority: 'High',
        Status: 'Open',
        CreatedDate: FIXED_NOW.toISOString(),
      });

      expect(JSON.parse(resultText(result))).toEqual(
        expect.objectContaining({ id: 9, title: 'Escalation: Project Alpha' }),
      );
    });

    it('includes optional assignedTo and dueDate when provided', async () => {
      jest.mocked(client.getItemById).mockResolvedValue(projectRow);
      jest.mocked(client.createItem).mockResolvedValue(escalationRow);

      const handler = createCreateEscalationHandler(client, { now: () => FIXED_NOW });
      await handler({
        projectId: '5',
        issue: 'x',
        priority: 'Critical',
        assignedTo: 'i:0#.w|CORP\\alice',
        dueDate: '2024-02-01T00:00:00.000Z',
      });

      expect(client.createItem).toHaveBeenCalledWith(
        'Escalations',
        expect.objectContaining({
          AssignedTo: 'i:0#.w|CORP\\alice',
          DueDate: '2024-02-01T00:00:00.000Z',
        }),
      );
    });

    it('writes an audit entry via the injected audit service', async () => {
      jest.mocked(client.getItemById).mockResolvedValue(projectRow);
      jest.mocked(client.createItem).mockResolvedValue(escalationRow);
      const audit = new NoopAuditService();
      jest.spyOn(audit, 'logAIAction');

      const handler = createCreateEscalationHandler(client, { now: () => FIXED_NOW, audit });
      await handler({ projectId: '5', issue: 'x', priority: 'Medium' });

      expect(audit.logAIAction).toHaveBeenCalledWith(
        expect.objectContaining({ toolName: 'create_escalation' }),
      );
    });

    it('propagates SharePoint errors', async () => {
      jest
        .mocked(client.getItemById)
        .mockRejectedValue(new SharePointError('boom', 500, undefined));
      const handler = createCreateEscalationHandler(client);
      await expect(handler({ projectId: '5', issue: 'x', priority: 'Low' })).rejects.toBeInstanceOf(
        SharePointError,
      );
    });
  });

  describe('update_escalation', () => {
    it('updates only the provided fields', async () => {
      jest.mocked(client.updateItem).mockResolvedValue(escalationRow);
      const handler = createUpdateEscalationHandler(client, { now: () => FIXED_NOW });
      await handler({ escalationId: '9', status: 'Resolved' });
      expect(client.updateItem).toHaveBeenCalledWith('Escalations', 9, { Status: 'Resolved' });
    });

    it('rejects attempts to change projectId or createdBy via the schema', () => {
      expect(updateEscalationSchema.projectId.safeParse('5').success).toBe(false);
      expect(updateEscalationSchema.createdBy.safeParse('alice').success).toBe(false);
    });
  });

  describe('get_escalations_by_project', () => {
    it('queries with a project filter and maps results', async () => {
      jest.mocked(client.queryList).mockResolvedValue([escalationRow]);
      const handler = createGetEscalationsByProjectHandler(client);
      const result = await handler({ projectId: '5' });
      expect(client.queryList).toHaveBeenCalledWith('Escalations', { filter: 'ProjectId eq 5' });
      expect(JSON.parse(resultText(result))).toEqual([expect.objectContaining({ id: 9 })]);
    });

    it('adds a status filter when provided', async () => {
      jest.mocked(client.queryList).mockResolvedValue([]);
      const handler = createGetEscalationsByProjectHandler(client);
      await handler({ projectId: '5', status: 'Open' });
      expect(client.queryList).toHaveBeenCalledWith('Escalations', {
        filter: "(ProjectId eq 5) and (Status eq 'Open')",
      });
    });

    it('rejects an invalid status via the schema', () => {
      expect(getEscalationsByProjectSchema.status.safeParse('Nope').success).toBe(false);
    });
  });
});
