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
  const options = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'sk-test',
    model: 'deepseek-chat',
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
});
