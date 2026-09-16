import { SharePointError } from '../../src/errors';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, jest } from '@jest/globals';
import type { Express } from 'express';
import {
  createBearerAuthenticator,
  createGateway,
  createHeaderAuthenticator,
  createHmacTokenVerifier,
  signHmacToken,
} from '../../src/api/mcp-http-server';
import { SlidingWindowRateLimiter } from '../../src/api/rate-limiter';
import { NoopAuditService } from '../../src/services/audit-service';

const SECRET = 'test-secret';

function start(app: Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = createServer(app);
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

function makeApp(
  callTool: (n: string, a: Record<string, unknown>) => Promise<unknown>,
  maxRequests: number,
  audit = new NoopAuditService(),
): Express {
  return createGateway({
    callTool,
    authenticate: createBearerAuthenticator(createHmacTokenVerifier(SECRET)),
    rateLimiter: new SlidingWindowRateLimiter(maxRequests, 60_000),
    audit,
  });
}

describe('createGateway', () => {
  it('still returns JSON 401 when security auditing fails', async () => {
    const audit = new NoopAuditService();
    jest.spyOn(audit, 'logSecurityEvent').mockRejectedValue(new Error('Audit storage unavailable'));
    const server = await start(makeApp(async () => undefined, 10, audit));
    try {
      const res = await fetch(`${server.url}/api/mcp/tool`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    } finally {
      await server.close();
    }
  });
  it('validates browser sessions without granting anonymous access', async () => {
    const server = await start(makeApp(async () => undefined, 10));
    try {
      expect((await fetch(`${server.url}/api/session`)).status).toBe(401);
      const token = signHmacToken(SECRET, { sub: 'alice', exp: Date.now() / 1000 + 60 });
      const res = await fetch(`${server.url}/api/session`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ userId: 'alice' });
      expect(res.headers.get('cache-control')).toBe('no-store');
    } finally {
      await server.close();
    }
  });
  it('accepts all setup fields without returning the submitted secrets', async () => {
    const configure = jest.fn(async (input: unknown) => {
      expect(input).toBeDefined();
      return { userId: 'alice', accessToken: 'session-token' };
    });
    const app = createGateway({
      callTool: async () => undefined,
      authenticate: createBearerAuthenticator(createHmacTokenVerifier(SECRET)),
      rateLimiter: new SlidingWindowRateLimiter(10, 60_000),
      audit: new NoopAuditService(),
      configure,
    });
    const server = await start(app);
    try {
      const res = await fetch(`${server.url}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharePointUrl: 'http://sharepoint/PWA/',
          username: 'DOMAIN\\alice',
          password: 'sharepoint-secret',
          llmUrl: 'https://llm.example/v1/',
          llmKey: 'llm-secret',
          modelName: 'deepseek-chat',
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ userId: 'alice', accessToken: 'session-token' });
      expect(configure).toHaveBeenCalledWith({
        sharePointUrl: 'http://sharepoint/PWA',
        username: 'DOMAIN\\alice',
        password: 'sharepoint-secret',
        llmUrl: 'https://llm.example/v1',
        llmKey: 'llm-secret',
        modelName: 'deepseek-chat',
      });
    } finally {
      await server.close();
    }
  });
  it('returns a generic setup error and does not expose an upstream secret', async () => {
    const app = createGateway({
      callTool: async () => undefined,
      authenticate: createBearerAuthenticator(createHmacTokenVerifier(SECRET)),
      rateLimiter: new SlidingWindowRateLimiter(10, 60_000),
      audit: new NoopAuditService(),
      configure: async (input) => {
        throw new Error(`NTLM rejected ${input.password}`);
      },
    });
    const server = await start(app);
    try {
      const res = await fetch(`${server.url}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharePointUrl: 'http://sharepoint/PWA',
          username: 'DOMAIN\\alice',
          password: 'never-return-this',
          llmUrl: 'https://llm.example/v1',
          llmKey: 'also-secret',
          modelName: 'deepseek-chat',
        }),
      });
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toContain('Connection failed');
      expect(text).not.toContain('never-return-this');
      expect(text).not.toContain('also-secret');
    } finally {
      await server.close();
    }
  });
  it('reports server outages separately from credential failures without exposing secrets', async () => {
    const app = createGateway({
      callTool: async () => undefined,
      authenticate: createBearerAuthenticator(createHmacTokenVerifier(SECRET)),
      rateLimiter: new SlidingWindowRateLimiter(10, 60_000),
      audit: new NoopAuditService(),
      configure: async (input) => {
        throw new SharePointError(`Server failed ${input.password}`, 500, undefined);
      },
    });
    const server = await start(app);
    try {
      const res = await fetch(`${server.url}/api/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sharePointUrl: 'http://sharepoint/PWA',
          username: 'DOMAIN\\alice',
          password: 'never-return-this',
          llmUrl: 'https://llm.example/v1',
          llmKey: 'also-secret',
          modelName: 'deepseek-chat',
        }),
      });
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).toContain('temporarily unavailable');
      expect(text).not.toContain('never-return-this');
      expect(text).not.toContain('also-secret');
    } finally {
      await server.close();
    }
  });
  it('forwards an authenticated tool call and injects userId', async () => {
    const callTool = jest
      .fn<(n: string, a: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue({ id: 1 });
    const app = makeApp(callTool, 10);
    const server = await start(app);

    const token = signHmacToken(SECRET, { sub: 'alice' });
    const res = await fetch(`${server.url}/api/mcp/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ toolName: 'query_project_data', args: { listName: 'Projects' } }),
    });

    expect(res.status).toBe(200);
    expect(((await res.json()) as { result: unknown }).result).toEqual({ id: 1 });
    expect(callTool).toHaveBeenCalledWith('query_project_data', {
      listName: 'Projects',
      userId: 'alice',
    });
    await server.close();
  });

  it('rejects a request without a valid token and logs a security event', async () => {
    const callTool = jest.fn<(n: string, a: Record<string, unknown>) => Promise<unknown>>();
    const audit = new NoopAuditService();
    const spy = jest.spyOn(audit, 'logSecurityEvent');
    const app = makeApp(callTool, 10, audit);
    const server = await start(app);

    const res = await fetch(`${server.url}/api/mcp/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toolName: 'x', args: {} }),
    });

    expect(res.status).toBe(401);
    expect(callTool).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ eventType: 'AUTH_FAILURE' }));
    await server.close();
  });

  it('rate-limits requests per user', async () => {
    const callTool = jest
      .fn<(n: string, a: Record<string, unknown>) => Promise<unknown>>()
      .mockResolvedValue('ok');
    const app = makeApp(callTool, 1);
    const server = await start(app);

    const token = signHmacToken(SECRET, { sub: 'alice' });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    const body = JSON.stringify({ toolName: 'x', args: {} });

    const first = await fetch(`${server.url}/api/mcp/tool`, { method: 'POST', headers, body });
    const second = await fetch(`${server.url}/api/mcp/tool`, { method: 'POST', headers, body });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    await server.close();
  });

  it('rejects non-object args with 400', async () => {
    const callTool = jest.fn<(n: string, a: Record<string, unknown>) => Promise<unknown>>();
    const app = makeApp(callTool, 10);
    const server = await start(app);

    const token = signHmacToken(SECRET, { sub: 'alice' });
    const res = await fetch(`${server.url}/api/mcp/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ toolName: 'x', args: 'not-an-object' }),
    });

    expect(res.status).toBe(400);
    expect(callTool).not.toHaveBeenCalled();
    await server.close();
  });

  it('returns 500 when the tool handler throws', async () => {
    const callTool = jest
      .fn<(n: string, a: Record<string, unknown>) => Promise<unknown>>()
      .mockRejectedValue(new Error('boom'));
    const app = makeApp(callTool, 10);
    const server = await start(app);

    const token = signHmacToken(SECRET, { sub: 'alice' });
    const res = await fetch(`${server.url}/api/mcp/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ toolName: 'x', args: {} }),
    });

    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('boom');
    await server.close();
  });

  it('exposes an unauthenticated health-check endpoint', async () => {
    const app = makeApp(jest.fn<(n: string, a: Record<string, unknown>) => Promise<unknown>>(), 10);
    const server = await start(app);

    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('ok');
    await server.close();
  });
});

describe('createHeaderAuthenticator', () => {
  it('returns the configured header value as the userId', () => {
    const authenticate = createHeaderAuthenticator('X-SharePoint-User');
    const req = {
      headers: { 'x-sharepoint-user': 'CORP\\alice' },
    } as unknown as Parameters<typeof authenticate>[0];
    expect(authenticate(req)).toEqual({ userId: 'CORP\\alice' });
  });

  it('returns null when the header is absent', () => {
    const authenticate = createHeaderAuthenticator('X-SharePoint-User');
    const req = { headers: {} } as unknown as Parameters<typeof authenticate>[0];
    expect(authenticate(req)).toBeNull();
  });
});

describe('createHmacTokenVerifier', () => {
  it('accepts a valid token and rejects a tampered one', () => {
    const verify = createHmacTokenVerifier(SECRET);
    const token = signHmacToken(SECRET, { sub: 'alice' });
    expect(verify(token)).toBe('alice');
    expect(verify(`${token}x`)).toBeNull();
  });

  it('rejects expired tokens', () => {
    const verify = createHmacTokenVerifier(SECRET);
    const token = signHmacToken(SECRET, { sub: 'alice', exp: 1 });
    expect(verify(token)).toBeNull();
  });
});
