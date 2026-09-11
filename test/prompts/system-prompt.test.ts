import { describe, expect, it } from '@jest/globals';
import { buildToolCatalog, renderSystemPrompt } from '../../src/prompts/system-prompt';

const tools = [
  {
    name: 'query_project_data',
    description: 'Query items',
    inputSchema: {
      type: 'object',
      properties: {
        listName: { type: 'string' },
        filter: { type: 'string' },
        userId: { type: 'string' },
      },
      required: ['listName'],
    },
  },
  {
    name: 'search_projects',
    description: 'Search projects',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
];

describe('buildToolCatalog', () => {
  it('lists tools with descriptions and parameters', () => {
    const catalog = buildToolCatalog(tools);
    expect(catalog).toContain('**query_project_data**');
    expect(catalog).toContain('Query items');
    expect(catalog).toContain('listName, filter?, userId?');
    expect(catalog).toContain('**search_projects**');
    expect(catalog).toContain('Search projects');
  });

  it('marks required parameters without a question mark', () => {
    const catalog = buildToolCatalog(tools);
    expect(catalog).toContain('query');
    expect(catalog).not.toContain('query?');
  });
});

describe('renderSystemPrompt', () => {
  it('embeds the generated catalog in the prompt', () => {
    const prompt = renderSystemPrompt('## tools\n- **x**');
    expect(prompt).toContain('## Available tools');
    expect(prompt).toContain('- **x**');
    expect(prompt).toContain('## Guidelines');
  });
});
