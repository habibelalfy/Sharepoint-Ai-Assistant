/**
 * Document-retrieval MCP tool: semantic search with citations over document
 * libraries (RAG subsystem, Phase 8).
 *
 * @module tools/document-tools
 */
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ConfigError } from '../errors';
import { RetrievalService } from '../rag/retrieval-service';
import { NoopAuditService, type AuditService } from '../services/audit-service';
import { parseId, textResult } from './common';

/** Injectable dependencies for the search tool (audit). */
export interface DocumentToolOptions {
  audit?: AuditService;
}

export const searchDocumentsSchema = {
  query: z.string().min(1),
  projectId: z.string().optional(),
  userId: z.string().min(1),
};

export interface SearchDocumentsArgs {
  query: string;
  projectId?: string;
  userId: string;
}

export function createSearchDocumentsHandler(
  retrieval: RetrievalService | undefined,
  options: DocumentToolOptions = {},
) {
  return async (args: SearchDocumentsArgs): Promise<CallToolResult> => {
    if (!retrieval) {
      throw new ConfigError(
        'Document search (RAG) is not configured. Set PGVECTOR_CONNECTION_STRING and EMBEDDING_API_BASE_URL.',
      );
    }
    const audit = options.audit ?? new NoopAuditService();
    const projectId = args.projectId !== undefined ? parseId(args.projectId) : undefined;
    const chunks = await retrieval.retrieveRelevantChunks(args.query, args.userId, { projectId });

    const timestamp = new Date().toISOString();
    for (const chunk of chunks) {
      await audit.logDataAccess({
        listName: chunk.libraryName,
        action: 'READ',
        userId: args.userId,
        timestamp,
      });
    }

    return textResult({
      query: args.query,
      results: chunks.map((chunk) => ({
        text: chunk.text,
        documentTitle: chunk.documentTitle,
        libraryName: chunk.libraryName,
        sourceUrl: chunk.sourceUrl,
        lastModified: chunk.lastModified,
        score: chunk.score,
      })),
    });
  };
}
