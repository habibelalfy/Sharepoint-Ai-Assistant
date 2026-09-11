import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server';
import { mockSharePointClient, resultText } from './helpers';

describe('createServer', () => {
  let sharepoint: ReturnType<typeof mockSharePointClient>;

  beforeEach(() => {
    sharepoint = mockSharePointClient();
  });

  it('registers all five data-access tools', async () => {
    const server = createServer(sharepoint);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'analyze_milestone_delay',
      'check_plan_health',
      'create_escalation',
      'get_audit_logs',
      'get_escalations_by_project',
      'get_milestones_by_project',
      'get_project_by_id',
      'get_project_statistics',
      'get_tasks_by_project',
      'get_user_permissions',
      'query_project_data',
      'search_projects',
      'update_escalation',
    ]);

    await client.close();
    await server.close();
  });

  it('returns flattened data for a query_project_data call', async () => {
    jest.mocked(sharepoint.queryList).mockResolvedValue([{ Id: 5, Title: 'Project Alpha' }]);
    const server = createServer(sharepoint);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = await client.callTool({
      name: 'query_project_data',
      arguments: { listName: 'Projects' },
    });
    expect(JSON.parse(resultText(result))).toEqual([{ id: 5, title: 'Project Alpha' }]);

    await client.close();
    await server.close();
  });

  it('rejects an invalid listName before any SharePoint call', async () => {
    const server = createServer(sharepoint);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'test-client', version: '1.0.0' });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    const result = (await client.callTool({
      name: 'query_project_data',
      arguments: { listName: 'SecretList' },
    })) as unknown as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(sharepoint.queryList).not.toHaveBeenCalled();

    await client.close();
    await server.close();
  });
});
