/** Explainable calendar-day progress extrapolation; not a trained probability model. */
export interface ProgressSnapshot {
  projectId: string;
  capturedAt: string;
  percentComplete: number | null;
  plannedFinish: string | null;
}
export interface DelayPrediction {
  projectId: string;
  status:
    | 'completed'
    | 'insufficient_history'
    | 'stalled'
    | 'at_risk'
    | 'on_track'
    | 'overdue'
    | 'no_baseline';
  predictedFinish: string | null;
  delayDays: number | null;
  progressPerDay: number | null;
  observations: number;
  historyDays: number;
  explanation: string;
}
const DAY = 86400000;
export function predictDelay(
  projectId: string,
  history: ProgressSnapshot[],
  now: Date,
): DelayPrediction {
  const byDay = new Map<string, ProgressSnapshot>();
  for (const row of [...history].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))) {
    if (
      row.projectId !== projectId ||
      !Number.isFinite(Date.parse(row.capturedAt)) ||
      Date.parse(row.capturedAt) > now.getTime() ||
      row.percentComplete === null ||
      !Number.isFinite(row.percentComplete) ||
      row.percentComplete < 0 ||
      row.percentComplete > 100
    )
      continue;
    byDay.set(row.capturedAt.slice(0, 10), row);
  }
  let rows = [...byDay.values()];
  const latest = rows[rows.length - 1];
  // A revised schedule or a progress reset starts a new forecasting window.
  for (let i = rows.length - 1; i > 0; i--) {
    if (
      rows[i]!.plannedFinish !== rows[i - 1]!.plannedFinish ||
      rows[i]!.percentComplete! < rows[i - 1]!.percentComplete!
    ) {
      rows = rows.slice(i);
      break;
    }
  }
  const span = rows.length
    ? (Date.parse(rows[rows.length - 1]!.capturedAt) - Date.parse(rows[0]!.capturedAt)) / DAY
    : 0;
  const base: DelayPrediction = {
    projectId,
    status: 'insufficient_history',
    predictedFinish: null,
    delayDays: null,
    progressPerDay: null,
    observations: rows.length,
    historyDays: Math.round(span * 10) / 10,
    explanation: 'At least three daily observations over two calendar days are required.',
  };
  if (!latest) return base;
  if (latest.percentComplete === 100)
    return {
      ...base,
      status: 'completed',
      explanation: 'Published progress is 100%; no delay forecast is needed.',
    };
  const finish = latest.plannedFinish ? Date.parse(latest.plannedFinish) : NaN;
  const overdue = Number.isFinite(finish) && finish < now.getTime();
  if (now.getTime() - Date.parse(latest.capturedAt) > 2 * DAY)
    return {
      ...base,
      explanation:
        'Latest progress is older than two days. Refresh observations before forecasting.',
    };
  if (rows.length < 3 || span < 2)
    return {
      ...base,
      status: overdue ? 'overdue' : 'insufficient_history',
      explanation: overdue
        ? 'Published finish is past and progress is incomplete. Insufficient history to forecast a finish.'
        : base.explanation,
    };
  const origin = Date.parse(rows[0]!.capturedAt);
  const xs = rows.map((r) => (Date.parse(r.capturedAt) - origin) / DAY);
  const ys = rows.map((r) => r.percentComplete!);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length,
    my = ys.reduce((a, b) => a + b, 0) / ys.length;
  const slope =
    xs.reduce((v, x, i) => v + (x - mx) * (ys[i]! - my), 0) /
    xs.reduce((v, x) => v + (x - mx) ** 2, 0);
  if (slope <= 0.001)
    return {
      ...base,
      status: overdue ? 'overdue' : 'stalled',
      progressPerDay: 0,
      explanation:
        'No measurable progress across the observation window. A finish date cannot be extrapolated.',
    };
  const remaining = (100 - latest.percentComplete!) / slope;
  if (remaining > 3650)
    return {
      ...base,
      status: 'stalled',
      explanation: 'Observed progress is too slow for a useful bounded finish forecast.',
    };
  const forecast = new Date(now.getTime() + remaining * DAY);
  const delay = Number.isFinite(finish)
    ? Math.max(0, Math.ceil((forecast.getTime() - finish) / DAY))
    : null;
  return {
    ...base,
    status: overdue
      ? 'overdue'
      : !Number.isFinite(finish)
        ? 'no_baseline'
        : delay! > 0
          ? 'at_risk'
          : 'on_track',
    predictedFinish: forecast.toISOString(),
    delayDays: delay,
    progressPerDay: Math.round(slope * 100) / 100,
    explanation:
      'Linear extrapolation of observed progress per calendar day. Assumes the recent rate continues; excludes calendars, dependencies, resource limits and scope changes. This is not a probability or a trained ML prediction.',
  };
}
