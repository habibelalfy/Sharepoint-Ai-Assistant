/**
 * Persistent in-process MCP client used by the HTTP gateway to forward tool
 * calls to the MCP server (no per-request process spawn).
 *
 * @module api/mcp-client
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, type ServerOptions } from '../server';
import type { SharePointClient } from '../sharepoint/client';

export interface McpToolCaller {
  callTool(toolName: string, args: Record<string, unknown>): Promise<unknown>;
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
  close(): Promise<void>;
}

export async function createMcpToolCaller(
  client: SharePointClient,
  options?: ServerOptions,
): Promise<McpToolCaller> {
  const server = createServer(client, undefined, undefined, options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: 'mcp-http-gateway', version: '1.0.0' });

  await server.connect(serverTransport);
  await mcpClient.connect(clientTransport);

  return {
    async callTool(toolName, args) {
      const result = (await mcpClient.callTool({ name: toolName, arguments: args })) as {
        content: Array<{ type: string; text?: string }>;
      };
      const text = result.content.find((block) => block.type === 'text');
      return text && typeof text.text === 'string' ? parseMaybeJson(text.text) : undefined;
    },
    async listTools() {
      const { tools } = await mcpClient.listTools();
      return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));
    },
    async close() {
      await mcpClient.close();
      await server.close();
    },
  };
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
