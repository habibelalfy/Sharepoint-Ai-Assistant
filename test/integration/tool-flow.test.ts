import axios from 'axios';
import nock from 'nock';
import { afterAll, afterEach, describe, expect, it } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../../src/server';
import { NoopAuditService } from '../../src/services/audit-service';
import { ADGroupProvider, PermissionService } from '../../src/services/permission-service';
import { SharePointClient } from '../../src/sharepoint/client';
import { resultText } from '../helpers';

const SITE_URL = 'http://sp-server/sites/projects';

class StaticADGroupProvider implements ADGroupProvider {
  public constructor(private readonly groups: Record<string, string[]>) {}

  public async getUserADGroups(username: string): Promise<string[]> {
    return this.groups[username] ?? [];
  }
}

/** A plain (unauthenticated) axios instance so nock intercepts the HTTP layer. */
function buildSharePointClient(): SharePointClient {
  return new SharePointClient(
    axios.create({
      headers: {
        Accept: 'application/json;odata=verbose',
        'Content-Type': 'application/json;odata=verbose',
      },
    }),
    SITE_URL,
  );
}

async function connectClient(
  client: SharePointClient,
  permissions: PermissionService,
): Promise<Client> {
  const server = createServer(client, undefined, undefined, {
    audit: new NoopAuditService(),
    permissions,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: 'integration-test', version: '1.0.0' });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return mcp;
}

const PROJECTS = [
  {
    Id: 1,
    Title: 'Public Alpha',
    Status: 'In Progress',
    StartDate: '/Date(1700000000000)/',
    EndDate: '/Date(1800000000000)/',
    Budget: 100000,
    ActualCost: 40000,
  },
  { Id: 2, Title: 'Secret Beta', Status: 'In Progress', PermittedGroups: { results: ['PMO'] } },
];

afterEach(() => nock.cleanAll());
afterAll(() => nock.enableNetConnect());

describe('full tool-call flow against a mocked SharePoint server', () => {
  it('filters project data by AD-group permissions', async () => {
    nock('http://sp-server')
      .get("/sites/projects/_api/web/lists/getByTitle('Projects')/items")
      .reply(200, { d: { results: PROJECTS } });

    const permissions = new PermissionService(new StaticADGroupProvider({ bob: [] }));
    const mcp = await connectClient(buildSharePointClient(), permissions);

    const result = await mcp.callTool({
      name: 'query_project_data',
      arguments: { listName: 'Projects', userId: 'bob' },
    });
    const projects = JSON.parse(resultText(result)) as Array<{ title: string }>;
    expect(projects.map((p) => p.title)).toEqual(['Public Alpha']);
    await mcp.close();
  });

  it('searches projects through the full flow', async () => {
    nock('http://sp-server')
      .get("/sites/projects/_api/web/lists/getByTitle('Projects')/items")
      .query(true)
      .reply(200, { d: { results: PROJECTS } });

    const permissions = new PermissionService(new StaticADGroupProvider({ alice: ['PMO'] }));
    const mcp = await connectClient(buildSharePointClient(), permissions);

    const result = await mcp.callTool({
      name: 'search_projects',
      arguments: { query: 'alpha', userId: 'alice' },
    });
    const projects = JSON.parse(resultText(result)) as Array<{ title: string }>;
    expect(projects).toHaveLength(2);
    await mcp.close();
  });

  it('fetches a project with its related tasks and milestones', async () => {
    nock('http://sp-server')
      .get("/sites/projects/_api/web/lists/getByTitle('Projects')/items(1)")
      .reply(200, { d: { Id: 1, Title: 'Alpha' } });
    nock('http://sp-server')
      .get("/sites/projects/_api/web/lists/getByTitle('Tasks')/items")
      .query({ $filter: 'ProjectId eq 1' })
      .reply(200, { d: { results: [{ Id: 10, Title: 'Task A' }] } });
    nock('http://sp-server')
      .get("/sites/projects/_api/web/lists/getByTitle('Milestones')/items")
      .query({ $filter: 'ProjectId eq 1' })
      .reply(200, { d: { results: [{ Id: 20, Title: 'M1' }] } });

    const mcp = await connectClient(
      buildSharePointClient(),
      new PermissionService(new StaticADGroupProvider({})),
    );

    const result = await mcp.callTool({
      name: 'get_project_by_id',
      arguments: { projectId: '1' },
    });
    const parsed = JSON.parse(resultText(result)) as {
      project: { title: string };
      tasks: Array<{ title: string }>;
      milestones: Array<{ title: string }>;
    };
    expect(parsed.project.title).toBe('Alpha');
    expect(parsed.tasks.map((t) => t.title)).toEqual(['Task A']);
    expect(parsed.milestones.map((m) => m.title)).toEqual(['M1']);
    await mcp.close();
  });
});
