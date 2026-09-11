import { describe, expect, it, jest } from '@jest/globals';
import { PermissionService } from '../../src/services/permission-service';
import type { IEmbeddingProvider } from '../../src/rag/embeddings';
import { RetrievalService } from '../../src/rag/retrieval-service';
import type { RetrievedChunk } from '../../src/rag/types';
import type { IVectorStore } from '../../src/rag/vector-store';

function chunk(id: string, permittedGroups?: string[]): RetrievedChunk {
  return {
    id,
    documentId: 'd',
    documentTitle: 't',
    libraryName: 'l',
    sourceUrl: '/s',
    lastModified: 'x',
    etag: '1',
    chunkIndex: 0,
    text: id,
    permittedGroups,
    score: 0.9,
  };
}

describe('RetrievalService.retrieveRelevantChunks', () => {
  it('embeds, queries, and returns permission-filtered chunks', async () => {
    const embeddings: IEmbeddingProvider = {
      dimension: 3,
      embed: jest.fn(async () => [[1, 2, 3]]),
    };
    const store = {
      upsert: jest.fn(),
      query: jest.fn(async () => [
        chunk('public'),
        chunk('pmo', ['PMO']),
        chunk('eng', ['Engineering']),
      ]),
      deleteByDocumentId: jest.fn(),
      getIndexedDocuments: jest.fn(),
    } as unknown as IVectorStore;
    const permissions = new PermissionService({ getUserADGroups: async () => ['PMO'] });

    const service = new RetrievalService(embeddings, store, permissions);
    const result = await service.retrieveRelevantChunks('query', 'alice', { topK: 5 });

    expect(embeddings.embed).toHaveBeenCalledWith(['query']);
    expect(store.query).toHaveBeenCalledWith([1, 2, 3], 5, { projectId: undefined });
    expect(result.map((chunk) => chunk.text)).toEqual(['public', 'pmo']);
  });

  it('passes the projectId filter through to the store', async () => {
    const embeddings: IEmbeddingProvider = { dimension: 3, embed: async () => [[1, 2, 3]] };
    const store = {
      upsert: jest.fn(),
      query: jest.fn(async () => []),
      deleteByDocumentId: jest.fn(),
      getIndexedDocuments: jest.fn(),
    } as unknown as IVectorStore;
    const permissions = new PermissionService();
    const service = new RetrievalService(embeddings, store, permissions);

    await service.retrieveRelevantChunks('q', 'alice', { projectId: 7 });
    expect(store.query).toHaveBeenCalledWith([1, 2, 3], 5, { projectId: 7 });
  });
});
