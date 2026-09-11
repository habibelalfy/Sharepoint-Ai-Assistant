/**
 * Text chunking for RAG indexing.
 *
 * @module rag/chunking
 */

export interface ChunkingOptions {
  /** Maximum chunk size in characters. */
  size: number;
  /** Character overlap between consecutive chunks. */
  overlap: number;
}

/**
 * Splits text into overlapping, roughly equal-size chunks.
 *
 * Chunking is character-based (no tokenizer dependency); it is a pragmatic fit
 * for BAAI/bge embeddings, which tokenize internally.
 *
 * @param text - Source text.
 * @param options - Chunk size/overlap (overlap must be `< size`).
 * @returns Chunks in document order (empty for empty/whitespace input).
 */
export function chunkText(text: string, options: ChunkingOptions): string[] {
  const { size, overlap } = options;
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) {
    return [];
  }
  if (normalized.length <= size) {
    return [normalized];
  }
  const step = Math.max(1, size - overlap);
  const chunks: string[] = [];
  for (let start = 0; start < normalized.length; start += step) {
    const chunk = normalized.slice(start, start + size).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    if (start + size >= normalized.length) {
      break;
    }
  }
  return chunks;
}
