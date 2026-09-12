/**
 * LLM (chat) provider abstraction over any OpenAI-compatible endpoint.
 *
 * Uses the official `openai` SDK with `baseURL` pointed at `LLM_API_BASE_URL`,
 * so the same code drives DeepSeek, OpenAI, Ollama, vLLM, LM Studio, etc.
 *
 * @module llm/provider
 */
import OpenAI from 'openai';
import { LLMProviderError } from '../errors';

/** A single conversation message (OpenAI wire shape). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** Tool-call id (required when `role === 'tool'`). */
  tool_call_id?: string;
  /** Tool calls requested by the assistant (for `role === 'assistant'`). */
  tool_calls?: ToolCall[];
}

/** A tool call requested by the model. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** OpenAI-format tool (function) definition. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** The result of a single LLM completion turn. */
export interface CompletionResult {
  /** The model's prose (null when it only requested tool calls). */
  content: string | null;
  toolCalls: ToolCall[];
}

/** Minimal structural shape of an OpenAI chat-completion response. */
interface ChatCompletionResponse {
  choices: Array<{
    message?: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
}

/** Generates chat completions (with optional tool-calling). */
export interface ILLMProvider {
  complete(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<CompletionResult>;
}

/** Options for {@link OpenAiCompatibleLLMProvider}. */
export interface OpenAiCompatibleLLMProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
}

type ChatCreateParams = Parameters<OpenAI['chat']['completions']['create']>[0];

/** OpenAI-compatible chat provider (DeepSeek, Ollama, vLLM, OpenAI, …). */
export class OpenAiCompatibleLLMProvider implements ILLMProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number;

  public constructor(options: OpenAiCompatibleLLMProviderOptions) {
    this.client = new OpenAI({ baseURL: options.baseUrl, apiKey: options.apiKey });
    this.model = options.model;
    this.temperature = options.temperature ?? 0;
  }

  public async complete(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): Promise<CompletionResult> {
    try {
      const body = {
        model: this.model,
        messages,
        tools: tools && tools.length > 0 ? tools : undefined,
        temperature: this.temperature,
      } as unknown as ChatCreateParams;

      const response = (await this.client.chat.completions.create(
        body,
      )) as unknown as ChatCompletionResponse;
      const message = response.choices[0]?.message;

      return {
        content: message?.content ?? null,
        toolCalls: (message?.tool_calls ?? []).map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.function.name, arguments: call.function.arguments },
        })),
      };
    } catch (cause) {
      throw new LLMProviderError('LLM completion request failed', { cause });
    }
  }
}
