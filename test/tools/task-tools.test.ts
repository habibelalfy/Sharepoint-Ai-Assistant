import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SharePointError } from '../../src/errors';
import {
  TASK_STATUSES,
  createGetTasksByProjectHandler,
  getTasksByProjectSchema,
} from '../../src/tools/task-tools';
import { mockSharePointClient, resultText } from '../helpers';

const taskRow = {
  Id: 1,
  Title: 'Task A',
  Project: { Id: 5, Title: 'Project Alpha' },
  Status: 'In Progress',
  DueDate: '/Date(1700000000000)/',
};

describe('get_tasks_by_project', () => {
  let client: ReturnType<typeof mockSharePointClient>;

  beforeEach(() => {
    client = mockSharePointClient();
  });

  it('returns tasks for a project', async () => {
    jest.mocked(client.queryList).mockResolvedValue([taskRow]);
    const handler = createGetTasksByProjectHandler(client);
    const result = await handler({ projectId: '5' });
    expect(client.queryList).toHaveBeenCalledWith('Tasks', { filter: 'ProjectId eq 5' });
    expect(JSON.parse(resultText(result))).toEqual([
      expect.objectContaining({ id: 1, title: 'Task A' }),
    ]);
  });

  it('adds a status filter for a concrete status', async () => {
    jest.mocked(client.queryList).mockResolvedValue([]);
    const handler = createGetTasksByProjectHandler(client);
    await handler({ projectId: '5', status: 'Completed' });
    expect(client.queryList).toHaveBeenCalledWith('Tasks', {
      filter: "ProjectId eq 5 and Status eq 'Completed'",
    });
  });

  it('builds a derived overdue filter for the Overdue status', async () => {
    jest.mocked(client.queryList).mockResolvedValue([]);
    const handler = createGetTasksByProjectHandler(client);
    await handler({ projectId: '5', status: 'Overdue' });
    expect(client.queryList).toHaveBeenCalledWith(
      'Tasks',
      expect.objectContaining({ filter: expect.stringContaining('ProjectId eq 5') }),
    );
    expect(client.queryList).toHaveBeenCalledWith(
      'Tasks',
      expect.objectContaining({ filter: expect.stringContaining("Status ne 'Completed'") }),
    );
    expect(client.queryList).toHaveBeenCalledWith(
      'Tasks',
      expect.objectContaining({ filter: expect.stringContaining("DueDate lt datetime'") }),
    );
  });

  it('rejects an invalid status before any call', () => {
    expect(getTasksByProjectSchema.status.safeParse('Unknown').success).toBe(false);
    expect(TASK_STATUSES).toHaveLength(4);
  });

  it('propagates SharePoint errors', async () => {
    jest.mocked(client.queryList).mockRejectedValue(new SharePointError('boom', 503, undefined));
    const handler = createGetTasksByProjectHandler(client);
    await expect(handler({ projectId: '5' })).rejects.toBeInstanceOf(SharePointError);
  });
});
