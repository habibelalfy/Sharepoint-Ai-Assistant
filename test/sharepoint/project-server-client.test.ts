import { describe, expect, it } from '@jest/globals';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { ProjectServerClient } from '../../src/sharepoint/project-server-client';

const site = 'http://sp/sites/PWA';
const base = site + '/_api/ProjectServer/';
const id = '00ab28a5-42ae-f111-b182-525400c9a05e';
function setup() {
  const http = axios.create();
  return { client: new ProjectServerClient(http, site), mock: new MockAdapter(http) };
}
describe('ProjectServerClient', () => {
  it('creates a project with a digest, then verifies it; duplicate names do not write', async () => {
    const { client, mock } = setup();
    let created: Record<string, unknown> | undefined;
    mock.onGet(base + 'Projects').reply(() => [200, { d: { results: created ? [created] : [] } }]);
    mock
      .onPost(site + '/_api/contextinfo')
      .reply(200, { d: { GetContextWebInformation: { FormDigestValue: 'digest' } } });
    mock.onPost(base + 'Projects/Add').reply((config) => {
      expect(config.headers?.['X-RequestDigest']).toBe('digest');
      const { parameters } = JSON.parse(config.data);
      expect(parameters.Name).toBe('openstack');
      created = { Id: parameters.Id, Name: parameters.Name };
      return [200, { d: created }];
    });
    mock.onGet(new RegExp('/Projects\\(')).reply(() => [200, { d: created }]);
    expect(await client.createProject('openstack')).toMatchObject({
      status: 'created',
      project: { title: 'openstack' },
    });
    expect(await client.createProject(' OPENSTACK ')).toMatchObject({ status: 'already_exists' });
    expect(mock.history.post).toHaveLength(2);
  });
  it('rejects permission errors and prevents blind retries after uncertain writes', async () => {
    const { client, mock } = setup();
    mock.onGet(base + 'Projects').reply(200, { d: { results: [] } });
    mock
      .onPost(site + '/_api/contextinfo')
      .reply(200, { d: { GetContextWebInformation: { FormDigestValue: 'digest' } } });
    mock.onPost(base + 'Projects/Add').replyOnce(403);
    await expect(client.createProject('denied')).rejects.toThrow('not allowed');
    mock.onPost(base + 'Projects/Add').timeout();
    await expect(client.createProject('uncertain')).rejects.toThrow('could not be verified');
    const count = mock.history.post.length;
    await expect(client.createProject('uncertain')).rejects.toThrow('earlier creation');
    expect(mock.history.post).toHaveLength(count);
    await expect(client.createProject(' ')).rejects.toThrow('Project name');
  });

  it('lists more than 100 projects across pages and honors explicit search limits', async () => {
    const { client, mock } = setup();
    const rows = Array.from({ length: 100 }, (_, i) => ({ Id: String(i), Name: `Project ${i}` }));
    mock.onGet(base + 'Projects').reply(200, { d: { results: rows, __next: '?page=2' } });
    mock
      .onGet(base + 'Projects?page=2')
      .reply(200, { d: { results: [{ Id: 'last', Name: 'Last project' }] } });
    expect(await client.projects()).toHaveLength(101);
    expect(await client.projects('', 10)).toHaveLength(10);
  });

  it('distinguishes connection timeouts from upstream HTTP errors', async () => {
    const { client, mock } = setup();
    mock.onGet(base + 'Projects').timeout();
    await expect(client.projects()).rejects.toMatchObject({
      statusCode: 504,
      message: expect.stringContaining('connection timed out'),
    });
  });
  it('recognizes IIS HTML mapping errors instead of treating them as transient outages', async () => {
    const { client, mock } = setup();
    mock
      .onGet(base + 'Projects')
      .reply(500, 'The Web application at http://sp:80/PWA could not be found.');
    await expect(client.projects()).rejects.toMatchObject({
      statusCode: 400,
      message: expect.stringContaining('web-application hostname'),
    });
  });
  it('explains SharePoint hostname mapping errors', async () => {
    const { client, mock } = setup();
    mock.onGet(base + 'Projects').reply(500, {
      error: { message: { value: 'The Web application at http://sp could not be found.' } },
    });
    await expect(client.projects()).rejects.toThrow(/web-application hostname/);
  });
  it('searches all pages, preserving GUIDs and mapping published fields', async () => {
    const { client, mock } = setup();
    mock
      .onGet(base + 'Projects')
      .reply(200, { d: { results: [{ Id: 'other', Name: 'Other' }], __next: '?page=2' } });
    mock.onGet(base + 'Projects?page=2').reply(200, {
      d: {
        results: [
          {
            Id: '0838d0c7-99ae-f111-b183-525400c9a05e',
            Name: 'project1',
            PercentComplete: 0,
          },
          {
            Id: id,
            Name: 'hexacloud',
            PercentComplete: 0,
            StartDate: '2026-09-12T00:00:00',
            Description: null,
          },
        ],
      },
    });
    expect(await client.projects('HEXA', 1)).toEqual([
      expect.objectContaining({ id, title: 'hexacloud', percentComplete: 0 }),
    ]);
    expect(mock.history.get).toHaveLength(2);
    expect(await client.projects('Project 1')).toEqual([
      expect.objectContaining({ title: 'project1' }),
    ]);
  });
  it('reads published tasks and preserves milestone flags and progress', async () => {
    const { client, mock } = setup();
    mock.onGet(base + `Projects('${id}')/Tasks`).reply(200, {
      d: {
        results: [
          {
            Id: id,
            Name: 'Release',
            IsMilestone: true,
            PercentComplete: 100,
            Start: '0001-01-01T00:00:00',
            Finish: '2026-10-01T00:00:00',
          },
        ],
      },
    });
    expect(await client.tasks(id)).toEqual([
      expect.objectContaining({
        id,
        projectId: id,
        title: 'Release',
        status: 'Completed',
        isMilestone: true,
        startDate: undefined,
      }),
    ]);
  });
  it('returns an empty published task collection without fabricating tasks', async () => {
    const { client, mock } = setup();
    mock.onGet(base + `Projects('${id}')/Tasks`).reply(200, { d: { results: [] } });
    expect(await client.tasks(id)).toEqual([]);
  });
  it('rejects injected IDs and off-site pagination before sending requests', async () => {
    const { client, mock } = setup();
    await expect(client.tasks("x')/Draft")).rejects.toThrow(/GUID/);
    expect(mock.history.get).toHaveLength(0);
    mock.onGet(base + 'Projects').reply(200, { d: { results: [], __next: 'http://other/steal' } });
    await expect(client.projects()).rejects.toThrow(/pagination/);
    expect(mock.history.get).toHaveLength(1);
  });
  it('propagates SharePoint access failures', async () => {
    const { client, mock } = setup();
    mock.onGet(base + 'Projects').reply(403);
    await expect(client.projects()).rejects.toMatchObject({ statusCode: 403 });
  });
});
