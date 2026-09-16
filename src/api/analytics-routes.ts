import type { Express } from 'express';
import { timingSafeEqual } from 'node:crypto';
import type { Authenticator } from './mcp-http-server';
import type { SlidingWindowRateLimiter } from './rate-limiter';
export function reportEmbedUrl(raw?: string): string | null {
  if (!raw?.trim()) return null;
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error(
      'POWER_BI_REPORT_URL must be an HTTP(S) report URL without credentials or a fragment.',
    );
  url.searchParams.set('rs:embed', 'true');
  return url.href;
}
export function mountAnalyticsRoutes(
  app: Express,
  options: {
    authenticate: Authenticator;
    rateLimiter: SlidingWindowRateLimiter;
    dataset: (userId: string) => Promise<unknown>;
    reportUrl?: string;
    powerBiToken?: string;
    powerBiDataset?: () => Promise<unknown>;
  },
) {
  const embedUrl = reportEmbedUrl(options.reportUrl);
  if (options.powerBiToken && options.powerBiToken.length < 32)
    throw new Error('POWER_BI_DATASET_TOKEN must contain at least 32 characters.');
  app.get('/api/analytics/config', (req, res) => {
    if (!options.authenticate(req)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    res.set('Cache-Control', 'no-store').json({ embedUrl, configured: !!embedUrl });
  });
  app.get('/api/analytics/dataset', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const identity = options.authenticate(req);
    let powerBi = false;
    const auth = req.headers.authorization;
    if (
      !identity &&
      options.powerBiToken &&
      options.powerBiDataset &&
      auth?.startsWith('Basic ') &&
      auth.length < 8192
    ) {
      const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
      const expected = Buffer.from('powerbi:' + options.powerBiToken);
      const actual = Buffer.from(decoded);
      powerBi = actual.length === expected.length && timingSafeEqual(actual, expected);
    }
    if (!identity && !powerBi) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!options.rateLimiter.allow('analytics:' + (identity?.userId ?? 'powerbi'))) {
      res.status(429).json({ error: 'rate limit exceeded' });
      return;
    }
    try {
      res.json(powerBi ? await options.powerBiDataset!() : await options.dataset(identity!.userId));
    } catch {
      res
        .status(502)
        .json({
          error:
            'Reporting data could not be refreshed. Check Project Server availability. No partial dataset was returned.',
        });
    }
  });
}
