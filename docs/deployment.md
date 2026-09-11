# Production Deployment

This document covers deploying the MCP server and HTTP gateway to a Windows
Server host, shipping the SPFx web part, and rolling back if something breaks.

## 1. Windows Server host — Node.js service

Run both long-running Node processes as Windows services so they start on boot and
restart on failure.

### 1.1 Install prerequisites

- Node.js ≥ 20 (LTS).
- Build artifacts: copy the project to the host (or run `npm ci && npm run build`).
- For Kerberos/SPNEGO: `npm install kerberos` and run the service under the
  **domain service account** (see `ADMIN_GUIDE.md` §2).
- For SMTP alerts: `npm install nodemailer`.

### 1.2 Register services with NSSM

```powershell
# MCP server (stdio is irrelevant under a service; it runs as a managed process)
nssm install SharepointAiMCP "C:\Program Files\nodejs\node.exe" "C:\apps\sharepoint-ai-assistant\dist\server.js"
nssm set SharepointAiMCP AppDirectory "C:\apps\sharepoint-ai-assistant"
nssm set SharepointAiMCP AppEnvironmentExtra SHAREPOINT_AUTH_MODE=kerberos
nssm set SharepointAiMCP AppStdout "C:\logs\sharepoint-ai\server.out.log"
nssm set SharepointAiMCP AppStderr "C:\logs\sharepoint-ai\server.err.log"
nssm set SharepointAiMCP Start SERVICE_AUTO_START
nssm set SharepointAiMCP ObjectName "CORP\svc_ai_assistant" "<password>"

# HTTP gateway
nssm install SharepointAiGateway "C:\Program Files\nodejs\node.exe" "C:\apps\sharepoint-ai-assistant\dist\api\mcp-http-server.js"
nssm set SharepointAiGateway AppDirectory "C:\apps\sharepoint-ai-assistant"
nssm set SharepointAiGateway AppStdout "C:\logs\sharepoint-ai\gateway.out.log"
nssm set SharepointAiGateway AppStderr "C:\logs\sharepoint-ai\gateway.err.log"
nssm set SharepointAiGateway Start SERVICE_AUTO_START
nssm set SharepointAiGateway ObjectName "CORP\svc_ai_assistant" "<password>"

nssm start SharepointAiMCP
nssm start SharepointAiGateway
```

Set the full environment (SharePoint creds, `JWT_SIGNING_KEY`, alert settings) via
`AppEnvironmentExtra` entries **or** from a `.env` file in `AppDirectory` — but see
§1.3 on secrets.

### 1.3 Secrets — do not ship `.env` files

In production, source secrets from a store rather than a plaintext `.env`:

- **Windows DPAPI / Credential Manager** — store the SharePoint service-account
  password and `JWT_SIGNING_KEY`, and retrieve them at startup (a small bootstrap
  that calls `CredRead`/`CredWrite`, or PowerShell `Get-StoredCredential`, and
  exports them as environment variables before launching Node).
- **A vault** (HashiCorp Vault, Azure Key Vault, AWS Secrets Manager) — fetch at
  startup via the vault's SDK/CLI and inject into the process environment.
- **Host secret store** (e.g. the Windows service account's managed credentials, or
  a CI/CD secret) — the service runs under the domain account, so the Kerberos
  path needs no stored password; only `JWT_SIGNING_KEY` and `SMTP_FROM`/SMTP creds
  need sourcing.

The app only ever reads `process.env` (see `src/config.ts`), so any of these can
feed it without code changes.

### 1.4 RAG containers (document search)

Document search (RAG) is optional. To enable it, run two containers on a host
reachable from the Node service (not necessarily the SharePoint host):

```bash
docker compose -f docker-compose.addendum.yml up -d
```

- `pgvector` — `pgvector/pgvector:pg16` (PostgreSQL + pgvector, port 5432).
- `embedding-server` — `ghcr.io/huggingface/text-embeddings-inference:cpu-latest`
  serving `BAAI/bge-large-en-v1.5` (port 8080).

Then set `PGVECTOR_CONNECTION_STRING` and `EMBEDDING_API_BASE_URL` in the app's
environment. The app runs a **dimension check** at startup and fails fast on a
mismatch; the indexer runs on `RAG_INDEX_SCHEDULE` inside the same process as the
alert jobs.

## 2. SSL termination & firewall

- **Terminate TLS at a reverse proxy** (IIS ARR, nginx, or a load balancer) in
  front of the gateway. The gateway itself listens on `HTTP_GATEWAY_PORT` (default
  3001) on the loopback/VLAN only.
- Require **HTTPS** for the SPFx web part's gateway URL.
- **Firewall rules:**
  - Gateway port (3001) — open **only** to the reverse proxy / SharePoint front-end
    servers, never directly to the internet.
  - SharePoint REST (`SHAREPOINT_SITE_URL`, typically 80/443) — open **only** from
    the Node host to the SharePoint farm.
  - pgvector (5432) and embedding server (8080) — open **only** from the Node
    host, never to the internet.
  - Block all other inbound traffic on the Node host.

## 3. Health checks & monitoring

- `GET /health` on the gateway returns `200 { "status": "ok", … }` — point your
  load balancer/monitor at it.
- All logs are **structured JSON to stderr** (pino). The NSSM `AppStderr` file is
  ready to ship to your log aggregator (Splunk, ELK, Datadog, etc.). stdout is
  reserved for the MCP stdio JSON-RPC transport.

## 4. Shipping the SPFx web part

```bash
cd spfx
npm install
gulp bundle --ship
gulp package-solution --ship
```

- Upload the resulting `.sppkg` (under `sharepoint/solution/`) to the **App
  Catalog**.
- Deploy the solution to the project site(s).
- Add the **Project AI Assistant** web part to project site pages and set its
  `mcpGatewayUrl` property to the gateway's HTTPS URL.

## 5. Rollback plan

If a deployed phase breaks production SharePoint access:

1. **Stop the services** — `nssm stop SharepointAiGateway` then
   `nssm stop SharepointAiMCP`. This immediately halts all assistant-initiated
   SharePoint traffic without touching SharePoint itself.
2. **Revert the process** — redeploy the previous `dist/` build (keep the last known
   good build tarball) and restart. The service account/lists are unchanged, so
   SharePoint data is intact.
3. **Revert the SPFx package** — remove the web part from the affected pages, or
   re-deploy the previous `.sppkg` from the App Catalog.
4. **Verify** — run `npm run smoke:test` (or `GET /health`) and confirm
   `tools/list` + one tool call succeed before re-enabling.
5. **Audit** — check `AI_AuditLog` and the SharePoint audit log for any requests
   made during the incident window.

Because all SharePoint I/O goes through a single `SharePointClient` (ADR-001) and
write operations are limited to the `Escalations`, `Alerts`, and `AI_AuditLog`
lists, a bad deploy degrades the assistant's *own* lists at worst — it cannot
mutate Projects/Tasks/Milestones.
