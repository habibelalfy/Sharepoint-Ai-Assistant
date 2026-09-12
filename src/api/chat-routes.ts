/**
 * Chat endpoint + static chat UI for the HTTP gateway.
 *
 * @module api/chat-routes
 */
import express, { type Express } from 'express';
import path from 'node:path';
import { ChatAgent } from '../llm/agent';
import type { ChatMessage } from '../llm/provider';
import type { Authenticator } from './mcp-http-server';
import type { SlidingWindowRateLimiter } from './rate-limiter';

export interface ChatRouteOptions {
  agent: ChatAgent;
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

    const messages = parseMessages((req.body ?? {}) as { messages?: unknown });
    if (messages === null) {
      res.status(400).json({ error: 'messages must be a non-empty array of { role, content }' });
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
