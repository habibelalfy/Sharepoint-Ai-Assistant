import { describe, expect, it, jest } from '@jest/globals';
import type { Scheduler } from '../../src/services/alert-service';
import type { IEmbeddingProvider } from '../../src/rag/embeddings';
import type { IDocumentExtractor } from '../../src/rag/extraction';
import { DocumentIndexer } from '../../src/rag/indexer';
import type { IVectorStore } from '../../src/rag/vector-store';
import { mockSharePointClient } from '../helpers';

function library(title: string, url: string) {
  return { Id: 1, Title: title, RootFolder: { ServerRelativeUrl: url } };
}

function file(uniqueId: string, etag: string, url: string, name = 'doc.pdf') {
  return {
    Name: name,
    ServerRelativeUrl: url,
    TimeLastModified: '2024-01-01',
    ETag: etag,
    UniqueId: uniqueId,
    ListItemAllFields: { PermittedGroups: { results: ['PMO'] }, ProjectId: 7 },
  };
}

describe('DocumentIndexer.indexAll', () => {
  it('re-indexes changed documents and skips unchanged ones', async () => {
    const client = mockSharePointClient();
    jest.mocked(client.listDocumentLibraries).mockResolvedValue([library('Docs', '/sites/x/Docs')]);
    jest
      .mocked(client.listFilesInFolder)
      .mockResolvedValue([
        file('d1', 'etag-new', '/sites/x/Docs/a.pdf'),
        file('d2', 'etag-same', '/sites/x/Docs/b.pdf'),
      ]);
    jest.mocked(client.listSubFolders).mockResolvedValue([]);
    jest.mocked(client.getFileContent).mockResolvedValue(Buffer.from('content'));

    const extractor: IDocumentExtractor = {
      extensions: ['pdf'],
      extract: jest.fn(async () => 'text'),
    };
    const embeddings: IEmbeddingProvider = {
      dimension: 3,
      embed: jest.fn(async () => [[1, 2, 3]]),
    };
    const store = {
      upsert: jest.fn(),
      query: jest.fn(),
      deleteByDocumentId: jest.fn(),
      getIndexedDocuments: jest.fn(
        async () =>
          new Map([
            ['d2', 'etag-same'],
            ['stale', 'x'],
          ]),
      ),
    } as unknown as IVectorStore;

    const indexer = new DocumentIndexer(
      client,
      extractor,
      { size: 100, overlap: 20 },
      embeddings,
      store,
    );
    await indexer.indexAll();

    // d1 changed → upserted; d2 unchanged → skipped; stale → deleted.
    expect(store.upsert).toHaveBeenCalledTimes(1);
    const upserted = (store.upsert as jest.Mock).mock.calls[0]?.[0] as unknown[] | undefined;
    expect(upserted).toHaveLength(1);
    expect(upserted?.[0]).toMatchObject({
      documentId: 'd1',
      permittedGroups: ['PMO'],
      projectId: 7,
    });
    expect(store.deleteByDocumentId).toHaveBeenCalledWith('stale');
    expect(client.getFileContent).toHaveBeenCalledTimes(1);
  });

  it('recurses into subfolders', async () => {
    const client = mockSharePointClient();
    jest.mocked(client.listDocumentLibraries).mockResolvedValue([library('Docs', '/sites/x/Docs')]);
    jest
      .mocked(client.listFilesInFolder)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([file('d3', 'new', '/sites/x/Docs/sub/c.pdf')]);
    jest
      .mocked(client.listSubFolders)
      .mockResolvedValueOnce([{ Name: 'sub', ServerRelativeUrl: '/sites/x/Docs/sub' }])
      .mockResolvedValueOnce([]);
    jest.mocked(client.getFileContent).mockResolvedValue(Buffer.from('c'));

    const extractor: IDocumentExtractor = { extensions: ['pdf'], extract: async () => 't' };
    const embeddings: IEmbeddingProvider = { dimension: 2, embed: async () => [[1, 2]] };
    const store = {
      upsert: jest.fn(),
      query: jest.fn(),
      deleteByDocumentId: jest.fn(),
      getIndexedDocuments: jest.fn(async () => new Map()),
    } as unknown as IVectorStore;

    const indexer = new DocumentIndexer(
      client,
      extractor,
      { size: 100, overlap: 20 },
      embeddings,
      store,
    );
    await indexer.indexAll();

    expect(client.listFilesInFolder).toHaveBeenCalledTimes(2);
    expect(store.upsert).toHaveBeenCalledTimes(1);
  });

  it('registers the index job on the injected scheduler', () => {
    const client = mockSharePointClient();
    const extractor: IDocumentExtractor = { extensions: ['pdf'], extract: async () => '' };
    const embeddings: IEmbeddingProvider = { dimension: 2, embed: async () => [[1, 2]] };
    const store = {
      upsert: jest.fn(),
      query: jest.fn(),
      deleteByDocumentId: jest.fn(),
      getIndexedDocuments: jest.fn(),
    } as unknown as IVectorStore;
    const scheduler = jest.fn<Scheduler>(() => ({ stop: jest.fn() }));

    const indexer = new DocumentIndexer(
      client,
      extractor,
      { size: 100, overlap: 20 },
      embeddings,
      store,
      {
        schedule: '0 0 * * *',
        scheduler,
      },
    );
    indexer.startRagScheduler();

    expect(scheduler).toHaveBeenCalledWith('0 0 * * *', expect.any(Function));
  });
});
