import { beforeEach, describe, expect, it, jest } from '@jest/globals';

type QueryFn = (query: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
type ConnectFn = () => Promise<{ query: QueryFn; release: () => void }>;
type EndFn = () => Promise<void>;

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    query: jest.fn<QueryFn>(),
    connect: jest.fn<ConnectFn>(),
    end: jest.fn<EndFn>(),
  })),
}));

import { Pool } from 'pg';
import { VectorStoreError } from '../../src/errors';
import type { DocumentChunk } from '../../src/rag/types';
import { PgVectorStore } from '../../src/rag/vector-store';

const MockPool = Pool as unknown as jest.Mock;

function pool(): {
  query: jest.Mock<QueryFn>;
  connect: jest.Mock<ConnectFn>;
  end: jest.Mock<EndFn>;
} {
  const value = MockPool.mock.results[0]?.value;
  if (!value) {
    throw new Error('Pool mock was not constructed');
  }
  return value as unknown as {
    query: jest.Mock<QueryFn>;
    connect: jest.Mock<ConnectFn>;
    end: jest.Mock<EndFn>;
  };
}

const chunk = (overrides: Partial<DocumentChunk> = {}): DocumentChunk => ({
  id: 'c1',
  documentId: 'd1',
  documentTitle: 't',
  libraryName: 'l',
  sourceUrl: '/s',
  lastModified: 'x',
  etag: '1',
  chunkIndex: 0,
  text: 'hello',
  embedding: [1, 2, 3],
  ...overrides,
});

describe('PgVectorStore', () => {
  beforeEach(() => {
    MockPool.mockClear();
  });

  it('initSchema creates extension, tables, and hnsw index', async () => {
    const store = new PgVectorStore('postgres://x', 1024);
    await store.initSchema();
    expect(pool().query).toHaveBeenCalledWith('CREATE EXTENSION IF NOT EXISTS vector');
    expect(pool().query).toHaveBeenCalledWith(
      expect.stringContaining('CREATE TABLE IF NOT EXISTS document_chunks'),
    );
    expect(pool().query).toHaveBeenCalledWith(expect.stringContaining('vector(1024)'));
    expect(pool().query).toHaveBeenCalledWith(expect.stringContaining('USING hnsw'));
  });

  it('upsert groups chunks by document within a transaction', async () => {
    const clientQuery = jest.fn<QueryFn>();
    const store = new PgVectorStore('postgres://x', 1024);
    pool().connect.mockResolvedValue({ query: clientQuery, release: jest.fn() });

    await store.upsert([chunk(), chunk({ id: 'c2', chunkIndex: 1 })]);

    expect(pool().connect).toHaveBeenCalled();
    expect(clientQuery).toHaveBeenCalledWith('BEGIN');
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO documents'),
      expect.any(Array),
    );
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO document_chunks'),
      expect.any(Array),
    );
    expect(clientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('query maps rows to RetrievedChunk', async () => {
    const store = new PgVectorStore('postgres://x', 1024);
    pool().query.mockResolvedValue({
      rows: [
        {
          chunk_id: 'c1',
          document_id: 'd1',
          text: 'hi',
          chunk_index: 0,
          document_title: 't',
          library_name: 'l',
          source_url: '/s',
          last_modified: 'x',
          etag: '1',
          permitted_groups: ['PMO'],
          project_id: 7,
          score: 0.9,
        },
      ],
    });

    const result = await store.query([1, 2, 3], 5);
    expect(result[0]).toMatchObject({
      id: 'c1',
      text: 'hi',
      permittedGroups: ['PMO'],
      projectId: 7,
      score: 0.9,
    });
  });

  it('deleteByDocumentId deletes a document', async () => {
    const store = new PgVectorStore('postgres://x', 1024);
    await store.deleteByDocumentId('d1');
    expect(pool().query).toHaveBeenCalledWith('DELETE FROM documents WHERE document_id = $1', [
      'd1',
    ]);
  });

  it('getIndexedDocuments returns the document→etag map', async () => {
    const store = new PgVectorStore('postgres://x', 1024);
    pool().query.mockResolvedValue({ rows: [{ document_id: 'd1', etag: 'e1' }] });
    const map = await store.getIndexedDocuments();
    expect(map.get('d1')).toBe('e1');
  });

  it('wraps failures in VectorStoreError', async () => {
    const store = new PgVectorStore('postgres://x', 1024);
    pool().query.mockRejectedValue(new Error('boom'));
    await expect(store.initSchema()).rejects.toBeInstanceOf(VectorStoreError);
  });
});
