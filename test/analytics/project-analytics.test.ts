import { describe, it, expect, jest } from '@jest/globals';
import { ProjectAnalytics } from '../../src/analytics/project-analytics';
import type { ProjectServerClient } from '../../src/sharepoint/project-server-client';
import type { SnapshotStore } from '../../src/analytics/snapshot-store';
describe('ProjectAnalytics', () => {
  it('exports only current accessible projects and does not invent unknown progress', async () => {
    const project = { id: 'p', title: 'Demo' };
    const client = {
      projects: jest.fn<() => Promise<unknown>>().mockResolvedValue([project]),
      tasks: jest.fn<() => Promise<unknown>>().mockResolvedValue([]),
    };
    const store = {
      record: jest.fn<() => Promise<unknown>>().mockResolvedValue([
        {
          projectId: 'secret',
          capturedAt: '2026-09-15T00:00:00Z',
          percentComplete: 20,
          plannedFinish: null,
        },
      ]),
    };
    const service = new ProjectAnalytics(
      client as unknown as ProjectServerClient,
      store as unknown as SnapshotStore,
      () => new Date('2026-09-15'),
    );
    const [a, b] = await Promise.all([service.dataset(), service.dataset()]);
    expect(a).toBe(b);
    expect(client.projects).toHaveBeenCalledTimes(1);
    expect(a.history).toEqual([]);
    expect(a.projects[0]!.percentComplete).toBeNull();
    expect(a.predictions[0]!.status).toBe('insufficient_history');
  });
  it('does not forecast shell projects with no published tasks', async () => {
    const client = {
      projects: async () => [
        { id: 'p', title: 'Shell', percentComplete: 0, endDate: '2026-01-01' },
      ],
      tasks: async () => [],
    };
    const store = {
      record: async () => [
        {
          projectId: 'p',
          capturedAt: '2026-09-15T00:00:00Z',
          percentComplete: 0,
          plannedFinish: '2026-01-01',
        },
      ],
    };
    const service = new ProjectAnalytics(
      client as unknown as ProjectServerClient,
      store as unknown as SnapshotStore,
      () => new Date('2026-09-15'),
    );
    expect((await service.dataset()).predictions[0]).toMatchObject({
      status: 'no_baseline',
      predictedFinish: null,
      delayDays: null,
    });
  });
  it('does not store a partial snapshot when a project request fails', async () => {
    const client = {
      projects: async () => [{ id: 'p', title: 'P' }],
      tasks: async () => {
        throw new Error('forbidden');
      },
    };
    const store = { record: jest.fn() };
    const service = new ProjectAnalytics(
      client as unknown as ProjectServerClient,
      store as unknown as SnapshotStore,
    );
    await expect(service.dataset()).rejects.toThrow('forbidden');
    expect(store.record).not.toHaveBeenCalled();
  });
});
