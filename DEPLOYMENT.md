# Deploying the SharePoint AI Assistant

This guide covers running the assistant end-to-end — the MCP server, HTTP gateway,
chat window, document search (RAG), and scheduled alerts. There are three paths:

1. **[Docker Compose](#1-docker-compose-recommended)** — the full stack in
   containers (recommended for a quick, self-contained deployment).
2. **[Native Node](#2-native-node)** — the server + gateway run directly on a host.
3. **[Production (Windows service)](#3-production-windows-service)** — the hardened
   NSSM-managed deployment; see [`docs/deployment.md`](docs/deployment.md).

## Prerequisites

| Requirement             | Notes                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| SharePoint Server 2019  | Reachable site URL. The admin must create the lists the assistant reads/writes (see [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md)). |
| Service account         | Domain user for REST calls (`SHAREPOINT_USERNAME` / `SHAREPOINT_PASSWORD` / `SHAREPOINT_DOMAIN`).                        |
| Node.js ≥ 20            | Native path only.                                                                                                        |
| Docker Desktop          | Docker path only.                                                                                                        |
| LLM endpoint (optional) | Any OpenAI-compatible API (DeepSeek, Ollama, vLLM, OpenAI, …) to enable the chat window.                                 |

## Configuration

All settings are environment variables, read from `.env` (copy `.env.example`) or
injected directly. The groups:

| Group      | Variables                                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SharePoint | `SHAREPOINT_SITE_URL`, `SHAREPOINT_USERNAME`, `SHAREPOINT_PASSWORD`, `SHAREPOINT_DOMAIN`, `SHAREPOINT_AUTH_MODE`                                                    |
| Gateway    | `HTTP_GATEWAY_PORT`, `JWT_SIGNING_KEY`                                                                                                                              |
| Alerts     | `ALERT_SCHEDULE_OVERDUE`, `ALERT_SCHEDULE_MILESTONES`, `ALERT_SCHEDULE_HEALTHCHECK`, `ALERT_RECIPIENTS`, `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM`                    |
| RAG        | `PGVECTOR_CONNECTION_STRING`, `EMBEDDING_API_BASE_URL`, `EMBEDDING_MODEL_NAME`, `EMBEDDING_DIMENSIONS`, `RAG_INDEX_SCHEDULE`, `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP` |
| LLM chat   | `LLM_API_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_TEMPERATURE`, `LLM_MAX_STEPS`                                                                                  |

`SHAREPOINT_SITE_URL` must be the **site root** (e.g. `http://host/sites/PWA`), not a
page URL — the app appends `/_api/web/…` to it. See `.env.example` for a full
annotated reference.

## 1. Docker Compose (recommended)

Runs **3 containers**:

| Service            | Image / build                          | Purpose                                                                          | Port      |
| ------------------ | -------------------------------------- | -------------------------------------------------------------------------------- | --------- |
| `gateway`          | built from `Dockerfile`                | HTTP gateway + MCP server (in-process) + chat UI + alert scheduler + RAG indexer | 3001      |
| `pgvector`         | `pgvector/pgvector:pg16`               | PostgreSQL + pgvector (RAG vector store)                                         | 5432      |
| `embedding-server` | `text-embeddings-inference:cpu-latest` | Embedding model (`BAAI/bge-large-en-v1.5`)                                       | 8080 → 80 |

### Steps

```bash
# 1. Create the env file and fill in real SharePoint credentials.
cp .env.example .env

# 2. (Optional) enable the chat window with an OpenAI-compatible LLM.
#    Public:  LLM_API_BASE_URL=https://api.deepseek.com/v1  + LLM_API_KEY=sk-…
#    Local:   LLM_API_BASE_URL=http://host.docker.internal:11434/v1 + LLM_API_KEY=ollama

# 3. Build and start.
docker compose up --build
```

### Access

- **Chat window:** `http://localhost:3001/` (paste a bearer token — see below).
- **Health check:** `GET http://localhost:3001/health`
- **Tool call:** `POST http://localhost:3001/api/mcp/tool`
- **Chat:** `POST http://localhost:3001/api/chat`

Generate a token for the chat UI with:

```bash
npm run mint-token -- <userId>
```

### Notes

- The gateway authenticates to SharePoint over **NTLM** (forced by
  `docker-compose.yml`); Kerberos needs domain membership, which is impractical
  inside a container.
- If SharePoint (or a local LLM such as Ollama) runs on the Docker **host**, reach
  it at `http://host.docker.internal/…` from inside the container.
- On first run, `embedding-server` downloads the model (~1.3 GB); the gateway
  `restart: on-failure` retries until it is ready.
- RAG is enabled by default in the compose file. To disable it, remove/blank
  `PGVECTOR_CONNECTION_STRING` and `EMBEDDING_API_BASE_URL` (and drop the two RAG
  services with `docker compose up gateway`).

## 2. Native Node

```bash
npm install
cp .env.example .env   # fill in credentials
npm run build

# MCP server over stdio (for desktop clients: Claude Desktop / VS Code)
npm start

# HTTP gateway + chat UI (for the SPFx web part / browser)
npm run start:gateway
```

For document search, run the two RAG containers alongside the native app:

```bash
docker compose -f docker-compose.addendum.yml up -d
```

Then set `PGVECTOR_CONNECTION_STRING` and `EMBEDDING_API_BASE_URL` in `.env`
pointing at them (defaults already target `localhost`).

## 3. Production (Windows service)

For the hardened production deployment — NSSM-managed Windows services, SSL
termination, firewall rules, secret sourcing, and the rollback plan — see
[`docs/deployment.md`](docs/deployment.md).

## Verification

| Check                | How                                                                     |
| -------------------- | ----------------------------------------------------------------------- |
| Gateway is up        | `curl http://localhost:3001/health` → `{"status":"ok",…}`               |
| Tools are registered | `npm run smoke:test` (needs a working `.env` + SharePoint)              |
| Chat works           | Open `http://localhost:3001/`, paste a token, ask a question            |
| Document search      | Ask about a document; check the RAG indexer log on `RAG_INDEX_SCHEDULE` |

## Troubleshooting

| Symptom                                               | Cause / fix                                                                                                       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `No route to host` / `Couldn't connect` to SharePoint | The SharePoint server is offline or the IP changed — power it on / confirm the address.                           |
| Chat returns "not configured"                         | `LLM_API_BASE_URL` is unset/blank — set it in `.env`.                                                             |
| `search_documents` returns "not configured"           | `PGVECTOR_CONNECTION_STRING` and `EMBEDDING_API_BASE_URL` must both be set.                                       |
| Gateway restarting on first boot                      | `embedding-server` is still downloading the model (~1.3 GB) — wait, or check its logs.                            |
| LLM loops without answering                           | The model may not support tool/function calling — use `deepseek-chat`, or a local `qwen2.5`/`llama3.1`/`mistral`. |
| Kerberos errors in Docker                             | Use `SHAREPOINT_AUTH_MODE=ntlm` (Kerberos needs domain membership).                                               |
