import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SharePointError } from '../../src/errors';
import {
  createGetMilestonesByProjectHandler,
  getMilestonesByProjectSchema,
} from '../../src/tools/milestone-tools';
import { mockSharePointClient, resultText } from '../helpers';

const milestoneRow = {
  Id: 2,
  Title: 'Milestone 1',
  Project: { Id: 5, Title: 'Project Alpha' },
  DueDate: '/Date(1700000000000)/',
  Status: 'Completed',
};

describe('get_milestones_by_project', () => {
  let client: ReturnType<typeof mockSharePointClient>;

  beforeEach(() => {
    client = mockSharePointClient();
  });

  it('returns milestones sorted by due date, including completed by default', async () => {
    jest.mocked(client.queryList).mockResolvedValue([milestoneRow]);
    const handler = createGetMilestonesByProjectHandler(client);
    const result = await handler({ projectId: '5' });
    expect(client.queryList).toHaveBeenCalledWith('Milestones', {
      filter: 'ProjectId eq 5',
      orderby: 'DueDate asc',
    });
    expect(JSON.parse(resultText(result))).toEqual([
      expect.objectContaining({ id: 2, title: 'Milestone 1' }),
    ]);
  });

  it('excludes completed milestones when includeCompleted is false', async () => {
    jest.mocked(client.queryList).mockResolvedValue([]);
    const handler = createGetMilestonesByProjectHandler(client);
    await handler({ projectId: '5', includeCompleted: false });
    expect(client.queryList).toHaveBeenCalledWith('Milestones', {
      filter: "(ProjectId eq 5) and (Status ne 'Completed')",
      orderby: 'DueDate asc',
    });
  });

  it('rejects a missing project id before any call', () => {
    expect(getMilestonesByProjectSchema.projectId.safeParse('').success).toBe(false);
  });

  it('propagates SharePoint errors', async () => {
    jest.mocked(client.queryList).mockRejectedValue(new SharePointError('boom', 500, undefined));
    const handler = createGetMilestonesByProjectHandler(client);
    await expect(handler({ projectId: '5' })).rejects.toBeInstanceOf(SharePointError);
  });
});
