/**
 * Chat endpoint + static chat UI for the HTTP gateway.
 *
 * @module api/chat-routes
 */
import express, { type Express, type Response } from 'express';
import path from 'node:path';
import type { ChatAgent } from '../llm/agent';
import type { ChatMessage } from '../llm/provider';
import type { Authenticator } from './mcp-http-server';
import type { SlidingWindowRateLimiter } from './rate-limiter';

export interface ChatRouteOptions {
  agent: Pick<ChatAgent, 'chat' | 'chatStream'>;
  authenticate: Authenticator;
  rateLimiter: SlidingWindowRateLimiter;
}

/** Mounts `POST /api/chat` and serves the chat UI at `/`. */
export function mountChatRoutes(app: Express, options: ChatRouteOptions): void {
  app.post('/api/chat', async (req, res) => {
    const identity = options.authenticate(req);
    if (!identity) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (!options.rateLimiter.allow(identity.userId)) {
      res.status(429).json({ error: 'rate limit exceeded' });
      return;
    }

    const body = (req.body ?? {}) as { messages?: unknown; stream?: unknown };
    const messages = parseMessages(body);
    if (messages === null) {
      res.status(400).json({ error: 'messages must be a non-empty array of { role, content }' });
      return;
    }

    // Opt-in streaming: the client sends `stream: true` and reads an SSE body.
    // Without it, the endpoint keeps returning `{ reply }` exactly as before.
    if (body.stream === true) {
      await streamChatResponse(res, options.agent, messages, identity.userId);
      return;
    }

    try {
      const reply = await options.agent.chat(messages, identity.userId);
      res.json({ reply });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  const publicDir = path.join(__dirname, '..', '..', 'public');
  app.use(express.static(publicDir));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

/** SSE event wire shape sent as `data: {…}` lines. */
interface ChatSseEvent {
  type: 'content' | 'status' | 'done' | 'error';
  text?: string;
  reply?: string;
  message?: string;
}

/** Streams an agent answer to the client as Server-Sent Events. */
async function streamChatResponse(
  res: Response,
  agent: Pick<ChatAgent, 'chatStream'>,
  messages: ChatMessage[],
  userId: string,
): Promise<void> {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const controller = new AbortController();
  res.on('close', () => {
    // Abort the upstream stream only when the client disconnects before the
    // answer finishes (a normal `res.end()` sets `writableEnded`, so no abort).
    if (!res.writableEnded) controller.abort();
  });

  const send = (event: ChatSseEvent): void => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const reply = await agent.chatStream(
      messages,
      userId,
      (delta) => send({ type: 'content', text: delta }),
      (status) => send({ type: 'status', text: status }),
      controller.signal,
    );
    send({ type: 'done', reply });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

/** Validates an incoming conversation, returning `ChatMessage[]` or null. */
function parseMessages(body: { messages?: unknown }): ChatMessage[] | null {
  const value = body.messages;
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const result: ChatMessage[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      return null;
    }
    const { role, content } = item as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant') {
      return null;
    }
    if (typeof content !== 'string') {
      return null;
    }
    result.push({ role, content });
  }
  return result;
}
