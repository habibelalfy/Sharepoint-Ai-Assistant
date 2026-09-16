import { describe, expect, it } from '@jest/globals';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { ProjectServerClient } from '../../src/sharepoint/project-server-client';
import { createMcpToolCaller } from '../../src/api/mcp-client';
import { NoopAuditService } from '../../src/services/audit-service';
import { mockSharePointClient } from '../helpers';
import { ProjectWorkspace } from '../../src/sharepoint/project-workspace';

const id = '00ab28a5-42ae-f111-b182-525400c9a05e';
describe('Project Server tools over MCP', () => {
  it('searches and reads a GUID project without touching custom lists', async () => {
    const http = axios.create();
    const mock = new MockAdapter(http);
    const project = { Id: id, Name: 'hexacloud', PercentComplete: 0 };
    mock.onGet('http://sp/_api/ProjectServer/Projects').reply(200, { d: { results: [project] } });
    mock.onGet(`http://sp/_api/ProjectServer/Projects('${id}')`).reply(200, { d: project });
    mock
      .onGet(`http://sp/_api/ProjectServer/Projects('${id}')/Tasks`)
      .reply(200, { d: { results: [] } });
    const lists = mockSharePointClient();
    const caller = await createMcpToolCaller(lists, {
      projectServer: new ProjectServerClient(http, 'http://sp'),
      projectWorkspace: new ProjectWorkspace(http, 'http://sp'),
      audit: new NoopAuditService(),
    });
    try {
      expect(await caller.callTool('list_projects', { userId: 'alice' })).toEqual([
        expect.objectContaining({ id, title: 'hexacloud' }),
      ]);
      expect(
        await caller.callTool('search_projects', { query: 'hexacloud', userId: 'alice' }),
      ).toEqual([expect.objectContaining({ id, title: 'hexacloud' })]);
      expect(
        await caller.callTool('get_project_by_id', { projectId: id, userId: 'alice' }),
      ).toMatchObject({ project: { id, title: 'hexacloud' }, tasks: [], milestones: [] });
      expect(
        await caller.callTool('get_project_statistics', { projectId: id, userId: 'alice' }),
      ).toMatchObject({ overallProgress: 0, totalTasks: 0 });
      expect(lists.queryList).not.toHaveBeenCalled();
      expect((await caller.listTools()).map((t) => t.name)).not.toContain('create_escalation');
      expect((await caller.listTools()).map((t) => t.name)).toEqual(
        expect.arrayContaining([
          'create_project',
          'search_project_documents',
          'read_project_document',
          'prepare_project_plan',
          'publish_project_plan',
          'prepare_project_plan_from_spec',
          'stage_project_document',
        ]),
      );
    } finally {
      await caller.close();
    }
  });
});
