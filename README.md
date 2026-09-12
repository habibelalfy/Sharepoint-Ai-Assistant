# SharePoint AI Project Management Assistant

A production-grade AI assistant that fronts **SharePoint Server 2019 (on-premises)**
using the **Model Context Protocol (MCP)**. Project managers query project, task,
milestone, and escalation data in natural language — and the assistant can act on
their behalf (create escalations, send scheduled alerts) with permission-aware,
audit-logged results. A **RAG add-on** (Phase 8) adds semantic search with
citations over unstructured documents in SharePoint document libraries.

> See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design, and
> [`docs/build-prompt.md`](docs/build-prompt.md) for the phased build plan this
> repo implements.

## How it works

```
SPFx web part / Claude Desktop / VS Code
        │  (MCP over stdio, or HTTP gateway for SPFx)
        ▼
MCP server (Node + TypeScript)  ◄── HTTP gateway (Express, auth, rate limit)
        ├── NTLM / Kerberos (SPNEGO) ──► SharePoint Server 2019 REST API
        │                                  (Lists + document libraries)
        └── RAG: plain HTTP / Postgres ──► pgvector + embedding server
                                            (containers, on-premises)
```

There are two consumption paths, both reaching the same MCP server:

- **stdio** — for desktop MCP clients (Claude Desktop, VS Code).
- **HTTP gateway** — an Express service (`POST /api/mcp/tool`) used by the SPFx web
  part. It authenticates the caller with a signed bearer token, applies rate
  limiting, and forwards to the MCP server over a persistent client connection.

Document search (`search_documents`, Phase 8) is an **additive** subsystem: the
assistant stays Kerberos-authenticated to SharePoint for structured data, while
document chunks are indexed into a self-hosted **pgvector** store and a
self-hosted **text-embeddings-inference** server (see
[`RAG_ARCHITECTURE.md`](RAG_ARCHITECTURE.md)).

## Prerequisites

- **Node.js ≥ 20** (CommonJS; see ADR-004).
- A **SharePoint Server 2019** project site with the lists described in
  [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md).
- A SharePoint **service account** (domain user) for REST calls.
- Optional: the [`kerberos`](https://www.npmjs.com/package/kerberos) native package
  for SPNEGO authentication (otherwise use `SHAREPOINT_AUTH_MODE=ntlm`).
- Optional (document search): **Docker** for the two RAG containers
  (`docker-compose.addendum.yml`).

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
#    …then edit .env with real SharePoint credentials and settings.

# 3. Build
npm run build
```

All configuration is environment-driven (ADR-003); no secrets are committed.

To enable document search, start the two RAG containers first:

```bash
docker compose -f docker-compose.addendum.yml up -d
```

…then set `EMBEDDING_API_BASE_URL` and `PGVECTOR_CONNECTION_STRING` in `.env`
(both are required to turn RAG on; set neither to leave it off).

### Environment variables

| Variable                     | Required | Description                                                            |
| ---------------------------- | -------- | ---------------------------------------------------------------------- |
| `SHAREPOINT_SITE_URL`        | yes      | Base URL of the project site (e.g. `http://sp-server/sites/projects`). |
| `SHAREPOINT_USERNAME`        | yes      | Service account for SharePoint REST calls.                             |
| `SHAREPOINT_PASSWORD`        | yes      | Service account password (source from a secret store in prod).         |
| `SHAREPOINT_DOMAIN`          | yes      | AD domain / Kerberos realm.                                            |
| `SHAREPOINT_AUTH_MODE`       | no       | `kerberos` (default) or `ntlm`.                                        |
| `LOG_LEVEL`                  | no       | pino level: `fatal`…`trace` (default `info`).                          |
| `ALERT_SCHEDULE_OVERDUE`     | no       | Cron for the overdue check (default `0 9 * * *`).                      |
| `ALERT_SCHEDULE_MILESTONES`  | no       | Cron for the upcoming-milestones check (default `0 10 * * *`).         |
| `ALERT_SCHEDULE_HEALTHCHECK` | no       | Cron for the weekly health check (default `0 8 * * 1`).                |
| `ALERT_RECIPIENTS`           | no       | Comma-separated email recipients for scheduled alerts.                 |
| `SMTP_HOST`                  | no       | When set, alerts send via SMTP (requires `npm i nodemailer`).          |
| `SMTP_PORT`                  | no       | SMTP port (default 25).                                                |
| `SMTP_FROM`                  | yes*     | From address; required when `SMTP_HOST` is set.                        |
| `HTTP_GATEWAY_PORT`          | no       | Gateway listen port (default 3001).                                    |
| `JWT_SIGNING_KEY`            | no       | Secret that signs gateway bearer tokens (use a long random value).     |
| `RAG_INDEX_SCHEDULE`         | no       | Cron for the document indexer (default `0 2 * * *`).                   |
| `RAG_CHUNK_SIZE`             | no       | Text chunk size in characters (default `1000`).                        |
| `RAG_CHUNK_OVERLAP`          | no       | Chunk overlap in characters (default `200`).                           |
| `EMBEDDING_API_BASE_URL`     | no*      | Self-hosted embedding server URL (enables RAG).                        |
| `EMBEDDING_API_KEY`          | no       | Placeholder key for the embedding server (default `not-needed`).       |
| `EMBEDDING_MODEL_NAME`       | no       | Model served by TEI (default `bge-large-en-v1.5`).                     |
| `EMBEDDING_DIMENSIONS`       | no       | Vector width (default `1024`).                                         |
| `PGVECTOR_CONNECTION_STRING` | no*      | PostgreSQL/pgvector connection string (enables RAG).                   |
| `LLM_API_BASE_URL`           | no       | OpenAI-compatible chat endpoint (enables the chat window).             |
| `LLM_API_KEY`                | no       | API key (placeholder `not-needed` for local models).                   |
| `LLM_MODEL`                  | no       | Model name (default `deepseek-chat`).                                  |
| `LLM_TEMPERATURE`            | no       | Sampling temperature (default `0`).                                    |
| `LLM_MAX_STEPS`              | no       | Tool-calling loop cap (default `8`).                                   |

\* conditionally required: `SMTP_FROM` when `SMTP_HOST` is set;
`EMBEDDING_API_BASE_URL` **and** `PGVECTOR_CONNECTION_STRING` together enable RAG
(set both, or neither).

## Running locally

```bash
# MCP server over stdio (for desktop clients)
npm start

# HTTP gateway (for the SPFx web part)
npm run start:gateway
```

## Run with Docker Desktop

Run the full stack (HTTP gateway + pgvector + embedding server) in containers:

```bash
# 1. Create the env file and fill in real SharePoint credentials.
cp .env.example .env

# 2. Build and start the stack.
docker compose up --build
```

Notes:

- The gateway authenticates to SharePoint over **NTLM** (forced by
  `docker-compose.yml`) — Kerberos needs domain membership, which is impractical
  inside a container. Set `SHAREPOINT_SITE_URL` to a URL the container can reach;
  if SharePoint runs on this host, use `http://host.docker.internal/...`.
- The gateway exposes `GET /health`, `POST /api/mcp/tool`, the chat UI at `/`,
  and `POST /api/chat` on `http://localhost:3001` (the chat endpoint is enabled
  only when `LLM_API_BASE_URL` is set).
- On first run, the embedding server downloads `BAAI/bge-large-en-v1.5`
  (~1.3 GB); the gateway restarts automatically until the model is ready.

### Connect a desktop client

- **VS Code** — `.vscode/mcp.json` is already configured to launch
  `node dist/server.js`.
- **Claude Desktop** — copy `claude_desktop_config.json` into Claude Desktop's
  config, replacing the placeholder path with the absolute path to
  `dist/server.js`.

The assistant's system prompt (with an auto-generated tool catalog) is
[`src/prompts/system-prompt.md`](src/prompts/system-prompt.md), regenerated via
`npm run generate:prompt`.

## Document search (RAG)

When enabled, the assistant exposes a `search_documents` tool that finds the most
relevant passages across your SharePoint document libraries and returns them with
citations (document title, library, source URL, last-modified, relevance score).
Retrieved chunks are filtered by the caller's Active Directory groups **before**
they reach the model, and every retrieval is audit-logged like any other tool call.

See [`RAG_ARCHITECTURE.md`](RAG_ARCHITECTURE.md) for the pipeline, schema, and
deployment topology.

## Chat assistant (LLM)

A built-in chat window (served by the gateway at `/`) lets users ask questions in
natural language. An LLM drives the assistant's tools (SharePoint structured data

- document search) and composes the answer. It's optional — enable it by setting
  `LLM_API_BASE_URL` to any OpenAI-compatible endpoint:

```bash
# Public (DeepSeek)
LLM_API_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-…
LLM_MODEL=deepseek-chat

# Local (Ollama on the host; from Docker use http://host.docker.internal:11434/v1)
LLM_API_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5
```

Then start the gateway, open `http://localhost:3001`, and paste a bearer token
generated with:

```bash
npm run mint-token -- <userId>
```

The model must support tool/function calling (DeepSeek `deepseek-chat`, or local
models such as `qwen2.5`, `llama3.1`, or `mistral`).

## Scripts

| Script                            | Purpose                                                         |
| --------------------------------- | --------------------------------------------------------------- |
| `npm run build`                   | Compile TypeScript to `dist/`.                                  |
| `npm run typecheck`               | Type-check without emitting.                                    |
| `npm start`                       | Run the MCP server (stdio).                                     |
| `npm run start:gateway`           | Run the HTTP gateway.                                           |
| `npm test`                        | Run the Jest suite.                                             |
| `npm run test:coverage`           | Run tests with coverage thresholds.                             |
| `npm run smoke:test`              | End-to-end smoke test (needs a configured `.env` + SharePoint). |
| `npm run mint-token`              | Mint a bearer token for the chat UI.                            |
| `npm run generate:prompt`         | Regenerate the system-prompt tool catalog.                      |
| `npm run lint` / `lint:fix`       | ESLint.                                                         |
| `npm run format` / `format:check` | Prettier.                                                       |

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — design, ADRs, repository layout.
- [`RAG_ARCHITECTURE.md`](RAG_ARCHITECTURE.md) — document-search pipeline & topology.
- [`USER_GUIDE.md`](USER_GUIDE.md) — for project managers using the assistant.
- [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) — for SharePoint administrators.
- [`SECURITY.md`](SECURITY.md) — permission model, audit, rate limiting, secrets.
- [`docs/deployment.md`](docs/deployment.md) — production deployment, SSL, rollback.
- [`TESTING.md`](TESTING.md) — test strategy and the end-to-end checklist.

## License

MIT — see [`LICENSE`](LICENSE).
