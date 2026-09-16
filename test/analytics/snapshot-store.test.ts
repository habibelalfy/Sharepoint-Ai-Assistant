import { describe, it, expect } from '@jest/globals';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SnapshotStore } from '../../src/analytics/snapshot-store';
describe('SnapshotStore', () => {
  it('persists across instances and serializes overlapping captures without duplicate days', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'progress-'));
    try {
      const path = join(dir, 'history.json'),
        now = new Date('2026-09-15T12:00:00Z');
      const row = {
        projectId: 'p',
        capturedAt: now.toISOString(),
        percentComplete: 20,
        plannedFinish: null,
      };
      await Promise.all([
        new SnapshotStore(path).record([row], now),
        new SnapshotStore(path).record([{ ...row, projectId: 'q' }], now),
      ]);
      const history = await new SnapshotStore(path).record([{ ...row, percentComplete: 30 }], now);
      expect(history).toHaveLength(2);
      expect(history.find((r) => r.projectId === 'p')!.percentComplete).toBe(30);
      const later = new Date('2026-09-15T13:00:00Z');
      await new SnapshotStore(path).record(
        [{ ...row, capturedAt: later.toISOString(), percentComplete: 40 }],
        later,
      );
      const outOfOrder = await new SnapshotStore(path).record([row], now);
      expect(outOfOrder.find((r) => r.projectId === 'p')!.percentComplete).toBe(40);
      await writeFile(path, 'corrupt');
      await expect(new SnapshotStore(path).record([], now)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
