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
  it('creates a project despite stale capability refusals and a common spelling error', async () => {
    const complete = jest.fn<ILLMProvider['complete']>();
    const callTool = jest
      .fn<ToolCaller['callTool']>()
      .mockResolvedValue({ status: 'created', project: { id: 'guid', title: 'project20' } });
    const listTools = jest
      .fn<ToolCaller['listTools']>()
      .mockResolvedValue([{ name: 'create_project' }]);
    const agent = new ChatAgent({ complete }, { callTool, listTools });
    const history = [
      { role: 'user' as const, content: 'Create a project' },
      { role: 'assistant' as const, content: 'I cannot create projects. No creation tool exists.' },
      { role: 'user' as const, content: 'craete new project name project20' },
    ];
    await expect(agent.chat(history, 'alice')).resolves.toContain('Created project');
    expect(callTool).toHaveBeenCalledWith('create_project', { name: 'project20', userId: 'alice' });
    expect(complete).not.toHaveBeenCalled();
    callTool.mockResolvedValueOnce({
      status: 'already_exists',
      project: { id: 'guid', title: 'project20' },
    });
    await expect(agent.chat(history, 'alice')).resolves.toContain('No duplicate');
    callTool.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(agent.chat(history, 'alice')).rejects.toThrow('Permission denied');
    await expect(agent.chat(history)).rejects.toThrow('Authentication');
  });
  it('does not directly create for negated or hypothetical requests', async () => {
    const complete = jest
      .fn<ILLMProvider['complete']>()
      .mockResolvedValue({ content: 'answer', toolCalls: [] });
    const callTool = jest.fn<ToolCaller['callTool']>();
    const listTools = jest
      .fn<ToolCaller['listTools']>()
      .mockResolvedValue([{ name: 'create_project' }]);
    const agent = new ChatAgent({ complete }, { callTool, listTools });
    for (const content of [
      'Do not create project20',
      'How do I create a project named project20?',
      'Create project20 and delete openstack',
    ])
      await agent.chat([{ role: 'user', content }], 'alice');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('answers document inventory questions from SharePoint without an LLM', async () => {
    const complete = jest.fn<ILLMProvider['complete']>();
    const callTool = jest.fn<ToolCaller['callTool']>().mockResolvedValue({
      projectName: 'cloud1',
      documents: [{ name: 'Plan.pdf', library: 'Documents', url: 'http://sp/PWA/cloud1/Plan.pdf' }],
    });
    const listTools = jest
      .fn<ToolCaller['listTools']>()
      .mockResolvedValue([{ name: 'search_project_documents' }]);
    const agent = new ChatAgent({ complete }, { callTool, listTools });
    for (const content of [
      'what document on cloud1?',
      'What documents are there in cloud1?',
      'list files in cloud1',
    ]) {
      await expect(agent.chat([{ role: 'user', content }], 'alice')).resolves.toContain('Plan.pdf');
    }
    expect(callTool).toHaveBeenCalledWith('search_project_documents', {
      projectName: 'cloud1',
      query: '',
      userId: 'alice',
    });
    expect(complete).not.toHaveBeenCalled();
    callTool.mockResolvedValueOnce({ documents: [] });
    await expect(
      agent.chat([{ role: 'user', content: 'list documents in cloud1' }]),
    ).resolves.toContain('No documents were found');
    callTool.mockRejectedValueOnce(new Error('SharePoint access denied'));
    await expect(
      agent.chat([{ role: 'user', content: 'list documents in cloud1' }]),
    ).rejects.toThrow('SharePoint access denied');
  });
  it('keeps tools available for follow-up questions without project keywords', async () => {
    const complete = jest
      .fn<ILLMProvider['complete']>()
      .mockResolvedValue({ content: 'summary', toolCalls: [] });
    const listTools = jest
      .fn<ToolCaller['listTools']>()
      .mockResolvedValue([{ name: 'read_project_document' }]);
    const agent = new ChatAgent(
      { complete },
      { callTool: jest.fn<ToolCaller['callTool']>(), listTools },
    );
    await agent.chat([
      { role: 'user', content: 'what document on cloud1?' },
      { role: 'assistant', content: 'Plan.pdf' },
      { role: 'user', content: 'Summarize it' },
    ]);
    expect(complete).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({ name: 'read_project_document' }),
        }),
      ]),
    );
  });
  it('keeps document summaries on the model path', async () => {
    const complete = jest
      .fn<ILLMProvider['complete']>()
      .mockResolvedValue({ content: 'summary', toolCalls: [] });
    const callTool = jest.fn<ToolCaller['callTool']>();
    const listTools = jest
      .fn<ToolCaller['listTools']>()
      .mockResolvedValue([{ name: 'search_project_documents' }]);
    const agent = new ChatAgent({ complete }, { callTool, listTools });
    await expect(
      agent.chat([{ role: 'user', content: 'Summarize the document on cloud1' }]),
    ).resolves.toBe('summary');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('lists live projects without depending on the LLM and preserves the caller identity', async () => {
    const complete = jest.fn<ILLMProvider['complete']>();
    const callTool = jest
      .fn<ToolCaller['callTool']>()
      .mockResolvedValue([{ id: 'guid', title: 'cloud1' }]);
    const listTools = jest
      .fn<ToolCaller['listTools']>()
      .mockResolvedValue([{ name: 'list_projects' }]);
    const agent = new ChatAgent({ complete }, { callTool, listTools });
    await expect(
      agent.chat([{ role: 'user', content: 'List all projects' }], 'alice'),
    ).resolves.toContain('cloud1 (ID: guid)');
    expect(callTool).toHaveBeenCalledWith('list_projects', { userId: 'alice' });
    expect(complete).not.toHaveBeenCalled();
    callTool.mockRejectedValueOnce(new Error('Access denied'));
    await expect(
      agent.chat([{ role: 'user', content: 'show all projects' }], 'alice'),
    ).rejects.toThrow('Access denied');
    callTool.mockResolvedValueOnce([]);
    await expect(
      agent.chat([{ role: 'user', content: 'list projects' }], 'alice'),
    ).resolves.toContain('No published projects');
  });

  it('keeps filtered and complex project requests on the model tool path', async () => {
    const complete = jest
      .fn<ILLMProvider['complete']>()
      .mockResolvedValue({ content: 'filtered answer', toolCalls: [] });
    const callTool = jest.fn<ToolCaller['callTool']>();
    const listTools = jest
      .fn<ToolCaller['listTools']>()
      .mockResolvedValue([{ name: 'list_projects' }]);
    const agent = new ChatAgent({ complete }, { callTool, listTools });
    await expect(
      agent.chat([{ role: 'user', content: 'List all projects that are overdue' }]),
    ).resolves.toBe('filtered answer');
    expect(callTool).not.toHaveBeenCalled();
  });

  it('returns the final answer when the model does not call tools', async () => {
    const complete = jest
      .fn<ILLMProvider['complete']>()
      .mockResolvedValue({ content: 'the answer', toolCalls: [] });
    const callTool = jest.fn<ToolCaller['callTool']>();
    const listTools = jest.fn<ToolCaller['listTools']>().mockResolvedValue(toolList());

    const agent = new ChatAgent({ complete }, { callTool, listTools });
    await expect(agent.chat([{ role: 'user', content: 'hi' }])).resolves.toBe('the answer');
    expect(listTools).toHaveBeenCalled();
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
    await expect(agent.chat([{ role: 'user', content: 'show project data' }])).resolves.toBe(
      'recovered',
    );
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
    await expect(
      agent.chat([{ role: 'user', content: 'show project data' }], 'u'),
    ).rejects.toBeInstanceOf(LLMProviderError);
  });
});
