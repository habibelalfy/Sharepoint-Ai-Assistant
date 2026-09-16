import { describe, it, expect } from '@jest/globals';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { mountAnalyticsRoutes, reportEmbedUrl } from '../../src/api/analytics-routes';
import { SlidingWindowRateLimiter } from '../../src/api/rate-limiter';
describe('analytics routes', () => {
  it('validates Report Server embed configuration', () => {
    expect(reportEmbedUrl()).toBeNull();
    expect(reportEmbedUrl('https://reports/reports/powerbi/P?x=1')).toContain('rs%3Aembed=true');
    expect(() => reportEmbedUrl('javascript:alert(1)')).toThrow();
    expect(() => reportEmbedUrl('https://user:secret@reports/')).toThrow();
  });
  it('requires auth, separates refresh credentials, and redacts failures', async () => {
    const app = express();
    let fail = false;
    mountAnalyticsRoutes(app, {
      authenticate: (req) =>
        req.headers.authorization === 'Bearer test' ? { userId: 'alice' } : null,
      rateLimiter: new SlidingWindowRateLimiter(100, 60000),
      dataset: async (u) => {
        if (fail) throw new Error('secret');
        return { user: u };
      },
      powerBiToken: 'x'.repeat(32),
      powerBiDataset: async () => ({ scope: 'server-configured' }),
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
    try {
      expect((await fetch(base + '/api/analytics/dataset')).status).toBe(401);
      const h = { Authorization: 'Bearer test' };
      expect(await (await fetch(base + '/api/analytics/dataset', { headers: h })).json()).toEqual({
        user: 'alice',
      });
      const basic = {
        Authorization: 'Basic ' + Buffer.from('powerbi:' + 'x'.repeat(32)).toString('base64'),
      };
      expect(
        await (await fetch(base + '/api/analytics/dataset', { headers: basic })).json(),
      ).toEqual({ scope: 'server-configured' });
      expect((await fetch(base + '/api/analytics/config', { headers: basic })).status).toBe(401);
      fail = true;
      const response = await fetch(base + '/api/analytics/dataset', { headers: h });
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain('secret');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  });
});
