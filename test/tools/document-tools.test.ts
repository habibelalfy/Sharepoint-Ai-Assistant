import { describe, expect, it, jest } from '@jest/globals';
import { ConfigError } from '../../src/errors';
import { RetrievalService } from '../../src/rag/retrieval-service';
import type { RetrievedChunk } from '../../src/rag/types';
import type { AuditService } from '../../src/services/audit-service';
import {
  createSearchDocumentsHandler,
  searchDocumentsSchema,
} from '../../src/tools/document-tools';
import { resultText } from '../helpers';

const chunk: RetrievedChunk = {
  id: 'c1',
  documentId: 'd1',
  documentTitle: 'Charter.pdf',
  libraryName: 'Docs',
  sourceUrl: '/sites/x/Docs/Charter.pdf',
  lastModified: '2024-01-01',
  etag: '1',
  chunkIndex: 0,
  text: 'ACME shall deliver...',
  permittedGroups: [],
  score: 0.95,
};

describe('search_documents tool', () => {
  it('rejects invalid input via schema', () => {
    expect(searchDocumentsSchema.query.safeParse('').success).toBe(false);
    expect(searchDocumentsSchema.userId.safeParse('').success).toBe(false);
    expect(searchDocumentsSchema.query.safeParse('budget').success).toBe(true);
  });

  it('returns cited chunks and logs data access', async () => {
    const retrieval = {
      retrieveRelevantChunks: jest.fn(async () => [chunk]),
    } as unknown as RetrievalService;
    const audit = { logDataAccess: jest.fn(async () => undefined) } as unknown as AuditService;
    const handler = createSearchDocumentsHandler(retrieval, { audit });

    const result = await handler({ query: 'budget', userId: 'alice' });
    const parsed = JSON.parse(resultText(result));

    expect(retrieval.retrieveRelevantChunks).toHaveBeenCalledWith('budget', 'alice', {
      projectId: undefined,
    });
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toMatchObject({
      text: 'ACME shall deliver...',
      documentTitle: 'Charter.pdf',
      sourceUrl: '/sites/x/Docs/Charter.pdf',
    });
    expect(audit.logDataAccess).toHaveBeenCalledWith({
      listName: 'Docs',
      action: 'READ',
      userId: 'alice',
      timestamp: expect.any(String),
    });
  });

  it('throws ConfigError when retrieval is not configured', async () => {
    const handler = createSearchDocumentsHandler(undefined);
    await expect(handler({ query: 'q', userId: 'u' })).rejects.toBeInstanceOf(ConfigError);
  });

  it('parses an optional projectId', async () => {
    const retrieval = {
      retrieveRelevantChunks: jest.fn(async () => []),
    } as unknown as RetrievalService;
    const handler = createSearchDocumentsHandler(retrieval);

    await handler({ query: 'q', userId: 'u', projectId: '42' });
    expect(retrieval.retrieveRelevantChunks).toHaveBeenCalledWith('q', 'u', { projectId: 42 });
  });
});
