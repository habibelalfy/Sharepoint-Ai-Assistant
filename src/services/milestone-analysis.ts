/**
 * Milestone delay / cascading-impact analysis.
 *
 * Pure business logic over already-fetched milestones and tasks. A milestone's
 * `dependencies` array lists the milestones it depends on (prerequisites), so a
 * delay in one milestone cascades forward to every milestone that depends on it.
 *
 * @module services/milestone-analysis
 */
import type { Milestone, Task } from '../types/models';
import { ValidationError } from '../errors';
import { addDays } from './shared';

/** A milestone whose due date has been shifted by a delay. */
export interface DateAdjustment {
  milestoneId: string;
  title: string;
  originalDueDate: string | null;
  adjustedDueDate: string | null;
}

export interface DelayImpactAnalysis {
  directImpacts: DateAdjustment[];
  cascadingImpacts: DateAdjustment[];
  totalProjectDelay: number;
  criticalPathAffected: boolean;
  recommendedActions: string[];
}

export class MilestoneDelayAnalysisService {
  /**
   * Analyzes the ripple effect of delaying a milestone by `delayDays`.
   *
   * @param milestoneId - ID of the delayed milestone.
   * @param delayDays - Whole days of delay (positive).
   * @param allMilestones - Full milestone set (for dependency traversal).
   * @param tasks - Full task set (used only to shape recommendations).
   * @throws {ValidationError} If the milestone is unknown or the graph is cyclic.
   */
  public analyzeDelayImpact(
    milestoneId: string,
    delayDays: number,
    allMilestones: Milestone[],
    tasks: Task[],
  ): DelayImpactAnalysis {
    const target = allMilestones.find((milestone) => String(milestone.id) === milestoneId);
    if (!target) {
      throw new ValidationError(`Milestone not found: "${milestoneId}"`);
    }
    detectCircularDependency(allMilestones);

    const allAdjustments = this.calculateCascadingDates(milestoneId, delayDays, allMilestones);
    const directIds = new Set(
      directSuccessors(milestoneId, allMilestones).map((m) => String(m.id)),
    );

    const directImpacts = allAdjustments.filter((a) => directIds.has(a.milestoneId));
    const cascadingImpacts = allAdjustments.filter(
      (a) => a.milestoneId !== milestoneId && !directIds.has(a.milestoneId),
    );
    const impactedCount = directImpacts.length + cascadingImpacts.length;

    return {
      directImpacts,
      cascadingImpacts,
      totalProjectDelay: delayDays,
      criticalPathAffected: computeCriticalPath(allMilestones).has(milestoneId),
      recommendedActions: buildRecommendations(target, delayDays, impactedCount, tasks),
    };
  }

  /**
   * Returns the prerequisite chain of `milestoneId`: every milestone it
   * transitively depends on, ordered from earliest prerequisite to nearest.
   *
   * @throws {ValidationError} If a circular dependency is encountered.
   */
  public getDependencyChain(milestoneId: string, allMilestones: Milestone[]): string[] {
    const result: string[] = [];
    const visiting = new Set<string>();

    const visit = (id: string): void => {
      if (visiting.has(id)) {
        throw new ValidationError(`Circular dependency detected at milestone "${id}"`);
      }
      if (result.includes(id)) {
        return;
      }
      const milestone = allMilestones.find((m) => String(m.id) === id);
      if (!milestone) {
        return; // unknown dependency reference — treat as a leaf
      }
      visiting.add(id);
      for (const dep of milestone.dependencies ?? []) {
        visit(String(dep.id));
      }
      visiting.delete(id);
      result.push(id);
    };

    visit(milestoneId);
    const selfIndex = result.lastIndexOf(milestoneId);
    if (selfIndex !== -1) {
      result.splice(selfIndex, 1);
    }
    return result;
  }

  /**
   * Returns due-date adjustments for the delayed milestone and all of its
   * transitive successors, in breadth-first order (target first).
   */
  public calculateCascadingDates(
    milestoneId: string,
    delayDays: number,
    milestones: Milestone[],
  ): DateAdjustment[] {
    const target = milestones.find((m) => String(m.id) === milestoneId);
    const ordered = target ? [target, ...collectSuccessors(milestoneId, milestones)] : [];
    return ordered.map((milestone) => toDateAdjustment(milestone, delayDays));
  }
}

/** All milestones that transitively depend on `milestoneId` (breadth-first). */
function collectSuccessors(milestoneId: string, milestones: Milestone[]): Milestone[] {
  const result: Milestone[] = [];
  const seen = new Set<string>([milestoneId]);
  const queue: string[] = [milestoneId];

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head] ?? '';
    for (const milestone of milestones) {
      const id = String(milestone.id);
      if (seen.has(id)) {
        continue;
      }
      const depends = (milestone.dependencies ?? []).some((d) => String(d.id) === current);
      if (depends) {
        seen.add(id);
        result.push(milestone);
        queue.push(id);
      }
    }
  }
  return result;
}

/** Milestones that directly depend on `milestoneId` (depth-1 successors). */
function directSuccessors(milestoneId: string, milestones: Milestone[]): Milestone[] {
  return milestones.filter((m) => (m.dependencies ?? []).some((d) => String(d.id) === milestoneId));
}

/** Builds a {@link DateAdjustment} for a milestone, shifting its due date. */
function toDateAdjustment(milestone: Milestone, delayDays: number): DateAdjustment {
  const original =
    milestone.dueDate && !Number.isNaN(new Date(milestone.dueDate).getTime())
      ? milestone.dueDate
      : null;
  return {
    milestoneId: String(milestone.id),
    title: milestone.title,
    originalDueDate: original,
    adjustedDueDate: original ? addDays(original, delayDays) : null,
  };
}

/** Throws if the dependency graph contains a cycle (iterative DFS, full graph). */
function detectCircularDependency(milestones: Milestone[]): void {
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (id: string): void => {
    const current = state.get(id);
    if (current === 'done') {
      return;
    }
    if (current === 'visiting') {
      throw new ValidationError(`Circular dependency detected at milestone "${id}"`);
    }
    state.set(id, 'visiting');
    const milestone = milestones.find((m) => String(m.id) === id);
    for (const dep of milestone?.dependencies ?? []) {
      visit(String(dep.id));
    }
    state.set(id, 'done');
  };

  for (const milestone of milestones) {
    visit(String(milestone.id));
  }
}

/** Returns the set of milestone IDs on the critical (longest) path. */
function computeCriticalPath(milestones: Milestone[]): Set<string> {
  const successors = new Map<string, string[]>();
  const prerequisites = new Map<string, string[]>();

  for (const milestone of milestones) {
    const id = String(milestone.id);
    successors.set(id, []);
    prerequisites.set(
      id,
      (milestone.dependencies ?? []).map((d) => String(d.id)),
    );
  }
  for (const milestone of milestones) {
    for (const dep of milestone.dependencies ?? []) {
      const depId = String(dep.id);
      const list = successors.get(depId) ?? [];
      list.push(String(milestone.id));
      successors.set(depId, list);
    }
  }

  const fromSource = new Map<string, number>();
  const toSink = new Map<string, number>();

  const computeFromSource = (id: string): number => {
    const cached = fromSource.get(id);
    if (cached !== undefined) {
      return cached;
    }
    let best = 1;
    for (const pre of prerequisites.get(id) ?? []) {
      best = Math.max(best, computeFromSource(pre) + 1);
    }
    fromSource.set(id, best);
    return best;
  };

  const computeToSink = (id: string): number => {
    const cached = toSink.get(id);
    if (cached !== undefined) {
      return cached;
    }
    let best = 1;
    for (const succ of successors.get(id) ?? []) {
      best = Math.max(best, computeToSink(succ) + 1);
    }
    toSink.set(id, best);
    return best;
  };

  for (const milestone of milestones) {
    computeFromSource(String(milestone.id));
    computeToSink(String(milestone.id));
  }

  let maxChain = 0;
  const chainLength = new Map<string, number>();
  for (const milestone of milestones) {
    const id = String(milestone.id);
    const length = (fromSource.get(id) ?? 0) + (toSink.get(id) ?? 0) - 1;
    chainLength.set(id, length);
    maxChain = Math.max(maxChain, length);
  }

  const critical = new Set<string>();
  for (const [id, length] of chainLength) {
    if (length === maxChain) {
      critical.add(id);
    }
  }
  return critical;
}

/** Generates concrete next-step actions for the delayed milestone. */
function buildRecommendations(
  target: Milestone,
  delayDays: number,
  impactedCount: number,
  tasks: Task[],
): string[] {
  const actions: string[] = [];
  if (impactedCount > 0) {
    actions.push(
      `Re-baseline ${impactedCount} dependent milestone(s) to absorb the ${delayDays}-day slip on "${target.title}".`,
    );
  }
  const openTasks = tasks.filter((task) => task.status !== 'Completed').length;
  if (openTasks > 0) {
    actions.push(`Notify the owners of ${openTasks} open task(s) whose schedule may be affected.`);
  }
  return actions;
}
