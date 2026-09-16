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

| Variable                      | Required | Description                                                            |
| ----------------------------- | -------- | ---------------------------------------------------------------------- |
| `SHAREPOINT_SITE_URL`         | yes      | Base URL of the project site (e.g. `http://sp-server/sites/projects`). |
| `SHAREPOINT_USERNAME`         | yes      | Service account for SharePoint REST calls.                             |
| `SHAREPOINT_PASSWORD`         | yes      | Service account password (source from a secret store in prod).         |
| `SHAREPOINT_DOMAIN`           | yes      | AD domain / Kerberos realm.                                            |
| `SHAREPOINT_AUTH_MODE`        | no       | `kerberos` (default) or `ntlm`.                                        |
| `PROJECT_PLAN_WRITE_USERS`    | no       | Users allowed to publish generated Project Server plans.               |
| `PROJECT_PLAN_WRITE_PROJECTS` | no       | Project GUIDs eligible for generated plan publishing.                  |
| `LOG_LEVEL`                   | no       | pino level: `fatal`…`trace` (default `info`).                          |
| `ALERT_SCHEDULE_OVERDUE`      | no       | Cron for the overdue check (default `0 9 * * *`).                      |
| `ALERT_SCHEDULE_MILESTONES`   | no       | Cron for the upcoming-milestones check (default `0 10 * * *`).         |
| `ALERT_SCHEDULE_HEALTHCHECK`  | no       | Cron for the weekly health check (default `0 8 * * 1`).                |
| `ALERT_RECIPIENTS`            | no       | Comma-separated email recipients for scheduled alerts.                 |
| `SMTP_HOST`                   | no       | When set, alerts send via SMTP (requires `npm i nodemailer`).          |
| `SMTP_PORT`                   | no       | SMTP port (default 25).                                                |
| `SMTP_FROM`                   | yes*     | From address; required when `SMTP_HOST` is set.                        |
| `HTTP_GATEWAY_PORT`           | no       | Gateway listen port (default 3001).                                    |
| `JWT_SIGNING_KEY`             | no       | Secret that signs gateway bearer tokens (use a long random value).     |
| `RAG_INDEX_SCHEDULE`          | no       | Cron for the document indexer (default `0 2 * * *`).                   |
| `RAG_CHUNK_SIZE`              | no       | Text chunk size in characters (default `1000`).                        |
| `RAG_CHUNK_OVERLAP`           | no       | Chunk overlap in characters (default `200`).                           |
| `EMBEDDING_API_BASE_URL`      | no*      | Self-hosted embedding server URL (enables RAG).                        |
| `EMBEDDING_API_KEY`           | no       | Placeholder key for the embedding server (default `not-needed`).       |
| `EMBEDDING_MODEL_NAME`        | no       | Model served by TEI (default `bge-large-en-v1.5`).                     |
| `EMBEDDING_DIMENSIONS`        | no       | Vector width (default `1024`).                                         |
| `PGVECTOR_CONNECTION_STRING`  | no*      | PostgreSQL/pgvector connection string (enables RAG).                   |
| `LLM_API_BASE_URL`            | no       | OpenAI-compatible chat endpoint (enables the chat window).             |
| `LLM_API_KEY`                 | no       | API key (placeholder `not-needed` for local models).                   |
| `LLM_MODEL`                   | no       | Model name (default `deepseek-v4-pro`).                                 |
| `LLM_TEMPERATURE`             | no       | Sampling temperature (default `0`).                                    |
| `LLM_MAX_STEPS`               | no       | Tool-calling loop cap (default `8`).                                   |
| `LLM_MAX_TOKENS`              | no       | Max completion tokens per LLM turn (default `8192`).                   |

\* conditionally required: `SMTP_FROM` when `SMTP_HOST` is set;
`EMBEDDING_API_BASE_URL` **and** `PGVECTOR_CONNECTION_STRING` together enable RAG
(set both, or neither).

## Running locally

### Project Server / PWA sites

For existing Project Server projects such as `hexacloud`, set
`SHAREPOINT_DATA_SOURCE=project-server` in `.env`. This mode reads
`/_api/ProjectServer/Projects` and published tasks directly. It preserves GUID
IDs and exposes project search, project details, tasks, milestones, statistics,
project creation, direct project-site document reading, plan preview/publishing, and caller-scoped
audit queries. Empty task collections mean no **published** tasks were returned.
Plan publishing is additive and is denied unless both project-plan allowlists
match the authenticated user and target project GUID.

Plans can be authored two ways. The document path stages a specification with
`stage_project_document`, then reads it with `search_project_documents` /
`read_project_document`, previews with `prepare_project_plan`, and publishes with
`publish_project_plan`. For Golden Template plans authored from a pasted
specification, `prepare_project_plan_from_spec` previews a plan directly (no
source document required) and the same `publish_project_plan` writes it; build
large plans in phase-by-phase chunks to stay within a single LLM turn.

To create a project, ask the assistant `Create a new project named openstack`.
The `create_project` tool uses the connected account's Project Server creation
permissions, validates the name, checks for an exact existing name, and verifies
the returned GUID. Repeated requests return the existing project rather than
adding a duplicate. It creates the project record only; tasks and document-site
provisioning are separate operations. If a write cannot be verified, inspect the
reported GUID before retrying. Pending-write protection is local to the running
client; it does not survive restarts or coordinate separate gateway instances.

Use SharePoint's configured web-application hostname in `SHAREPOINT_SITE_URL`
(for this deployment, `http://bshare/sites/PWA`). An IP URL may be rejected by
SharePoint's alternate access mappings. Docker resolves this hostname through
`SHAREPOINT_HOST_NAME` and `SHAREPOINT_HOST_IP` (defaults: `bshare` and
`192.168.122.44`); update both if the VM address or hostname changes.

Access uses the configured SharePoint service account. Only issue gateway tokens
to users authorized to use that account's project read and creation permissions; this mode does not
implement per-user AD permission trimming. Custom-list escalation tools, alerts,
and the custom-column document indexer are not started in this mode. The original
integration remains available with `SHAREPOINT_DATA_SOURCE=lists`.

Project Server audit events are written to `/app/data/audit.jsonl` in the Docker
`assistant_data` volume. This avoids requiring an `AI_AuditLog` SharePoint list.

After configuring the local LLM and starting Docker, create a browser sign-in link:

```bash
sudo docker compose exec gateway node scripts/mint-token.mjs --url
```

Open the generated link in your browser. It contains a signed access token, not
the LLM API key. The page removes the token from the URL and stores it only in
that tab's session. Treat the generated link as a credential; it expires after
24 hours. The gateway validates it before enabling chat. To switch to another
identity, pass its user ID before `--url`.

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
LLM_MODEL=deepseek-v4-pro

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

The model must support tool/function calling (DeepSeek `deepseek-v4-pro`, or local
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
- [`DEPLOYMENT.md`](DEPLOYMENT.md) — how to deploy (Docker, native, production).
- [`RAG_ARCHITECTURE.md`](RAG_ARCHITECTURE.md) — document-search pipeline & topology.
- [`USER_GUIDE.md`](USER_GUIDE.md) — for project managers using the assistant.
- [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) — for SharePoint administrators.
- [`SECURITY.md`](SECURITY.md) — permission model, audit, rate limiting, secrets.
- [`docs/deployment.md`](docs/deployment.md) — production deployment, SSL, rollback.
- [`TESTING.md`](TESTING.md) — test strategy and the end-to-end checklist.

## License

MIT — see [`LICENSE`](LICENSE).

### Reporting and predictive delay warnings

Project Server mode now includes **Reports & delay warnings**, a Power BI-ready
JSON dataset, and assistant tools `get_reporting_dataset` and
`get_predictive_delay_warnings`. Progress is recorded hourly and on refresh in
the persistent data volume. Forecasts require real daily history and use an
explainable progress trend, not a trained probability model.

See [Power BI import queries, dashboard setup, and forecast limitations](docs/power-bi/README.md).
A Power BI Report Server is optional; without one, the local reporting dashboard
and downloadable dataset work, but no embedded Power BI report is deployed.
