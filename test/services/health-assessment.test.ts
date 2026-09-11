import { describe, expect, it } from '@jest/globals';
import type { Milestone, Project, Task } from '../../src/types/models';
import { ProjectHealthService } from '../../src/services/health-assessment';

const NOW = new Date('2024-01-15T00:00:00.000Z');

const service = new ProjectHealthService();

function task(id: number, status: string, dueDate?: string): Task {
  return { id, title: `Task ${id}`, status, dueDate };
}

function milestone(id: number, status: string, dueDate?: string): Milestone {
  return { id, title: `Milestone ${id}`, status, dueDate };
}

describe('ProjectHealthService helpers', () => {
  it('calculates task completion rate (empty input is vacuous 100%)', () => {
    expect(service.calculateTaskCompletionRate([])).toBe(100);
    expect(
      service.calculateTaskCompletionRate([task(1, 'Completed'), task(2, 'In Progress')]),
    ).toBe(50);
    expect(service.calculateTaskCompletionRate([task(1, 'Completed')])).toBe(100);
  });

  it('calculates milestone completion rate', () => {
    expect(service.calculateMilestoneCompletionRate([])).toBe(100);
    expect(
      service.calculateMilestoneCompletionRate([
        milestone(1, 'Completed'),
        milestone(2, 'In Progress'),
      ]),
    ).toBe(50);
  });

  it('counts overdue items (completed items never count)', () => {
    const tasks = [
      task(1, 'Completed', '2024-01-01T00:00:00.000Z'),
      task(2, 'In Progress', '2024-01-01T00:00:00.000Z'),
      task(3, 'Not Started', '2024-02-01T00:00:00.000Z'),
    ];
    const milestones = [
      milestone(1, 'Completed', '2024-01-01T00:00:00.000Z'),
      milestone(2, 'In Progress', '2024-01-10T00:00:00.000Z'),
    ];
    expect(service.countOverdueItems(tasks, milestones, NOW)).toBe(2);
  });

  it('maps scores to status using the named thresholds', () => {
    expect(service.determineStatus(100)).toBe('Healthy');
    expect(service.determineStatus(80)).toBe('Healthy');
    expect(service.determineStatus(79)).toBe('At Risk');
    expect(service.determineStatus(50)).toBe('At Risk');
    expect(service.determineStatus(49)).toBe('Critical');
    expect(service.determineStatus(0)).toBe('Critical');
  });

  it('scores budget variance (or returns null when absent)', () => {
    const project = (budget?: number, actualCost?: number): Project => ({
      id: 1,
      title: 'P',
      budget,
      actualCost,
    });
    expect(service.calculateBudgetVarianceScore(project(100, 100))).toBe(100);
    expect(service.calculateBudgetVarianceScore(project(100, 90))).toBe(100);
    expect(service.calculateBudgetVarianceScore(project(100, 110))).toBe(80);
    expect(service.calculateBudgetVarianceScore(project(100, 150))).toBe(0);
    expect(service.calculateBudgetVarianceScore(project())).toBeNull();
    expect(service.calculateBudgetVarianceScore(project(0, 0))).toBeNull();
  });
});

describe('ProjectHealthService.assessProjectHealth', () => {
  it('scores a healthy project at 100 with no issues', () => {
    const result = service.assessProjectHealth(
      { id: 1, title: 'Healthy', budget: 1000, actualCost: 800 },
      [task(1, 'Completed'), task(2, 'Completed')],
      [milestone(1, 'Completed')],
      NOW,
    );
    expect(result).toEqual({ score: 100, status: 'Healthy', issues: [], recommendations: [] });
  });

  it('scores an at-risk project (hand-calculated 57) and lists issues', () => {
    const result = service.assessProjectHealth(
      { id: 2, title: 'At Risk', budget: 1000, actualCost: 1100 },
      [
        task(1, 'Completed'),
        task(2, 'In Progress', '2024-01-01T00:00:00.000Z'),
        task(3, 'Not Started'),
      ],
      [milestone(1, 'Completed'), milestone(2, 'In Progress')],
      NOW,
    );
    expect(result.score).toBe(57);
    expect(result.status).toBe('At Risk');
    expect(result.issues).toHaveLength(4);
    expect(result.recommendations).toHaveLength(4);
  });

  it('scores an all-overdue project with no budget as Critical (0)', () => {
    const result = service.assessProjectHealth(
      { id: 3, title: 'Critical' },
      [
        task(1, 'In Progress', '2024-01-01T00:00:00.000Z'),
        task(2, 'In Progress', '2024-01-02T00:00:00.000Z'),
        task(3, 'In Progress', '2024-01-03T00:00:00.000Z'),
        task(4, 'In Progress', '2024-01-04T00:00:00.000Z'),
        task(5, 'In Progress', '2024-01-05T00:00:00.000Z'),
      ],
      [milestone(1, 'In Progress', '2024-01-01T00:00:00.000Z')],
      NOW,
    );
    expect(result.score).toBe(0);
    expect(result.status).toBe('Critical');
    expect(result.issues).toHaveLength(3);
  });

  it('treats a project with no tasks or milestones as healthy', () => {
    const result = service.assessProjectHealth(
      { id: 4, title: 'Empty', budget: 100, actualCost: 50 },
      [],
      [],
      NOW,
    );
    expect(result.score).toBe(100);
    expect(result.status).toBe('Healthy');
  });
});
