import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SharePointError } from '../../src/errors';
import {
  analyzeMilestoneDelaySchema,
  checkPlanHealthSchema,
  createAnalyzeMilestoneDelayHandler,
  createCheckPlanHealthHandler,
  createGetProjectStatisticsHandler,
  getProjectStatisticsSchema,
} from '../../src/tools/analytics-tools';
import { mockSharePointClient, resultText } from '../helpers';

const projectRow = { Id: 1, Title: 'P', Budget: 1000, ActualCost: 800 };
const taskRow = { Id: 1, Title: 'T1', Status: 'Completed' };
const milestoneRow = { Id: 1, Title: 'M1', Status: 'Completed' };

describe('analytics tools', () => {
  let client: ReturnType<typeof mockSharePointClient>;

  beforeEach(() => {
    client = mockSharePointClient();
  });

  describe('schemas', () => {
    it('rejects invalid input before any SharePoint call', () => {
      expect(checkPlanHealthSchema.projectId.safeParse('').success).toBe(false);
      expect(getProjectStatisticsSchema.projectId.safeParse('').success).toBe(false);
      expect(analyzeMilestoneDelaySchema.milestoneId.safeParse('').success).toBe(false);
      expect(analyzeMilestoneDelaySchema.delayDays.safeParse(0).success).toBe(false);
      expect(analyzeMilestoneDelaySchema.delayDays.safeParse(-1).success).toBe(false);
    });
  });

  describe('check_plan_health', () => {
    it('returns a health assessment', async () => {
      jest.mocked(client.getItemById).mockResolvedValue(projectRow);
      jest
        .mocked(client.queryList)
        .mockResolvedValueOnce([taskRow])
        .mockResolvedValueOnce([milestoneRow]);

      const handler = createCheckPlanHealthHandler(client);
      const result = await handler({ projectId: '1' });
      const health = JSON.parse(resultText(result));

      expect(health.score).toBe(100);
      expect(health.status).toBe('Healthy');
      expect(client.queryList).toHaveBeenCalledWith('Tasks', { filter: 'ProjectId eq 1' });
      expect(client.queryList).toHaveBeenCalledWith('Milestones', { filter: 'ProjectId eq 1' });
    });

    it('propagates SharePoint errors', async () => {
      jest
        .mocked(client.getItemById)
        .mockRejectedValue(new SharePointError('boom', 500, undefined));
      const handler = createCheckPlanHealthHandler(client);
      await expect(handler({ projectId: '1' })).rejects.toBeInstanceOf(SharePointError);
    });
  });

  describe('analyze_milestone_delay', () => {
    it('returns a delay-impact analysis', async () => {
      const milestoneA = {
        Id: 1,
        Title: 'A',
        Status: 'In Progress',
        DueDate: '/Date(1704067200000)/',
      };
      const milestoneB = {
        Id: 2,
        Title: 'B',
        Status: 'In Progress',
        DueDate: '/Date(1704844800000)/',
        Dependencies: { results: [{ Id: 1, Title: 'A' }] },
      };
      jest
        .mocked(client.queryList)
        .mockResolvedValueOnce([milestoneA, milestoneB])
        .mockResolvedValueOnce([]);

      const handler = createAnalyzeMilestoneDelayHandler(client);
      const result = await handler({ milestoneId: '1', delayDays: 3 });
      const analysis = JSON.parse(resultText(result));

      expect(analysis.totalProjectDelay).toBe(3);
      expect(analysis.criticalPathAffected).toBe(true);
      expect(analysis.directImpacts).toHaveLength(1);
      expect(analysis.directImpacts[0].milestoneId).toBe('2');
    });
  });

  describe('get_project_statistics', () => {
    it('returns project statistics', async () => {
      jest
        .mocked(client.queryList)
        .mockResolvedValueOnce([taskRow])
        .mockResolvedValueOnce([milestoneRow]);

      const handler = createGetProjectStatisticsHandler(client);
      const result = await handler({ projectId: '1' });
      const stats = JSON.parse(resultText(result));

      expect(stats.totalTasks).toBe(1);
      expect(stats.completedTasks).toBe(1);
      expect(stats.totalMilestones).toBe(1);
    });
  });
});
