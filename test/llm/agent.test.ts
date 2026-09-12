import { describe, expect, it, jest } from '@jest/globals';
import { LLMProviderError } from '../../src/errors';
import { ChatAgent, type ToolCaller } from '../../src/llm/agent';
import type { ILLMProvider } from '../../src/llm/provider';

const toolList = () => [
  {
    name: 'query_project_data',
    description: 'query',
    inputSchema: { type: 'object', properties: {} },
  },
];

describe('ChatAgent.chat', () => {
  it('returns the final answer when the model does not call tools', async () => {
    const complete = jest
      .fn<ILLMProvider['complete']>()
      .mockResolvedValue({ content: 'the answer', toolCalls: [] });
    const callTool = jest.fn<ToolCaller['callTool']>();
    const listTools = jest.fn<ToolCaller['listTools']>().mockResolvedValue(toolList());

    const agent = new ChatAgent({ complete }, { callTool, listTools });
    await expect(agent.chat([{ role: 'user', content: 'hi' }])).resolves.toBe('the answer');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('executes tool calls and continues until a final answer', async () => {
    const complete = jest
      .fn<ILLMProvider['complete']>()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'query_project_data', arguments: '{"listName":"Projects"}' },
          },
        ],
      })
      .mockResolvedValueOnce({ content: '3 projects found', toolCalls: [] });
    const callTool = jest.fn<ToolCaller['callTool']>().mockResolvedValue([{ id: 1 }]);
    const listTools = jest.fn<ToolCaller['listTools']>().mockResolvedValue(toolList());

    const agent = new ChatAgent({ complete }, { callTool, listTools });
    await expect(agent.chat([{ role: 'user', content: 'show projects' }], 'alice')).resolves.toBe(
      '3 projects found',
    );
    expect(callTool).toHaveBeenCalledWith('query_project_data', {
      listName: 'Projects',
      userId: 'alice',
    });
  });

  it('passes through a tool error as a tool result instead of failing', async () => {
    const complete = jest
      .fn<ILLMProvider['complete']>()
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [
          { id: 'c1', type: 'function', function: { name: 'query_project_data', arguments: '{}' } },
        ],
      })
      .mockResolvedValueOnce({ content: 'recovered', toolCalls: [] });
    const callTool = jest.fn<ToolCaller['callTool']>().mockRejectedValue(new Error('boom'));
    const listTools = jest.fn<ToolCaller['listTools']>().mockResolvedValue(toolList());

    const agent = new ChatAgent({ complete }, { callTool, listTools });
    await expect(agent.chat([{ role: 'user', content: 'hi' }])).resolves.toBe('recovered');
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('throws LLMProviderError when the model never converges', async () => {
    const complete = jest.fn<ILLMProvider['complete']>().mockResolvedValue({
      content: null,
      toolCalls: [
        { id: 'c1', type: 'function', function: { name: 'query_project_data', arguments: '{}' } },
      ],
    });
    const callTool = jest.fn<ToolCaller['callTool']>().mockResolvedValue([]);
    const listTools = jest.fn<ToolCaller['listTools']>().mockResolvedValue(toolList());

    const agent = new ChatAgent({ complete }, { callTool, listTools }, { maxSteps: 3 });
    await expect(agent.chat([{ role: 'user', content: 'hi' }], 'u')).rejects.toBeInstanceOf(
      LLMProviderError,
    );
  });
});
