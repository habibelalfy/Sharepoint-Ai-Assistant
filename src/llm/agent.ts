/**
 * Tool-calling agent loop for the chat endpoint.
 *
 * Feeds the conversation + the MCP tool catalog to an LLM (OpenAI-compatible
 * tool calling); the model either returns a final answer or requests tool calls,
 * which are executed against the in-process MCP server and fed back until the
 * model produces a final answer.
 *
 * @module llm/agent
 */
import { LLMProviderError } from '../errors';
import { buildToolCatalog, renderSystemPrompt } from '../prompts/system-prompt';
import type { ChatMessage, ILLMProvider, ToolCall, ToolDefinition } from './provider';

/** MCP tool-calling surface (implemented by the in-process MCP client). */
export interface ToolCaller {
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  listTools(): Promise<Array<{ name: string; description?: string; inputSchema?: unknown }>>;
}

export interface ChatAgentOptions {
  maxSteps?: number;
}

const DEFAULT_MAX_STEPS = 8;

export class ChatAgent {
  public constructor(
    private readonly provider: ILLMProvider,
    private readonly tools: ToolCaller,
    private readonly options: ChatAgentOptions = {},
  ) {}

  /**
   * Runs one chat turn to completion (final answer).
   *
   * @param history - Prior user/assistant conversation, ending with the user's message.
   * @returns The model's final natural-language answer.
   */
  public async chat(history: ChatMessage[], userId?: string): Promise<string> {
    const maxSteps = this.options.maxSteps ?? DEFAULT_MAX_STEPS;
    const catalogTools = await this.tools.listTools();
    const toolDefinitions = catalogTools.map(toToolDefinition);
    const systemPrompt = renderSystemPrompt(
      buildToolCatalog(
        catalogTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as
            | { type?: string; properties?: Record<string, unknown>; required?: string[] }
            | undefined,
        })),
      ),
    );

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history];

    for (let step = 0; step < maxSteps; step += 1) {
      const result = await this.provider.complete(messages, toolDefinitions);
      if (result.toolCalls.length === 0) {
        return result.content ?? '(the model returned no answer)';
      }

      messages.push({
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const call of result.toolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: await this.executeTool(call, userId),
        });
      }
    }

    throw new LLMProviderError(`Chat did not converge within ${maxSteps} tool-call steps`);
  }

  private async executeTool(call: ToolCall, userId?: string): Promise<string> {
    const args = parseJsonObject(call.function.arguments);
    try {
      const result = await this.tools.callTool(call.function.name, {
        ...args,
        userId,
      });
      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function toToolDefinition(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
}): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: (tool.inputSchema as Record<string, unknown>) ?? {
        type: 'object',
        properties: {},
      },
    },
  };
}

function parseJsonObject(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
