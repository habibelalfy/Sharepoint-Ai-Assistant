import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProgressSnapshot } from './prediction';
/** One process, atomic durable file replacement; latest observation per project/UTC day. */
export class SnapshotStore {
  private static queues = new Map<string, Promise<unknown>>();
  constructor(private readonly path: string) {}
  async record(incoming: ProgressSnapshot[], now: Date): Promise<ProgressSnapshot[]> {
    const previous = SnapshotStore.queues.get(this.path) ?? Promise.resolve();
    const job = previous
      .catch(() => undefined)
      .then(async () => {
        let rows: ProgressSnapshot[] = [];
        try {
          const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'));
          if (
            !Array.isArray(parsed) ||
            parsed.some(
              (r) =>
                !r ||
                typeof r.projectId !== 'string' ||
                typeof r.capturedAt !== 'string' ||
                !Number.isFinite(Date.parse(r.capturedAt)) ||
                !(
                  r.percentComplete === null ||
                  (typeof r.percentComplete === 'number' &&
                    Number.isFinite(r.percentComplete) &&
                    r.percentComplete >= 0 &&
                    r.percentComplete <= 100)
                ) ||
                !(r.plannedFinish === null || typeof r.plannedFinish === 'string'),
            )
          )
            throw new Error(
              'Invalid progress history; forecasting stopped to avoid corrupt predictions.',
            );
          rows = parsed as ProgressSnapshot[];
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        const cutoff = now.getTime() - 120 * 86400000;
        const days = new Map<string, ProgressSnapshot>();
        for (const row of [...rows, ...incoming].sort((a, b) =>
          a.capturedAt.localeCompare(b.capturedAt),
        )) {
          // A slower capture may finish after a newer one; retain the newest stored row.
          if (Date.parse(row.capturedAt) >= cutoff)
            days.set(row.projectId + ':' + row.capturedAt.slice(0, 10), row);
        }
        const result = [...days.values()];
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        const temp = this.path + '.' + randomUUID() + '.tmp';
        await writeFile(temp, JSON.stringify(result), { mode: 0o600 });
        await rename(temp, this.path);
        return result;
      });
    SnapshotStore.queues.set(this.path, job);
    try {
      return await job;
    } finally {
      if (SnapshotStore.queues.get(this.path) === job) SnapshotStore.queues.delete(this.path);
    }
  }
}
