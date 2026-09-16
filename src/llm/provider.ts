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

/** Minimal structural shape of an OpenAI streaming chat-completion chunk. */
interface ChatCompletionChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

/** Generates chat completions (with optional tool-calling). */
export interface ILLMProvider {
  complete(messages: ChatMessage[], tools?: ToolDefinition[]): Promise<CompletionResult>;
  /**
   * Streams a single completion, invoking `onContent` for each text delta and
   * returning the accumulated content + tool calls once the stream finishes.
   * Optional so non-streaming providers (and test doubles) remain valid.
   */
  completeStream?(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    onContent: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<CompletionResult>;
}

/** Options for {@link OpenAiCompatibleLLMProvider}. */
export interface OpenAiCompatibleLLMProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
  /** Maximum completion tokens per turn (default 4096). */
  maxTokens?: number;
}

type ChatCreateParams = Parameters<OpenAI['chat']['completions']['create']>[0];

/** OpenAI-compatible chat provider (DeepSeek, Ollama, vLLM, OpenAI, …). */
export class OpenAiCompatibleLLMProvider implements ILLMProvider {
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly temperature: number;
  private readonly maxTokens: number;
  private readonly isDeepSeek: boolean;

  public constructor(options: OpenAiCompatibleLLMProviderOptions) {
    this.isDeepSeek = new URL(options.baseUrl).hostname === 'api.deepseek.com';
    this.client = new OpenAI({
      baseURL: options.baseUrl,
      apiKey: options.apiKey,
      timeout: 120_000,
      maxRetries: 0,
    });
    this.model = options.model;
    this.temperature = options.temperature ?? 0;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  public async complete(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): Promise<CompletionResult> {
    try {
      const body = this.buildBody(messages, tools, false);

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
      throw this.wrapError(cause);
    }
  }

  public async completeStream(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    onContent: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<CompletionResult> {
    try {
      const body = this.buildBody(messages, tools, true);

      const stream = (await this.client.chat.completions.create(body, {
        signal,
      })) as unknown as AsyncIterable<ChatCompletionChunk>;

      let content = '';
      const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) {
          content += delta.content;
          onContent(delta.content);
        }
        for (const fragment of delta.tool_calls ?? []) {
          const index = fragment.index ?? 0;
          const existing = toolCalls.get(index) ?? { id: '', name: '', arguments: '' };
          if (fragment.id) existing.id = fragment.id;
          if (fragment.function?.name) existing.name += fragment.function.name;
          if (fragment.function?.arguments) existing.arguments += fragment.function.arguments;
          toolCalls.set(index, existing);
        }
      }

      return {
        content: content || null,
        toolCalls: Array.from(toolCalls.values()).map((call) => ({
          id: call.id,
          type: 'function' as const,
          function: { name: call.name, arguments: call.arguments },
        })),
      };
    } catch (cause) {
      throw this.wrapError(cause);
    }
  }

  /** Builds the provider request body (shared by streaming and non-streaming). */
  private buildBody(
    messages: ChatMessage[],
    tools: ToolDefinition[] | undefined,
    stream: boolean,
  ): ChatCreateParams {
    return {
      model: this.model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      temperature: this.temperature,
      stream,
      max_tokens: this.maxTokens,
      ...(this.isDeepSeek ? { thinking: { type: 'disabled' }, reasoning_effort: 'low' } : {}),
    } as unknown as ChatCreateParams;
  }

  private wrapError(cause: unknown): LLMProviderError {
    if (cause instanceof Error && /Connection|Timeout/.test(cause.name)) {
      return new LLMProviderError(
        'Cannot reach the LLM server or the request timed out. Check that the model server is running and reachable from Docker, then retry.',
        { cause },
      );
    }
    return new LLMProviderError(`LLM completion request failed${providerErrorHint(cause)}`, {
      cause,
    });
  }
}

function providerErrorHint(cause: unknown): string {
  if (typeof cause !== 'object' || cause === null) {
    return '';
  }

  const row = cause as Record<string, unknown>;
  const status = typeof row.status === 'number' ? row.status : undefined;
  const code = typeof row.code === 'string' ? row.code : undefined;
  const type = typeof row.type === 'string' ? row.type : undefined;
  const message = typeof row.message === 'string' ? redactSensitiveText(row.message) : undefined;
  const parts = [
    status ? `status ${status}` : undefined,
    code ? `code ${code}` : undefined,
    type ? `type ${type}` : undefined,
    message,
  ].filter(Boolean);

  return parts.length > 0 ? `: ${parts.join('; ')}` : '';
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-redacted')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer redacted')
    .slice(0, 500);
}
