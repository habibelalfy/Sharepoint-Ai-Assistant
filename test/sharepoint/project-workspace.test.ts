import { describe, expect, it } from '@jest/globals';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { ProjectWorkspace } from '../../src/sharepoint/project-workspace';

const projectId = '0838d0c7-99ae-f111-b183-525400c9a05e';
const sourcePath = '/sites/PWA/hexacloud/Documents/k8s.txt';

describe('ProjectWorkspace', () => {
  it('finds project-site documents and requires every document chunk before preview', async () => {
    const http = axios.create();
    const mock = new MockAdapter(http);
    mock.onGet('http://sp/sites/PWA/_api/web/webs?$select=Title,Url').reply(200, {
      d: { results: [{ Title: 'hexacloud', Url: 'http://sp/sites/PWA/hexacloud' }] },
    });
    mock.onGet(/\/hexacloud\/_api\/web\/lists\?\$filter=/).reply(200, {
      d: { results: [{ Id: projectId, Title: 'Documents' }] },
    });
    mock.onGet(/\/hexacloud\/_api\/web\/lists\(guid.*\/items\?/).reply(200, {
      d: { results: [{ FileLeafRef: 'k8s.txt', FileRef: sourcePath, FSObjType: 0 }] },
    });
    mock.onGet(/GetFileByServerRelativeUrl/).reply(200, 'a'.repeat(50_001));
    mock.onGet(`http://sp/sites/PWA/_api/ProjectServer/Projects('${projectId}')`).reply(200, {
      d: { Id: projectId, Name: 'project1', IsCheckedOut: false },
    });
    mock
      .onGet(`http://sp/sites/PWA/_api/ProjectServer/Projects('${projectId}')/Draft/Tasks`)
      .reply(200, { d: { results: [] } });

    const workspace = new ProjectWorkspace(http, 'http://sp/sites/PWA', {
      users: ['alice'],
      projects: [projectId],
    });
    await expect(workspace.searchDocuments('hexacloud', 'k8s', 'alice')).resolves.toMatchObject({
      documents: [{ name: 'k8s.txt', path: sourcePath }],
    });

    const plan = {
      projectId,
      sourcePath,
      title: 'Kubernetes rollout',
      assumptions: 'Durations are planning estimates.',
      tasks: [
        {
          key: 'discover',
          name: 'Discovery',
          durationDays: 2,
          role: 'Platform architect',
          acceptanceCriteria: 'Requirements approved',
          sourceSection: 'Overview',
          predecessors: [],
        },
      ],
    };
    await expect(workspace.readDocument(sourcePath, 'alice', 0)).resolves.toMatchObject({
      nextOffset: 50_000,
    });
    await expect(workspace.preparePlan(plan, 'alice')).rejects.toThrow(/complete source/);
    await expect(workspace.readDocument(sourcePath, 'alice', 50_000)).resolves.toMatchObject({
      nextOffset: null,
    });
    await expect(workspace.preparePlan(plan, 'alice')).resolves.toMatchObject({
      targetProject: 'project1',
      plan,
    });
  });

  it('previews a spec-authored plan without a source document and allows large plans', async () => {
    const http = axios.create();
    const mock = new MockAdapter(http);
    mock
      .onGet(`http://sp/sites/PWA/_api/ProjectServer/Projects('${projectId}')`)
      .reply(200, { d: { Id: projectId, Name: 'golden', IsCheckedOut: false } });
    mock
      .onGet(`http://sp/sites/PWA/_api/ProjectServer/Projects('${projectId}')/Draft/Tasks`)
      .reply(200, { d: { results: [] } });

    const workspace = new ProjectWorkspace(http, 'http://sp/sites/PWA', {
      users: ['alice'],
      projects: [projectId],
    });

    const tasks = Array.from({ length: 60 }, (_, i) => ({
      key: `t${i}`,
      name: `Task ${i}`,
      durationDays: i === 59 ? 0 : 5,
      role: 'Team',
      acceptanceCriteria: 'Done',
      predecessors: i === 0 ? [] : [`t${i - 1}`],
    }));

    const plan = {
      projectId,
      title: 'Golden Template',
      assumptions: 'Durations are planning estimates.',
      tasks,
    };

    await expect(workspace.preparePlanFromSpec(plan, 'bob')).rejects.toThrow(/not enabled/);
    await expect(workspace.preparePlanFromSpec(plan, 'alice')).resolves.toMatchObject({
      targetProject: 'golden',
    });
  });

  it('stages a pasted specification as a project-site document', async () => {
    const http = axios.create();
    const mock = new MockAdapter(http);
    const libraryId = projectId;
    const folderUrl = '/sites/PWA/hexacloud/Documents';
    mock.onGet('http://sp/sites/PWA/_api/web/webs?$select=Title,Url').reply(200, {
      d: { results: [{ Title: 'hexacloud', Url: 'http://sp/sites/PWA/hexacloud' }] },
    });
    mock.onGet(/\/hexacloud\/_api\/web\/lists\?\$filter=/).reply(200, {
      d: { results: [{ Id: libraryId, Title: 'Documents' }] },
    });
    mock.onGet(/\/lists\(guid'.+'\)\/RootFolder$/).reply(200, {
      d: { ServerRelativeUrl: folderUrl },
    });
    mock.onPost('http://sp/sites/PWA/_api/contextinfo').reply(200, {
      d: { GetContextWebInformation: { FormDigestValue: 'digest' } },
    });
    mock.onPost(/Files\/add/).reply(200, { d: { Name: 'spec.txt' } });

    const workspace = new ProjectWorkspace(http, 'http://sp/sites/PWA', {
      users: ['alice'],
      projects: [projectId],
    });

    await expect(workspace.stageDocument('hexacloud', 'spec.txt', 'the spec', 'bob')).rejects.toThrow(
      /not enabled/,
    );
    await expect(
      workspace.stageDocument('hexacloud', 'spec.txt', 'the spec', 'alice'),
    ).resolves.toMatchObject({
      name: 'spec.txt',
      path: `${folderUrl}/spec.txt`,
    });
  });
});
