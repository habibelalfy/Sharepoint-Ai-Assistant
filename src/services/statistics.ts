/**
 * Project statistics: progress counts and estimated completion.
 *
 * Pure business logic over already-fetched tasks and milestones.
 *
 * @module services/statistics
 */
import type { Milestone, Task } from '../types/models';
import { isOverdue } from './shared';

export interface ProjectStatistics {
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  totalMilestones: number;
  completedMilestones: number;
  overallProgress: number;
  estimatedCompletionDate: string | null;
}

export function computeProjectStatistics(
  tasks: Task[],
  milestones: Milestone[],
  now: Date = new Date(),
): ProjectStatistics {
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.status === 'Completed').length;
  const overdueTasks = tasks.filter((task) => isOverdue(task.status, task.dueDate, now)).length;

  const totalMilestones = milestones.length;
  const completedMilestones = milestones.filter(
    (milestone) => milestone.status === 'Completed',
  ).length;

  const overallProgress = Math.round(
    (completionRate(completedTasks, totalTasks) +
      completionRate(completedMilestones, totalMilestones)) /
      2,
  );

  return {
    totalTasks,
    completedTasks,
    overdueTasks,
    totalMilestones,
    completedMilestones,
    overallProgress,
    estimatedCompletionDate: estimateCompletion(tasks, now),
  };
}

function completionRate(completed: number, total: number): number {
  return total === 0 ? 100 : (completed / total) * 100;
}

/**
 * Estimates completion as the latest due date among remaining (incomplete)
 * tasks, floored at `now` (overdue work cannot finish in the past). Returns
 * null when no tasks remain. Velocity is approximated by the remaining
 * schedule because the task schema has no completion timestamps.
 */
function estimateCompletion(tasks: Task[], now: Date): string | null {
  const remaining = tasks.filter((task) => task.status !== 'Completed').filter(hasDueDate);
  if (remaining.length === 0) {
    return null;
  }
  let latest = now.getTime();
  for (const task of remaining) {
    const due = new Date(task.dueDate);
    if (!Number.isNaN(due.getTime())) {
      latest = Math.max(latest, due.getTime());
    }
  }
  return new Date(latest).toISOString();
}

function hasDueDate(task: Task): task is Task & { dueDate: string } {
  return typeof task.dueDate === 'string' && task.dueDate !== '';
}
