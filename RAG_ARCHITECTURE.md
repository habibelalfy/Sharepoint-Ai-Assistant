# RAG Architecture — Semantic Search over SharePoint Document Libraries

> Add-on subsystem (Phase 8). This supplements — never replaces — the
> structured-data OData/CSOM tools documented in [`ARCHITECTURE.md`](../ARCHITECTURE.md).

## 1. Purpose

Semantic search with citations over unstructured documents (charters, contracts,
status reports, meeting notes) in SharePoint document libraries, at enterprise
scale (thousands of documents, growing). A new MCP tool `search_documents` lets
the assistant answer questions with quoted source chunks, filtered by the
caller's AD-group permissions before anything reaches the model prompt.

## 2. Deployment topology

```
┌──────────────────────────── native Windows host (unchanged) ────────────────────────────┐
│  MCP server (stdio)  │  HTTP gateway  │  cron scheduler (alerts + RAG indexer job)      │
│         └──────────────┴───────────────┴────────────┬──────────────┐                    │
│                                                     │ Kerberos     │ HTTP/Postgres wire │
└─────────────────────────────────────────────────────┼──────────────┼────────────────────┘
                                                      ▼              ▼
                                           SharePoint On-Prem    ┌───────────────────────┐
                                           (document libraries)  │ pgvector (container)  │
                                                                 │ embedding server      │
                                                                 │ (container, TEI)      │
                                                                 └───────────────────────┘
```

- The existing app keeps running **native** on the domain-joined host, unchanged.
  The RAG indexer job is added to the **same** `node-cron` scheduler as the alert
  jobs — no second app process.
- Two **net-new containers**: PostgreSQL + pgvector, and the self-hosted
  text-embeddings-inference (TEI) server (`BAAI/bge-large-en-v1.5`).
- The app↔container boundary is **plain HTTP / Postgres wire protocol only** — no
  Kerberos crosses it, and **no request ever targets a public cloud endpoint**.
- See [`docker-compose.addendum.yml`](../docker-compose.addendum.yml).

## 3. Pipeline

1. **Crawl** — `DocumentIndexer` enumerates document libraries via the extended
   `SharePointClient.listDocumentLibraries()` and walks folders recursively
   (`listFilesInFolder` / `listSubFolders`).
2. **Change detection** — per-file `ETag` (fallback `TimeLastModified`) is compared
   against the `documents` table; only changed files are re-indexed and deleted
   files are removed (`deleteByDocumentId`).
3. **Extract** — `IDocumentExtractor` implementations: PDF (`pdf-parse`), DOCX
   (`mammoth`), PPTX (`officeparser`), plaintext.
4. **Chunk** — character-based sliding window (`RAG_CHUNK_SIZE` /
   `RAG_CHUNK_OVERLAP`), preserving `documentId`, `documentTitle`, `libraryName`,
   `sourceUrl`, `lastModified`, and (optionally) `PermittedGroups` / `ProjectId`.
5. **Embed** — `OpenAIEmbeddingProvider` uses the official `openai` SDK with
   `baseURL` pointed at the TEI container (`EMBEDDING_API_BASE_URL`).
6. **Store** — `PgVectorStore` upserts chunk vectors into pgvector.
7. **Retrieve** — `RetrievalService` embeds the query, runs a cosine-similarity
   query, then filters results through the existing
   `PermissionService.filterByPermissions` **before** returning them.

## 4. Schema & index

- `documents` — one row per source file (`document_id` = SharePoint `UniqueId`),
  carrying `etag` for incremental sync.
- `document_chunks` — chunk text + `embedding vector(1024)` + `permitted_groups
text[]` + optional `project_id`.
- **Index**: HNSW over `embedding` with `vector_cosine_ops` (approximate
  nearest-neighbour; scales to large corpora). See
  [`sql/001_document_chunks.sql`](../sql/001_document_chunks.sql).
- `EMBEDDING_DIMENSIONS` (default **1024**) is a named constant used consistently
  by the schema, the startup dimension check, and the embedding provider.

## 5. Permission & audit (reuses Phases 0–7)

- Each chunk carries `permittedGroups` (from the file's `ListItemAllFields`
  `PermittedGroups` column — the same convention as the structured lists; empty =
  public). `RetrievalService` filters chunks via
  `PermissionService.filterByPermissions` before they reach the model.
- Every `search_documents` call is audit-logged like any other tool: `logAIAction`
  (via the shared `withAudit` wrapper) plus one `logDataAccess` entry per cited
  chunk source — same `AuditService`, same log shape, no new logging path.

## 6. Configuration

All tunables are environment-driven (see [`.env.example`](../.env.example)):

`RAG_INDEX_SCHEDULE`, `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`,
`EMBEDDING_API_BASE_URL`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL_NAME`,
`EMBEDDING_DIMENSIONS`, `PGVECTOR_CONNECTION_STRING`.

RAG is **enabled** only when both `EMBEDDING_API_BASE_URL` and
`PGVECTOR_CONNECTION_STRING` are set; setting exactly one is a `ConfigError`
(fail fast). When disabled, `search_documents` is still registered but returns a
clear "not configured" error, and no indexer/embedding traffic occurs.
