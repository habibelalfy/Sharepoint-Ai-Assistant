import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { SharePointError } from '../../src/errors';
import { SharePointClient } from '../../src/sharepoint/client';

const siteUrl = 'http://sp-server/sites/projects';
const listItemsUrl = (listName: string): string =>
  `${siteUrl}/_api/web/lists/getByTitle('${listName}')/items`;

describe('SharePointClient', () => {
  let http: ReturnType<typeof axios.create>;
  let mock: MockAdapter;
  let client: SharePointClient;

  beforeEach(() => {
    http = axios.create();
    mock = new MockAdapter(http);
    client = new SharePointClient(http, siteUrl, {
      retryBaseDelayMs: 1,
      sleep: async () => undefined,
    });
  });

  afterEach(() => {
    mock.restore();
  });

  it('queryList returns the flattened results array', async () => {
    mock.onGet(listItemsUrl('Projects')).reply(200, { d: { results: [{ Id: 1 }, { Id: 2 }] } });
    await expect(client.queryList('Projects')).resolves.toEqual([{ Id: 1 }, { Id: 2 }]);
  });

  it('queryList returns an empty array when results are absent', async () => {
    mock.onGet(listItemsUrl('Projects')).reply(200, { d: {} });
    await expect(client.queryList('Projects')).resolves.toEqual([]);
  });

  it('queryList serializes OData query options', async () => {
    mock.onGet(listItemsUrl('Projects')).reply((cfg) => {
      expect(cfg.params).toEqual({
        $filter: "Status eq 'In Progress'",
        $select: 'Title,Status',
        $top: 10,
      });
      return [200, { d: { results: [] } }];
    });
    await client.queryList('Projects', {
      filter: "Status eq 'In Progress'",
      select: ['Title', 'Status'],
      top: 10,
    });
  });

  it('getRequestDigest extracts FormDigestValue', async () => {
    mock.onPost(`${siteUrl}/_api/contextinfo`).reply(200, {
      d: { GetContextWebInformation: { FormDigestValue: 'digest-123' } },
    });
    await expect(client.getRequestDigest()).resolves.toBe('digest-123');
  });

  it('getItemById returns the item', async () => {
    mock.onGet(`${listItemsUrl('Tasks')}(42)`).reply(200, { d: { Id: 42, Title: 'Plan' } });
    await expect(client.getItemById('Tasks', 42)).resolves.toEqual({ Id: 42, Title: 'Plan' });
  });

  it('createItem posts with the request digest attached', async () => {
    mock.onPost(`${siteUrl}/_api/contextinfo`).reply(200, {
      d: { GetContextWebInformation: { FormDigestValue: 'digest-1' } },
    });
    mock.onPost(listItemsUrl('Escalations')).reply((cfg) => {
      expect(cfg.headers?.['X-RequestDigest']).toBe('digest-1');
      return [201, { d: { Id: 7 } }];
    });
    await expect(client.createItem('Escalations', { Title: 'x' })).resolves.toEqual({ Id: 7 });
  });

  it('updateItem uses MERGE with IF-MATCH', async () => {
    mock.onPost(`${siteUrl}/_api/contextinfo`).reply(200, {
      d: { GetContextWebInformation: { FormDigestValue: 'digest-1' } },
    });
    mock.onPost(`${listItemsUrl('Tasks')}(9)`).reply((cfg) => {
      expect(cfg.headers?.['X-HTTP-Method']).toBe('MERGE');
      expect(cfg.headers?.['IF-MATCH']).toBe('*');
      return [204, { d: { Id: 9 } }];
    });
    await client.updateItem('Tasks', 9, { Status: 'Completed' });
  });

  it('wraps 4xx errors in SharePointError without retrying', async () => {
    mock
      .onGet(listItemsUrl('Projects'))
      .reply(404, { error: { message: { value: 'List not found' } } });
    await expect(client.queryList('Projects')).rejects.toBeInstanceOf(SharePointError);
    await expect(client.queryList('Projects')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('retries 5xx responses then throws SharePointError', async () => {
    let calls = 0;
    mock.onGet(listItemsUrl('Projects')).reply(() => {
      calls += 1;
      return [503, { error: { message: { value: 'Unavailable' } } }];
    });
    await expect(client.queryList('Projects')).rejects.toBeInstanceOf(SharePointError);
    expect(calls).toBe(3);
  });

  it('listDocumentLibraries returns libraries with their RootFolder', async () => {
    mock.onGet(`${siteUrl}/_api/web/lists`).reply(200, {
      d: {
        results: [{ Id: 1, Title: 'Docs', RootFolder: { ServerRelativeUrl: '/sites/x/Docs' } }],
      },
    });
    await expect(client.listDocumentLibraries()).resolves.toEqual([
      { Id: 1, Title: 'Docs', RootFolder: { ServerRelativeUrl: '/sites/x/Docs' } },
    ]);
  });

  it('listFilesInFolder returns files with change-detection metadata', async () => {
    mock
      .onGet(`${siteUrl}/_api/web/GetFolderByServerRelativeUrl('/sites/x/Docs')/Files`)
      .reply(200, {
        d: {
          results: [
            {
              Name: 'a.pdf',
              ServerRelativeUrl: '/sites/x/Docs/a.pdf',
              ETag: '"1"',
              UniqueId: 'uid',
            },
          ],
        },
      });
    await expect(client.listFilesInFolder('/sites/x/Docs')).resolves.toEqual([
      { Name: 'a.pdf', ServerRelativeUrl: '/sites/x/Docs/a.pdf', ETag: '"1"', UniqueId: 'uid' },
    ]);
  });

  it('listSubFolders returns subfolders', async () => {
    mock
      .onGet(`${siteUrl}/_api/web/GetFolderByServerRelativeUrl('/sites/x/Docs')/Folders`)
      .reply(200, {
        d: { results: [{ Name: 'sub', ServerRelativeUrl: '/sites/x/Docs/sub' }] },
      });
    await expect(client.listSubFolders('/sites/x/Docs')).resolves.toEqual([
      { Name: 'sub', ServerRelativeUrl: '/sites/x/Docs/sub' },
    ]);
  });

  it('getFileContent returns the raw file bytes', async () => {
    mock
      .onGet(`${siteUrl}/_api/web/GetFileByServerRelativeUrl('/sites/x/Docs/a.pdf')/$value`)
      .reply(200, 'file-bytes');
    const content = await client.getFileContent('/sites/x/Docs/a.pdf');
    expect(Buffer.isBuffer(content)).toBe(true);
    expect(content.toString()).toBe('file-bytes');
  });
});
