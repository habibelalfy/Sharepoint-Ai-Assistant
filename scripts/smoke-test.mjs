#!/usr/bin/env node
/**
 * End-to-end smoke test for a deployed configuration.
 *
 * Boots the MCP server over stdio and the HTTP gateway, then verifies:
 *   1. `tools/list` returns the full tool catalog.
 *   2. One representative tool call succeeds through the gateway.
 *
 * Prerequisites: `npm run build` and a working `.env` (real SharePoint access).
 *
 * Usage: node scripts/smoke-test.mjs
 */
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

dotenv.config({ quiet: true });

const GATEWAY_PORT = Number(process.env.HTTP_GATEWAY_PORT ?? 3001);
const SECRET = process.env.JWT_SIGNING_KEY ?? 'changeme';
const PROJECT_SERVER = process.env.SHAREPOINT_DATA_SOURCE === 'project-server';
const EXPECTED_TOOL_COUNT = PROJECT_SERVER ? 10 : 14;
const READ_TOOL = PROJECT_SERVER ? 'search_projects' : 'get_user_permissions';
const READ_ARGS = PROJECT_SERVER ? { query: '', userId: 'smoke-test' } : { userId: 'smoke-test' };

/** Mints an HMAC-signed JWT-style token (same format the gateway verifies). */
function signToken(claims) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const signature = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

async function smokeStdioServer() {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/server.js'],
    stderr: 'inherit',
    env: process.env,
  });
  const client = new Client({ name: 'smoke-test', version: '1.0.0' });

  try {
    await client.connect(transport);

    const { tools } = await client.listTools();
    if (tools.length !== EXPECTED_TOOL_COUNT) {
      throw new Error(`expected ${EXPECTED_TOOL_COUNT} tools, got ${tools.length}`);
    }
    console.log(`ok tools/list returned ${tools.length} tools`);

    const result = await client.callTool({
      name: READ_TOOL,
      arguments: READ_ARGS,
    });
    const text = result.content.find((block) => block.type === 'text')?.text;
    if (result.isError) throw new Error(`MCP tool failed: ${text}`);
    console.log(`ok ${READ_TOOL} returned data`);
  } finally {
    if (transport.pid) {
      process.kill(transport.pid, 'SIGTERM');
    }
    await client.close().catch(() => {});
  }
}

async function waitForHealth(url, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return;
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      throw new Error(`gateway /health did not respond within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function smokeGateway() {
  const child = spawn('node', ['dist/api/mcp-http-server.js'], { stdio: 'inherit' });
  try {
    await waitForHealth(`http://127.0.0.1:${GATEWAY_PORT}/health`);
    console.log('ok gateway /health responded');

    const token = signToken({ sub: 'smoke-test', exp: Math.floor(Date.now() / 1000) + 3600 });
    const res = await fetch(`http://127.0.0.1:${GATEWAY_PORT}/api/mcp/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ toolName: READ_TOOL, args: READ_ARGS }),
    });
    if (!res.ok) {
      throw new Error(`gateway tool call failed with status ${res.status}`);
    }
    const body = await res.json();
    console.log(`ok gateway tool call -> ${JSON.stringify(body.result).slice(0, 160)}…`);
  } finally {
    child.kill('SIGTERM');
  }
}

async function main() {
  await smokeStdioServer();
  await smokeGateway();
  console.log('SMOKE TEST PASSED');
}

main().catch((error) => {
  console.error(`SMOKE TEST FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
