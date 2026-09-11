import { describe, expect, it } from '@jest/globals';
import type { Milestone, Task } from '../../src/types/models';
import { computeProjectStatistics } from '../../src/services/statistics';

const NOW = new Date('2024-01-15T00:00:00.000Z');

function task(id: number, status: string, dueDate?: string): Task {
  return { id, title: `Task ${id}`, status, dueDate };
}

function milestone(id: number, status: string): Milestone {
  return { id, title: `Milestone ${id}`, status };
}

describe('computeProjectStatistics', () => {
  it('computes counts, progress, and estimated completion', () => {
    const stats = computeProjectStatistics(
      [
        task(1, 'Completed', '2024-01-10T00:00:00.000Z'),
        task(2, 'In Progress', '2024-01-01T00:00:00.000Z'),
        task(3, 'Not Started', '2024-02-01T00:00:00.000Z'),
      ],
      [milestone(1, 'Completed'), milestone(2, 'In Progress')],
      NOW,
    );
    expect(stats).toEqual({
      totalTasks: 3,
      completedTasks: 1,
      overdueTasks: 1,
      totalMilestones: 2,
      completedMilestones: 1,
      overallProgress: 42,
      estimatedCompletionDate: '2024-02-01T00:00:00.000Z',
    });
  });

  it('returns null completion and 100% progress when nothing remains', () => {
    const stats = computeProjectStatistics(
      [task(1, 'Completed', '2024-01-01T00:00:00.000Z')],
      [],
      NOW,
    );
    expect(stats.overallProgress).toBe(100);
    expect(stats.estimatedCompletionDate).toBeNull();
  });

  it('floors the estimate at today when all remaining tasks are overdue', () => {
    const stats = computeProjectStatistics(
      [task(1, 'In Progress', '2024-01-01T00:00:00.000Z')],
      [],
      NOW,
    );
    expect(stats.overdueTasks).toBe(1);
    expect(stats.estimatedCompletionDate).toBe(NOW.toISOString());
  });
});
