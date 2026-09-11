import { describe, expect, it } from '@jest/globals';
import type { Milestone } from '../../src/types/models';
import { ValidationError } from '../../src/errors';
import { MilestoneDelayAnalysisService } from '../../src/services/milestone-analysis';

const service = new MilestoneDelayAnalysisService();

function ref(id: number): { id: number; title: string } {
  return { id, title: `M${id}` };
}

function milestone(id: number, dueDate: string, deps: number[] = []): Milestone {
  return { id, title: `M${id}`, status: 'In Progress', dueDate, dependencies: deps.map(ref) };
}

// Dependency graph: A → B → C and A → D.
const all = [
  milestone(1, '2024-01-01T00:00:00.000Z'),
  milestone(2, '2024-01-10T00:00:00.000Z', [1]),
  milestone(3, '2024-01-20T00:00:00.000Z', [2]),
  milestone(4, '2024-01-15T00:00:00.000Z', [1]),
];

describe('MilestoneDelayAnalysisService.getDependencyChain', () => {
  it('returns the prerequisite chain in dependency order', () => {
    expect(service.getDependencyChain('3', all)).toEqual(['1', '2']);
    expect(service.getDependencyChain('2', all)).toEqual(['1']);
    expect(service.getDependencyChain('4', all)).toEqual(['1']);
    expect(service.getDependencyChain('1', all)).toEqual([]);
  });

  it('rejects circular dependencies instead of looping', () => {
    const cycle = [
      milestone(1, '2024-01-01T00:00:00.000Z', [2]),
      milestone(2, '2024-01-02T00:00:00.000Z', [1]),
    ];
    expect(() => service.getDependencyChain('1', cycle)).toThrow(ValidationError);
    expect(() => service.analyzeDelayImpact('1', 3, cycle, [])).toThrow(/Circular dependency/);
  });
});

describe('MilestoneDelayAnalysisService.calculateCascadingDates', () => {
  it('shifts the target and all transitive successors', () => {
    expect(service.calculateCascadingDates('1', 3, all)).toEqual([
      {
        milestoneId: '1',
        title: 'M1',
        originalDueDate: '2024-01-01T00:00:00.000Z',
        adjustedDueDate: '2024-01-04T00:00:00.000Z',
      },
      {
        milestoneId: '2',
        title: 'M2',
        originalDueDate: '2024-01-10T00:00:00.000Z',
        adjustedDueDate: '2024-01-13T00:00:00.000Z',
      },
      {
        milestoneId: '4',
        title: 'M4',
        originalDueDate: '2024-01-15T00:00:00.000Z',
        adjustedDueDate: '2024-01-18T00:00:00.000Z',
      },
      {
        milestoneId: '3',
        title: 'M3',
        originalDueDate: '2024-01-20T00:00:00.000Z',
        adjustedDueDate: '2024-01-23T00:00:00.000Z',
      },
    ]);
  });
});

describe('MilestoneDelayAnalysisService.analyzeDelayImpact', () => {
  it('splits direct from cascading impacts when delaying the root', () => {
    const result = service.analyzeDelayImpact('1', 3, all, []);
    expect(result.totalProjectDelay).toBe(3);
    expect(result.criticalPathAffected).toBe(true);
    expect(result.directImpacts).toEqual([
      {
        milestoneId: '2',
        title: 'M2',
        originalDueDate: '2024-01-10T00:00:00.000Z',
        adjustedDueDate: '2024-01-13T00:00:00.000Z',
      },
      {
        milestoneId: '4',
        title: 'M4',
        originalDueDate: '2024-01-15T00:00:00.000Z',
        adjustedDueDate: '2024-01-18T00:00:00.000Z',
      },
    ]);
    expect(result.cascadingImpacts).toEqual([
      {
        milestoneId: '3',
        title: 'M3',
        originalDueDate: '2024-01-20T00:00:00.000Z',
        adjustedDueDate: '2024-01-23T00:00:00.000Z',
      },
    ]);
  });

  it('reports a single direct impact when delaying a mid-chain milestone', () => {
    const result = service.analyzeDelayImpact('2', 5, all, []);
    expect(result.totalProjectDelay).toBe(5);
    expect(result.criticalPathAffected).toBe(true);
    expect(result.directImpacts).toEqual([
      {
        milestoneId: '3',
        title: 'M3',
        originalDueDate: '2024-01-20T00:00:00.000Z',
        adjustedDueDate: '2024-01-25T00:00:00.000Z',
      },
    ]);
    expect(result.cascadingImpacts).toEqual([]);
  });

  it('flags off-critical-path milestones correctly', () => {
    const result = service.analyzeDelayImpact('4', 2, all, []);
    expect(result.criticalPathAffected).toBe(false);
    expect(result.directImpacts).toEqual([]);
    expect(result.cascadingImpacts).toEqual([]);
  });

  it('generates recommendations that account for open tasks', () => {
    const tasks = [
      { id: 1, title: 'T1', status: 'Completed' },
      { id: 2, title: 'T2', status: 'In Progress' },
    ];
    const result = service.analyzeDelayImpact('2', 5, all, tasks);
    expect(result.recommendedActions).toHaveLength(2);
    expect(result.recommendedActions[0]).toContain('Re-baseline');
    expect(result.recommendedActions[1]).toContain('1 open task');
  });

  it('rejects an unknown milestone', () => {
    expect(() => service.analyzeDelayImpact('999', 3, all, [])).toThrow(/Milestone not found/);
  });
});
