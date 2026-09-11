/**
 * Platform-independent project health assessment.
 *
 * Pure business logic: it operates only on already-fetched data and never
 * touches SharePoint. The scoring helpers are public so they can be unit-tested
 * in isolation (see the build prompt's test requirements).
 *
 * @module services/health-assessment
 */
import type { Milestone, Project, Task } from '../types/models';
import { clampPercent, isOverdue } from './shared';

export type HealthStatus = 'Healthy' | 'At Risk' | 'Critical';

export interface ProjectHealth {
  score: number;
  status: HealthStatus;
  issues: string[];
  recommendations: string[];
}

/** Score weights; these sum to 1 when budget data is present. */
const WEIGHTS = {
  TASK_COMPLETION: 0.3,
  MILESTONE_COMPLETION: 0.3,
  OVERDUE: 0.25,
  BUDGET_VARIANCE: 0.15,
} as const;

/** Status thresholds (score is in [0, 100]). */
const THRESHOLDS = {
  HEALTHY_MIN: 80,
  AT_RISK_MIN: 50,
} as const;

/** Per-overdue-item point penalty applied to the overdue sub-score. */
const OVERDUE_PENALTY_PER_ITEM = 20;

/** Completion rate (0-100) below which a component is flagged as weak. */
const WEAK_COMPLETION_THRESHOLD = 70;

/** Each 1% over budget costs this many points off the budget sub-score. */
const BUDGET_PENALTY_PER_PERCENT = 2;

export class ProjectHealthService {
  /**
   * Scores a project's health from its tasks, milestones, and (optional) budget.
   *
   * @param project - The project being assessed.
   * @param tasks - Tasks belonging to the project.
   * @param milestones - Milestones belonging to the project.
   * @param now - Reference clock (injectable for deterministic tests).
   */
  public assessProjectHealth(
    project: Project,
    tasks: Task[],
    milestones: Milestone[],
    now: Date = new Date(),
  ): ProjectHealth {
    const taskRate = this.calculateTaskCompletionRate(tasks);
    const milestoneRate = this.calculateMilestoneCompletionRate(milestones);
    const overdueCount = this.countOverdueItems(tasks, milestones, now);
    const budgetScore = this.calculateBudgetVarianceScore(project);

    const weights = resolveWeights(budgetScore !== null);
    const overdueScore = Math.max(0, 100 - overdueCount * OVERDUE_PENALTY_PER_ITEM);

    const score = Math.round(
      taskRate * weights.task +
        milestoneRate * weights.milestone +
        overdueScore * weights.overdue +
        (budgetScore ?? 0) * weights.budget,
    );

    return {
      score: clampPercent(score),
      status: this.determineStatus(score),
      ...this.buildGuidance(project, taskRate, milestoneRate, overdueCount),
    };
  }

  /** Percentage (0-100) of tasks completed. Empty input yields 100 (vacuous). */
  public calculateTaskCompletionRate(tasks: Task[]): number {
    if (tasks.length === 0) {
      return 100;
    }
    const completed = tasks.filter((task) => task.status === 'Completed').length;
    return (completed / tasks.length) * 100;
  }

  /** Percentage (0-100) of milestones completed. Empty input yields 100 (vacuous). */
  public calculateMilestoneCompletionRate(milestones: Milestone[]): number {
    if (milestones.length === 0) {
      return 100;
    }
    const completed = milestones.filter((milestone) => milestone.status === 'Completed').length;
    return (completed / milestones.length) * 100;
  }

  /** Number of tasks + milestones that are past due and not yet completed. */
  public countOverdueItems(tasks: Task[], milestones: Milestone[], now: Date = new Date()): number {
    const overdueTasks = tasks.filter((task) => isOverdue(task.status, task.dueDate, now)).length;
    const overdueMilestones = milestones.filter((milestone) =>
      isOverdue(milestone.status, milestone.dueDate, now),
    ).length;
    return overdueTasks + overdueMilestones;
  }

  /** Maps a 0-100 score to a status using the named thresholds. */
  public determineStatus(score: number): HealthStatus {
    if (score >= THRESHOLDS.HEALTHY_MIN) {
      return 'Healthy';
    }
    if (score >= THRESHOLDS.AT_RISK_MIN) {
      return 'At Risk';
    }
    return 'Critical';
  }

  /** Budget sub-score (0-100), or null when budget data is absent/invalid. */
  public calculateBudgetVarianceScore(project: Project): number | null {
    const { budget, actualCost } = project;
    if (typeof budget !== 'number' || typeof actualCost !== 'number' || budget <= 0) {
      return null;
    }
    const variance = (actualCost - budget) / budget;
    if (variance <= 0) {
      return 100;
    }
    return clampPercent(100 - variance * 100 * BUDGET_PENALTY_PER_PERCENT);
  }

  private buildGuidance(
    project: Project,
    taskRate: number,
    milestoneRate: number,
    overdueCount: number,
  ): { issues: string[]; recommendations: string[] } {
    const issues: string[] = [];
    const recommendations: string[] = [];

    if (taskRate < WEAK_COMPLETION_THRESHOLD) {
      issues.push(`Task completion is low (${Math.round(taskRate)}%).`);
      recommendations.push('Review remaining tasks and close out quick wins or reassign blockers.');
    }
    if (milestoneRate < WEAK_COMPLETION_THRESHOLD) {
      issues.push(`Milestone completion is low (${Math.round(milestoneRate)}%).`);
      recommendations.push(
        'Re-baseline milestone dates and confirm owners for incomplete milestones.',
      );
    }
    if (overdueCount > 0) {
      issues.push(`${overdueCount} overdue item(s) require attention.`);
      recommendations.push('Prioritize overdue work and adjust the schedule to reflect slippage.');
    }
    if (
      typeof project.budget === 'number' &&
      typeof project.actualCost === 'number' &&
      project.budget > 0 &&
      project.actualCost > project.budget
    ) {
      const variancePct = ((project.actualCost - project.budget) / project.budget) * 100;
      issues.push(`The project is ${variancePct.toFixed(0)}% over budget.`);
      recommendations.push('Review actual costs against budget and control remaining spend.');
    }

    return { issues, recommendations };
  }
}

/**
 * Resolves the effective score weights. When budget data is absent, the budget
 * component is dropped and its weight redistributed proportionally.
 */
function resolveWeights(hasBudget: boolean): {
  task: number;
  milestone: number;
  overdue: number;
  budget: number;
} {
  if (hasBudget) {
    return {
      task: WEIGHTS.TASK_COMPLETION,
      milestone: WEIGHTS.MILESTONE_COMPLETION,
      overdue: WEIGHTS.OVERDUE,
      budget: WEIGHTS.BUDGET_VARIANCE,
    };
  }
  const remaining = WEIGHTS.TASK_COMPLETION + WEIGHTS.MILESTONE_COMPLETION + WEIGHTS.OVERDUE;
  return {
    task: WEIGHTS.TASK_COMPLETION / remaining,
    milestone: WEIGHTS.MILESTONE_COMPLETION / remaining,
    overdue: WEIGHTS.OVERDUE / remaining,
    budget: 0,
  };
}
