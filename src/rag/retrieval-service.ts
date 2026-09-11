/**
 * Semantic retrieval: embed → pgvector similarity search → permission filter.
 *
 * @module rag/retrieval-service
 */
import { EmbeddingProviderError } from '../errors';
import { PermissionService } from '../services/permission-service';
import type { IEmbeddingProvider } from './embeddings';
import type { RetrievedChunk } from './types';
import type { IVectorStore } from './vector-store';

/** Retrieval tuning options. */
export interface RetrievalOptions {
  /** Maximum number of chunks to return (default 5). */
  topK?: number;
  /** Optional project filter. */
  projectId?: number;
}

const DEFAULT_TOP_K = 5;

export class RetrievalService {
  public constructor(
    private readonly embeddings: IEmbeddingProvider,
    private readonly vectorStore: IVectorStore,
    private readonly permissions: PermissionService,
  ) {}

  /**
   * Retrieves the chunks most relevant to `query`, filtered to those the
   * caller's AD groups may see.
   *
   * @param query - Natural-language search query.
   * @param userId - Authenticated caller.
   * @param options - topK / projectId tuning.
   * @returns Permission-filtered chunks with source metadata, best first.
   */
  public async retrieveRelevantChunks(
    query: string,
    userId: string,
    options: RetrievalOptions = {},
  ): Promise<RetrievedChunk[]> {
    const vectors = await this.embeddings.embed([query]);
    const vector = vectors[0];
    if (!vector) {
      throw new EmbeddingProviderError('Embedding server returned no vector for the query');
    }
    const candidates = await this.vectorStore.query(vector, options.topK ?? DEFAULT_TOP_K, {
      projectId: options.projectId,
    });
    const groups = await this.permissions.resolveGroups(userId);
    return this.permissions.filterByPermissions(candidates, 'permittedGroups', groups);
  }
}
