import type { ProjectServerClient } from '../sharepoint/project-server-client';
import { predictDelay } from './prediction';
import { SnapshotStore } from './snapshot-store';
export class ProjectAnalytics {
  private collecting?: Promise<
    ReturnType<ProjectAnalytics['assemble']> extends Promise<infer T> ? T : never
  >;
  constructor(
    private readonly client: ProjectServerClient,
    private readonly store: SnapshotStore,
    private readonly clock: () => Date = () => new Date(),
  ) {}
  dataset() {
    if (this.collecting) return this.collecting;
    const job = this.assemble();
    this.collecting = job;
    void job
      .finally(() => {
        if (this.collecting === job) this.collecting = undefined;
      })
      .catch(() => undefined);
    return job;
  }
  private async assemble() {
    const now = this.clock();
    const projects = await this.client.projects();
    const tasks: Array<{
      id: string;
      projectId: string;
      title: string;
      startDate: string | null;
      dueDate: string | null;
      percentComplete: number | null;
      isMilestone: boolean;
      status: string;
      overdue: boolean;
    }> = [];
    let index = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, projects.length) }, async () => {
        while (index < projects.length) {
          const p = projects[index++]!;
          for (const t of await this.client.tasks(p.id))
            tasks.push({
              id: t.id,
              projectId: p.id,
              title: t.title,
              startDate: t.startDate ?? null,
              dueDate: t.dueDate ?? null,
              percentComplete: t.percentComplete ?? null,
              isMilestone: t.isMilestone,
              status: t.status,
              overdue:
                t.percentComplete !== undefined &&
                t.percentComplete < 100 &&
                !!t.dueDate &&
                Date.parse(t.dueDate) < now.getTime(),
            });
        }
      }),
    );
    const snapshots = projects.map((p) => ({
      projectId: p.id,
      capturedAt: now.toISOString(),
      percentComplete: p.percentComplete ?? null,
      plannedFinish: p.endDate ?? null,
    }));
    const history = await this.store.record(snapshots, now);
    const ids = new Set(projects.map((p) => p.id));
    return {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      source: 'Published Project Server data; connected-account permissions',
      methodology:
        'Daily observed-progress linear extrapolation in calendar days; not a trained probability model. Minimum 3 daily observations over 2 days; 120-day retention.',
      projects: projects.map((p) => ({
        id: p.id,
        title: p.title,
        startDate: p.startDate ?? null,
        endDate: p.endDate ?? null,
        percentComplete: p.percentComplete ?? null,
        lastPublishedDate: p.lastPublishedDate ?? null,
      })),
      tasks: tasks.sort((a, b) => a.id.localeCompare(b.id)),
      predictions: projects.map((p) => {
        const prediction = predictDelay(p.id, p.percentComplete === undefined ? [] : history, now);
        if (
          p.percentComplete !== undefined &&
          p.percentComplete < 100 &&
          !tasks.some((t) => t.projectId === p.id)
        ) {
          return {
            ...prediction,
            title: p.title,
            status: 'no_baseline' as const,
            predictedFinish: null,
            delayDays: null,
            progressPerDay: null,
            explanation:
              'No published tasks were returned for this project. Its shell dates are not treated as a forecastable plan; draft tasks may exist.',
          };
        }
        return { ...prediction, title: p.title };
      }),
      history: history.filter((row) => ids.has(row.projectId)),
    };
  }
}
