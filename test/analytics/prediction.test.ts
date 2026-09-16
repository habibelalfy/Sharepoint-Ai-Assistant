import { describe, it, expect } from '@jest/globals';
import { predictDelay, type ProgressSnapshot } from '../../src/analytics/prediction';
const now = new Date('2026-09-15T12:00:00Z');
const rows = (values: number[], finish = '2026-09-16T12:00:00Z'): ProgressSnapshot[] =>
  values.map((p, i) => ({
    projectId: 'p',
    capturedAt: new Date(now.getTime() - (values.length - 1 - i) * 86400000).toISOString(),
    percentComplete: p,
    plannedFinish: finish,
  }));
describe('predictDelay', () => {
  it('requires real daily history and does not treat repeated refreshes as observations', () => {
    const history = rows([20]);
    expect(predictDelay('p', [...history, ...history, ...history], now)).toMatchObject({
      status: 'insufficient_history',
      observations: 1,
      predictedFinish: null,
    });
  });
  it('extrapolates a known rate and warning without inventing a probability', () => {
    expect(predictDelay('p', rows([10, 20, 30]), now)).toMatchObject({
      status: 'at_risk',
      progressPerDay: 10,
      delayDays: 6,
      predictedFinish: '2026-09-22T12:00:00.000Z',
    });
    expect(predictDelay('p', rows([10, 20, 30], '2026-10-01T12:00:00Z'), now).status).toBe(
      'on_track',
    );
  });
  it('reports completed, stalled, overdue, and unknown baselines honestly', () => {
    expect(predictDelay('p', rows([100]), now).status).toBe('completed');
    expect(predictDelay('p', rows([10, 10, 10]), now)).toMatchObject({
      status: 'stalled',
      predictedFinish: null,
    });
    expect(predictDelay('p', rows([10], '2026-09-14T12:00:00Z'), now).status).toBe('overdue');
    expect(
      predictDelay(
        'p',
        rows([10, 20, 30]).map((r) => ({ ...r, plannedFinish: null })),
        now,
      ).status,
    ).toBe('no_baseline');
  });
  it('resets the model window for scope or baseline revisions and refuses stale or other-project data', () => {
    expect(predictDelay('p', rows([60, 70, 10]), now).status).toBe('insufficient_history');
    const h = rows([10, 20, 30]);
    h[2]!.plannedFinish = '2026-10-10T00:00:00Z';
    expect(predictDelay('p', h, now).observations).toBe(1);
    expect(predictDelay('other', rows([10, 20, 30]), now).observations).toBe(0);
    expect(
      predictDelay('p', rows([10, 20, 30]), new Date('2026-10-01')).predictedFinish,
    ).toBeNull();
  });
});
