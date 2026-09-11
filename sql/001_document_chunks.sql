-- RAG document index schema (pgvector).
--
-- Applied idempotently at startup by PgVectorStore.initSchema(); this file is
-- the canonical reference. The `vector(1024)` width MUST match
-- EMBEDDING_DIMENSIONS (BAAI/bge-large-en-v1.5 produces 1024-dim vectors).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS documents (
  document_id    text PRIMARY KEY,
  document_title text NOT NULL,
  library_name   text NOT NULL,
  source_url     text NOT NULL,
  last_modified  text NOT NULL,
  etag           text NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS document_chunks (
  chunk_id         uuid PRIMARY KEY,
  document_id      text NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
  chunk_index      integer NOT NULL,
  text             text NOT NULL,
  permitted_groups text[] NOT NULL DEFAULT '{}',
  project_id       integer,
  embedding        vector(1024) NOT NULL
);

-- Approximate-nearest-neighbour index for cosine similarity.
CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS document_chunks_document_idx
  ON document_chunks (document_id);
