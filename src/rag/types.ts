/**
 * Shared types for the RAG (retrieval-augmented generation) subsystem.
 *
 * @module rag/types
 */

/** A single indexed text chunk and its source metadata. */
export interface DocumentChunk {
  /** Unique chunk id (UUID). */
  id: string;
  /** SharePoint document `UniqueId` this chunk belongs to. */
  documentId: string;
  /** Human-readable document title (file name). */
  documentTitle: string;
  /** Document library the file lives in. */
  libraryName: string;
  /** Server-relative URL of the source file (for citation). */
  sourceUrl: string;
  /** Source file's last-modified timestamp. */
  lastModified: string;
  /** Source file's ETag (denormalized per chunk for incremental sync). */
  etag: string;
  /** Zero-based index of this chunk within the document. */
  chunkIndex: number;
  /** Extracted text for this chunk. */
  text: string;
  /** Dense vector for this chunk (set before upsert). */
  embedding?: number[];
  /** AD groups allowed to view this chunk; empty/absent = public. */
  permittedGroups?: string[];
  /** Optional project this document belongs to (for `projectId` filtering). */
  projectId?: number;
}

/** A chunk returned from a similarity search, with its relevance score. */
export interface RetrievedChunk extends DocumentChunk {
  /** Cosine similarity in [0, 1] (higher = more relevant). */
  score: number;
}

/** Optional filters applied to a vector-store similarity query. */
export interface VectorQueryFilters {
  projectId?: number;
}
