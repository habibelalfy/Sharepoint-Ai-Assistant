import { describe, expect, it, jest } from '@jest/globals';
import type { Milestone, Task } from '../../src/types/models';
import {
  AlertService,
  detectOverdueItems,
  detectUpcomingMilestones,
} from '../../src/services/alert-service';
import { ConsoleEmailSender } from '../../src/services/email-service';
import { mockSharePointClient } from '../helpers';

const NOW = new Date('2024-01-15T00:00:00.000Z');

const SCHEDULES = { overdue: '0 9 * * *', milestones: '0 10 * * *', healthCheck: '0 8 * * 1' };

function task(id: number, status: string, dueDate?: string): Task {
  return { id, title: `Task ${id}`, status, dueDate };
}

function milestone(id: number, status: string, dueDate?: string): Milestone {
  return { id, title: `M${id}`, status, dueDate };
}

/** Invokes the private `runHealthCheck` method for deterministic testing. */
function runHealthCheck(service: AlertService): Promise<void> {
  const access = service as unknown as { runHealthCheck: (now?: Date) => Promise<void> };
  return access.runHealthCheck();
}

describe('detectOverdueItems', () => {
  it('classifies overdue vs on-time vs completed items', () => {
    const tasks = [
      task(1, 'Completed', '2024-01-01T00:00:00.000Z'),
      task(2, 'In Progress', '2024-01-01T00:00:00.000Z'),
      task(3, 'Not Started', '2024-02-01T00:00:00.000Z'),
    ];
    const milestones = [
      milestone(1, 'Completed', '2024-01-01T00:00:00.000Z'),
      milestone(2, 'In Progress', '2024-01-10T00:00:00.000Z'),
      milestone(3, 'In Progress', '2024-01-20T00:00:00.000Z'),
    ];
    const overdue = detectOverdueItems(tasks, milestones, NOW);
    expect(overdue.map((item) => [item.kind, item.id])).toEqual([
      ['task', 2],
      ['milestone', 2],
    ]);
  });
});

describe('detectUpcomingMilestones', () => {
  it('detects only incomplete milestones within the window', () => {
    const milestones = [
      milestone(1, 'Completed', '2024-01-20T00:00:00.000Z'),
      milestone(2, 'In Progress', '2024-01-10T00:00:00.000Z'),
      milestone(3, 'In Progress', '2024-01-20T00:00:00.000Z'),
      milestone(4, 'In Progress', '2024-03-01T00:00:00.000Z'),
    ];
    expect(detectUpcomingMilestones(milestones, NOW, 7).map((m) => m.id)).toEqual([3]);
  });
});

describe('AlertService', () => {
  it('checkOverdueItems emails and logs when overdue items exist', async () => {
    const client = mockSharePointClient();
    const email = new ConsoleEmailSender();
    const service = new AlertService(client, email, SCHEDULES, { recipients: ['pm@corp.com'] });

    jest
      .mocked(client.queryList)
      .mockResolvedValueOnce([
        { Id: 2, Title: 'Task 2', Status: 'In Progress', DueDate: '/Date(1704067200000)/' },
      ]);
    jest
      .mocked(client.queryList)
      .mockResolvedValueOnce([
        { Id: 2, Title: 'M2', Status: 'In Progress', DueDate: '/Date(1704844800000)/' },
      ]);

    const overdue = await service.checkOverdueItems(NOW);
    expect(overdue).toHaveLength(2);
    expect(email.sent).toHaveLength(1);
    expect(client.createItem).toHaveBeenCalledWith(
      'Alerts',
      expect.objectContaining({ Title: '2 overdue item(s)', AlertType: 'Overdue' }),
    );
  });

  it('checkOverdueItems does nothing when nothing is overdue', async () => {
    const client = mockSharePointClient();
    const email = new ConsoleEmailSender();
    const service = new AlertService(client, email, SCHEDULES, { recipients: ['pm@corp.com'] });

    jest.mocked(client.queryList).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const overdue = await service.checkOverdueItems(NOW);
    expect(overdue).toHaveLength(0);
    expect(email.sent).toHaveLength(0);
    expect(client.createItem).not.toHaveBeenCalled();
  });

  it('checkUpcomingMilestones emails and logs upcoming milestones', async () => {
    const client = mockSharePointClient();
    const email = new ConsoleEmailSender();
    const service = new AlertService(client, email, SCHEDULES, { recipients: ['pm@corp.com'] });

    jest.mocked(client.queryList).mockResolvedValueOnce([]);
    jest
      .mocked(client.queryList)
      .mockResolvedValueOnce([
        { Id: 3, Title: 'M3', Status: 'In Progress', DueDate: '/Date(1705536000000)/' },
      ]);

    const upcoming = await service.checkUpcomingMilestones(NOW, 7);
    expect(upcoming).toHaveLength(1);
    expect(email.sent).toHaveLength(1);
  });

  it('startAlertScheduler registers three jobs with configured expressions', () => {
    const client = mockSharePointClient();
    const email = new ConsoleEmailSender();
    const registered: string[] = [];
    const fakeScheduler = (expression: string) => {
      registered.push(expression);
      return { stop: jest.fn() };
    };

    const service = new AlertService(client, email, SCHEDULES, { scheduler: fakeScheduler });
    const jobs = service.startAlertScheduler();

    expect(registered).toEqual(['0 9 * * *', '0 10 * * *', '0 8 * * 1']);
    expect(jobs).toHaveLength(3);
  });

  it('runHealthCheck emails and logs unhealthy projects', async () => {
    const client = mockSharePointClient();
    const email = new ConsoleEmailSender();
    const service = new AlertService(client, email, SCHEDULES, { recipients: ['pm@corp.com'] });

    // Projects: one overdue (flagged), one completed (skipped).
    jest.mocked(client.queryList).mockResolvedValueOnce([
      { Id: 1, Title: 'Alpha', Status: 'In Progress', EndDate: '/Date(1704067200000)/' },
      { Id: 2, Title: 'Done', Status: 'Completed' },
    ]);
    // Tasks for Alpha: one overdue task → health score drops below "Healthy".
    jest.mocked(client.queryList).mockResolvedValueOnce([
      {
        Id: 10,
        Title: 'Task A',
        Status: 'In Progress',
        DueDate: '/Date(1704067200000)/',
        PercentComplete: 0,
      },
    ]);
    // Milestones for Alpha: none.
    jest.mocked(client.queryList).mockResolvedValueOnce([]);

    await runHealthCheck(service);

    expect(email.sent).toHaveLength(1);
    expect(client.createItem).toHaveBeenCalledWith(
      'Alerts',
      expect.objectContaining({ Title: '1 unhealthy project(s)', AlertType: 'HealthCheck' }),
    );
  });

  it('runHealthCheck does nothing when there are no unhealthy projects', async () => {
    const client = mockSharePointClient();
    const email = new ConsoleEmailSender();
    const service = new AlertService(client, email, SCHEDULES, { recipients: ['pm@corp.com'] });

    jest.mocked(client.queryList).mockResolvedValue([]);

    await runHealthCheck(service);

    expect(email.sent).toHaveLength(0);
    expect(client.createItem).not.toHaveBeenCalled();
  });
});
