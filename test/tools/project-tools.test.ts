import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SharePointError } from '../../src/errors';
import {
  createGetProjectByIdHandler,
  createQueryProjectDataHandler,
  createSearchProjectsHandler,
  getProjectByIdSchema,
  queryProjectDataSchema,
  searchProjectsSchema,
} from '../../src/tools/project-tools';
import { mockSharePointClient, resultText } from '../helpers';

const projectRow = {
  Id: 5,
  Title: 'Project Alpha',
  Owner: { Id: 7, Title: 'Alice', Name: 'i:0#.w|CORP\\alice' },
  StartDate: '/Date(1700000000000)/',
  Status: 'In Progress',
};

describe('project tools', () => {
  let client: ReturnType<typeof mockSharePointClient>;

  beforeEach(() => {
    client = mockSharePointClient();
  });

  describe('schemas', () => {
    it('rejects invalid values before any SharePoint call', () => {
      expect(queryProjectDataSchema.listName.safeParse('SecretList').success).toBe(false);
      expect(queryProjectDataSchema.listName.safeParse('Projects').success).toBe(true);
      expect(getProjectByIdSchema.projectId.safeParse('').success).toBe(false);
      expect(searchProjectsSchema.query.safeParse('').success).toBe(false);
      expect(searchProjectsSchema.limit?.safeParse(0).success).toBe(false);
    });
  });

  describe('query_project_data', () => {
    it('maps returned rows into flat JSON', async () => {
      jest.mocked(client.queryList).mockResolvedValue([projectRow]);
      const handler = createQueryProjectDataHandler(client);
      const result = await handler({ listName: 'Projects' });
      expect(JSON.parse(resultText(result))).toEqual([
        {
          id: 5,
          title: 'Project Alpha',
          owner: { id: 7, displayName: 'Alice', login: 'CORP\\alice' },
          startDate: new Date(1700000000000).toISOString(),
          status: 'In Progress',
        },
      ]);
    });

    it('passes the sanitized filter and selected fields to the client', async () => {
      jest.mocked(client.queryList).mockResolvedValue([]);
      const handler = createQueryProjectDataHandler(client);
      await handler({
        listName: 'Projects',
        filter: "Status eq 'In Progress'",
        fields: ['Title', 'Status'],
      });
      expect(client.queryList).toHaveBeenCalledWith('Projects', {
        filter: "Status eq 'In Progress'",
        select: ['Title', 'Status'],
      });
    });

    it('propagates SharePoint errors', async () => {
      jest.mocked(client.queryList).mockRejectedValue(new SharePointError('boom', 500, undefined));
      const handler = createQueryProjectDataHandler(client);
      await expect(handler({ listName: 'Tasks' })).rejects.toBeInstanceOf(SharePointError);
    });
  });

  describe('get_project_by_id', () => {
    it('returns the nested project/tasks/milestones structure', async () => {
      jest.mocked(client.getItemById).mockResolvedValue(projectRow);
      jest.mocked(client.queryList).mockResolvedValue([]);
      const handler = createGetProjectByIdHandler(client);
      const result = await handler({ projectId: '5' });
      expect(JSON.parse(resultText(result))).toEqual({
        project: expect.objectContaining({ id: 5, title: 'Project Alpha' }),
        tasks: [],
        milestones: [],
      });
      expect(client.queryList).toHaveBeenCalledWith('Tasks', { filter: 'ProjectId eq 5' });
      expect(client.queryList).toHaveBeenCalledWith('Milestones', { filter: 'ProjectId eq 5' });
    });

    it('rejects a non-numeric project id before any call', async () => {
      const handler = createGetProjectByIdHandler(client);
      await expect(handler({ projectId: 'abc' })).rejects.toThrow(/Invalid id/);
      expect(client.getItemById).not.toHaveBeenCalled();
    });

    it('propagates SharePoint errors', async () => {
      jest
        .mocked(client.getItemById)
        .mockRejectedValue(new SharePointError('gone', 404, undefined));
      const handler = createGetProjectByIdHandler(client);
      await expect(handler({ projectId: '5' })).rejects.toBeInstanceOf(SharePointError);
    });
  });

  describe('search_projects', () => {
    it('builds a substringof filter and defaults the limit', async () => {
      jest.mocked(client.queryList).mockResolvedValue([projectRow]);
      const handler = createSearchProjectsHandler(client);
      const result = await handler({ query: 'alpha' });
      expect(client.queryList).toHaveBeenCalledWith('Projects', {
        filter: "substringof('alpha',Title) or substringof('alpha',Description)",
        top: 10,
      });
      expect(JSON.parse(resultText(result))).toHaveLength(1);
    });

    it('escapes single quotes in the query', async () => {
      jest.mocked(client.queryList).mockResolvedValue([]);
      const handler = createSearchProjectsHandler(client);
      await handler({ query: "O'Brien" });
      expect(client.queryList).toHaveBeenCalledWith('Projects', {
        filter: "substringof('O''Brien',Title) or substringof('O''Brien',Description)",
        top: 10,
      });
    });
  });
});
