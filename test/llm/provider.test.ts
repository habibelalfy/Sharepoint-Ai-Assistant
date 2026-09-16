import { describe, expect, it, jest } from '@jest/globals';

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: jest.fn() } },
  })),
}));

import OpenAI from 'openai';
import { LLMProviderError } from '../../src/errors';
import { OpenAiCompatibleLLMProvider } from '../../src/llm/provider';

type CreateChat = (body: unknown) => Promise<{
  choices: Array<{
    message?: {
      content: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
}>;

describe('OpenAiCompatibleLLMProvider', () => {
  it('uses DeepSeek non-thinking mode for tool-capable chat', async () => {
    const create = jest
      .fn<CreateChat>()
      .mockResolvedValue({ choices: [{ message: { content: 'ok' } }] });
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create } },
    }));
    const provider = new OpenAiCompatibleLLMProvider({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'test',
      model: 'deepseek-flash',
    });
    await provider.complete([{ role: 'user', content: 'hello' }]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'deepseek-flash',
        thinking: { type: 'disabled' },
        reasoning_effort: 'low',
        max_tokens: 4096,
        stream: false,
      }),
    );
  });
  it('reports connection failures without exposing SDK credentials', async () => {
    const error = new Error('sensitive backend details');
    error.name = 'APIConnectionTimeoutError';
    const create = jest.fn<CreateChat>().mockRejectedValue(error);
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create } },
    }));
    const provider = new OpenAiCompatibleLLMProvider({
      baseUrl: 'http://local/v1',
      apiKey: 'not-needed',
      model: 'local',
    });
    await expect(provider.complete([{ role: 'user', content: 'hello' }])).rejects.toThrow(
      /Check that the model server is running/,
    );
    await expect(provider.complete([{ role: 'user', content: 'hello' }])).rejects.not.toThrow(
      /sensitive backend details/,
    );
  });
  const options = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    model: 'deepseek-flash',
  };

  it('returns content and tool calls', async () => {
    const create = jest.fn<CreateChat>().mockResolvedValue({
      choices: [
        {
          message: {
            content: 'calling a tool',
            tool_calls: [
              {
                id: 'call_1',
                function: { name: 'query_project_data', arguments: '{"listName":"Projects"}' },
              },
            ],
          },
        },
      ],
    });
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create } },
    }));

    const provider = new OpenAiCompatibleLLMProvider(options);
    const result = await provider.complete([{ role: 'user', content: 'hi' }]);

    expect(result.content).toBe('calling a tool');
    expect(result.toolCalls).toEqual([
      {
        id: 'call_1',
        type: 'function',
        function: { name: 'query_project_data', arguments: '{"listName":"Projects"}' },
      },
    ]);
  });

  it('returns no tool calls for a plain answer', async () => {
    const create = jest
      .fn<CreateChat>()
      .mockResolvedValue({ choices: [{ message: { content: 'here is the answer' } }] });
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create } },
    }));

    const provider = new OpenAiCompatibleLLMProvider(options);
    const result = await provider.complete([{ role: 'user', content: 'hi' }]);

    expect(result.content).toBe('here is the answer');
    expect(result.toolCalls).toEqual([]);
  });

  it('wraps SDK errors in LLMProviderError', async () => {
    const create = jest.fn<CreateChat>().mockRejectedValue(new Error('down'));
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create } },
    }));

    const provider = new OpenAiCompatibleLLMProvider(options);
    await expect(provider.complete([{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(
      LLMProviderError,
    );
  });

  it('includes sanitized provider status without exposing API keys', async () => {
    const error = Object.assign(new Error('Incorrect API key provided: sk-secret123'), {
      status: 401,
      code: 'invalid_api_key',
      type: 'authentication_error',
    });
    const create = jest.fn<CreateChat>().mockRejectedValue(error);
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create } },
    }));

    const provider = new OpenAiCompatibleLLMProvider(options);
    await expect(provider.complete([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      /status 401; code invalid_api_key; type authentication_error; Incorrect API key provided: sk-redacted/,
    );
  });

  it('streams deltas and merges fragmented tool-call arguments', async () => {
    async function* chunkStream() {
      yield { choices: [{ delta: { content: 'Hel' } }] };
      yield { choices: [{ delta: { content: 'lo' } }] };
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'query', arguments: '{"a":' } },
              ],
            },
          },
        ],
      };
      yield {
        choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }],
      };
    }
    const create = jest
      .fn<(body: unknown, options?: unknown) => Promise<unknown>>()
      .mockResolvedValue(chunkStream());
    (OpenAI as unknown as jest.Mock).mockImplementation(() => ({
      chat: { completions: { create } },
    }));

    const provider = new OpenAiCompatibleLLMProvider(options);
    const deltas: string[] = [];
    const result = await provider.completeStream(
      [{ role: 'user', content: 'hi' }],
      undefined,
      (delta) => deltas.push(delta),
    );

    expect(deltas).toEqual(['Hel', 'lo']);
    expect(result.content).toBe('Hello');
    expect(result.toolCalls).toEqual([
      { id: 'call_1', type: 'function', function: { name: 'query', arguments: '{"a":1}' } },
    ]);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ stream: true }),
      expect.anything(),
    );
  });
});
