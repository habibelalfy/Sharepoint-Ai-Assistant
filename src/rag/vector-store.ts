/**
 * pgvector-backed vector store for document chunks.
 *
 * Uses the `pg` driver with parameterized SQL only (no ORM).
 *
 * @module rag/vector-store
 */
import { Pool } from 'pg';
import { VectorStoreError } from '../errors';
import type { DocumentChunk, RetrievedChunk, VectorQueryFilters } from './types';

/** Persistence contract for chunk vectors. */
export interface IVectorStore {
  /** Inserts/updates chunks (replacing all chunks of each referenced document). */
  upsert(chunks: DocumentChunk[]): Promise<void>;
  /** Returns the top-K chunks by cosine similarity, optionally filtered. */
  query(vector: number[], topK: number, filters?: VectorQueryFilters): Promise<RetrievedChunk[]>;
  /** Removes a document and all of its chunks. */
  deleteByDocumentId(documentId: string): Promise<void>;
  /** Returns the current (documentId → etag) sync state for incremental indexing. */
  getIndexedDocuments(): Promise<Map<string, string>>;
}

/** pgvector store backed by a `pg` connection pool. */
export class PgVectorStore implements IVectorStore {
  private readonly pool: Pool;
  private readonly dimension: number;

  /**
   * @param connectionString - PostgreSQL/pgvector connection string.
   * @param dimension - Expected vector width (validated positive integer in config).
   */
  public constructor(connectionString: string, dimension: number) {
    this.pool = new Pool({ connectionString });
    this.dimension = dimension;
  }

  /** Creates the pgvector extension, tables, and index (idempotent). */
  public async initSchema(): Promise<void> {
    try {
      await this.pool.query('CREATE EXTENSION IF NOT EXISTS vector');
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS documents (
          document_id    text PRIMARY KEY,
          document_title text NOT NULL,
          library_name   text NOT NULL,
          source_url     text NOT NULL,
          last_modified  text NOT NULL,
          etag           text NOT NULL,
          updated_at     timestamptz NOT NULL DEFAULT now()
        )
      `);
      await this.pool.query(`
        CREATE TABLE IF NOT EXISTS document_chunks (
          chunk_id         uuid PRIMARY KEY,
          document_id      text NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
          chunk_index      integer NOT NULL,
          text             text NOT NULL,
          permitted_groups text[] NOT NULL DEFAULT '{}',
          project_id       integer,
          embedding        vector(${this.dimension}) NOT NULL
        )
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
        ON document_chunks USING hnsw (embedding vector_cosine_ops)
      `);
      await this.pool.query(`
        CREATE INDEX IF NOT EXISTS document_chunks_document_idx
        ON document_chunks (document_id)
      `);
    } catch (cause) {
      throw new VectorStoreError('Failed to initialize the vector store schema', { cause });
    }
  }

  public async upsert(chunks: DocumentChunk[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }
    const byDocument = new Map<string, DocumentChunk[]>();
    for (const chunk of chunks) {
      const list = byDocument.get(chunk.documentId) ?? [];
      list.push(chunk);
      byDocument.set(chunk.documentId, list);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const [documentId, documentChunks] of byDocument) {
        const head = documentChunks[0];
        if (!head) {
          continue;
        }
        await client.query(
          `INSERT INTO documents
             (document_id, document_title, library_name, source_url, last_modified, etag)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (document_id) DO UPDATE SET
             document_title = EXCLUDED.document_title,
             library_name   = EXCLUDED.library_name,
             source_url     = EXCLUDED.source_url,
             last_modified  = EXCLUDED.last_modified,
             etag           = EXCLUDED.etag,
             updated_at     = now()`,
          [
            documentId,
            head.documentTitle,
            head.libraryName,
            head.sourceUrl,
            head.lastModified,
            head.etag,
          ],
        );
        await client.query('DELETE FROM document_chunks WHERE document_id = $1', [documentId]);
        for (const chunk of documentChunks) {
          if (!chunk.embedding) {
            throw new VectorStoreError(`Chunk ${chunk.id} has no embedding`);
          }
          await client.query(
            `INSERT INTO document_chunks
               (chunk_id, document_id, chunk_index, text, permitted_groups, project_id, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
            [
              chunk.id,
              chunk.documentId,
              chunk.chunkIndex,
              chunk.text,
              chunk.permittedGroups ?? [],
              chunk.projectId ?? null,
              toPgVector(chunk.embedding),
            ],
          );
        }
      }
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new VectorStoreError('Failed to upsert document chunks', { cause });
    } finally {
      client.release();
    }
  }

  public async query(
    vector: number[],
    topK: number,
    filters: VectorQueryFilters = {},
  ): Promise<RetrievedChunk[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters.projectId !== undefined) {
      params.push(filters.projectId);
      conditions.push(`c.project_id = $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(toPgVector(vector), topK);
    const vectorParam = params.length - 1;
    const limitParam = params.length;

    try {
      const result = await this.pool.query(
        `SELECT c.chunk_id, c.document_id, c.text, c.chunk_index,
                d.document_title, d.library_name, d.source_url, d.last_modified, d.etag,
                c.permitted_groups, c.project_id,
                1 - (c.embedding <=> $${vectorParam}::vector) AS score
         FROM document_chunks c
         JOIN documents d ON d.document_id = c.document_id
         ${where}
         ORDER BY c.embedding <=> $${vectorParam}::vector
         LIMIT $${limitParam}`,
        params,
      );
      return result.rows.map((row) => ({
        id: row.chunk_id as string,
        documentId: row.document_id as string,
        text: row.text as string,
        chunkIndex: row.chunk_index as number,
        documentTitle: row.document_title as string,
        libraryName: row.library_name as string,
        sourceUrl: row.source_url as string,
        lastModified: row.last_modified as string,
        etag: row.etag as string,
        permittedGroups: row.permitted_groups as string[],
        projectId: row.project_id === null ? undefined : (row.project_id as number),
        score: Number(row.score),
      }));
    } catch (cause) {
      throw new VectorStoreError('Vector similarity query failed', { cause });
    }
  }

  public async deleteByDocumentId(documentId: string): Promise<void> {
    try {
      await this.pool.query('DELETE FROM documents WHERE document_id = $1', [documentId]);
    } catch (cause) {
      throw new VectorStoreError(`Failed to delete document ${documentId}`, { cause });
    }
  }

  public async getIndexedDocuments(): Promise<Map<string, string>> {
    try {
      const result = await this.pool.query<{ document_id: string; etag: string }>(
        'SELECT document_id, etag FROM documents',
      );
      return new Map(result.rows.map((row) => [row.document_id, row.etag]));
    } catch (cause) {
      throw new VectorStoreError('Failed to read index state', { cause });
    }
  }

  /** Closes the underlying pool (for graceful shutdown/tests). */
  public async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Serializes a numeric vector to pgvector's literal `[a,b,c,…]` form. */
function toPgVector(vector: number[]): string {
  return `[${vector.join(',')}]`;
}
