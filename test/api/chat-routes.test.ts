import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it, jest } from '@jest/globals';
import express, { type Express } from 'express';
import { mountChatRoutes } from '../../src/api/chat-routes';
import {
  createBearerAuthenticator,
  createHmacTokenVerifier,
  signHmacToken,
} from '../../src/api/mcp-http-server';
import { SlidingWindowRateLimiter } from '../../src/api/rate-limiter';
import type { ChatAgent } from '../../src/llm/agent';

const SECRET = 'test-secret';
const token = signHmacToken(SECRET, { sub: 'alice', exp: Date.now() / 1000 + 60 });

type Chat = ChatAgent['chat'];
type ChatStream = ChatAgent['chatStream'];

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

function makeApp(agent: Pick<ChatAgent, 'chat' | 'chatStream'>): Express {
  const app = express();
  app.use(express.json());
  mountChatRoutes(app, {
    agent,
    authenticate: createBearerAuthenticator(createHmacTokenVerifier(SECRET)),
    rateLimiter: new SlidingWindowRateLimiter(100, 60_000),
  });
  return app;
}

function parseSseEvents(body: string): Array<Record<string, unknown>> {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((raw) => JSON.parse(raw.replace(/^data: /, '')));
}

describe('mountChatRoutes', () => {
  it('returns { reply } when stream is not requested', async () => {
    const agent = {
      chat: jest.fn<Chat>().mockResolvedValue('hello'),
      chatStream: jest.fn<ChatStream>(),
    };
    const server = await start(makeApp(agent));
    try {
      const res = await fetch(`${server.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ reply: 'hello' });
      expect(agent.chatStream).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('streams SSE events when stream: true is requested', async () => {
    const agent = {
      chat: jest.fn<Chat>(),
      chatStream: jest
        .fn<ChatStream>()
        .mockImplementation(async (_history, _userId, onContent, onStatus) => {
          onStatus?.('Calling list_projects…');
          onContent('Hel');
          onContent('lo');
          return 'Hello';
        }),
    };
    const server = await start(makeApp(agent));
    try {
      const res = await fetch(`${server.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      expect(parseSseEvents(await res.text())).toEqual([
        { type: 'status', text: 'Calling list_projects…' },
        { type: 'content', text: 'Hel' },
        { type: 'content', text: 'lo' },
        { type: 'done', reply: 'Hello' },
      ]);
      expect(agent.chat).not.toHaveBeenCalled();
    } finally {
      await server.close();
    }
  });

  it('emits an error event when the agent fails mid-stream', async () => {
    const agent = {
      chat: jest.fn<Chat>(),
      chatStream: jest.fn<ChatStream>().mockRejectedValue(new Error('boom')),
    };
    const server = await start(makeApp(agent));
    try {
      const res = await fetch(`${server.url}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('{"type":"error","message":"boom"}');
    } finally {
      await server.close();
    }
  });
});
