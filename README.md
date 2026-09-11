# SharePoint AI Project Management Assistant

A production-grade AI assistant that fronts **SharePoint Server 2019 (on-premises)**
using the **Model Context Protocol (MCP)**. Project managers query project, task,
milestone, and escalation data in natural language — and the assistant can act on
their behalf (create escalations, send scheduled alerts) with permission-aware,
audit-logged results.

> See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full design, and
> [`docs/build-prompt.md`](docs/build-prompt.md) for the phased build plan this
> repo implements.

## How it works

```
SPFx web part / Claude Desktop / VS Code
        │  (MCP over stdio, or HTTP gateway for SPFx)
        ▼
MCP server (Node + TypeScript)  ◄── HTTP gateway (Express, auth, rate limit)
        │  NTLM / Kerberos (SPNEGO)
        ▼
SharePoint Server 2019 REST API
(Lists: Projects, Tasks, Milestones, Escalations, Alerts, AI_AuditLog)
```

There are two consumption paths, both reaching the same MCP server:

- **stdio** — for desktop MCP clients (Claude Desktop, VS Code).
- **HTTP gateway** — an Express service (`POST /api/mcp/tool`) used by the SPFx web
  part. It authenticates the caller with a signed bearer token, applies rate
  limiting, and forwards to the MCP server over a persistent client connection.

## Prerequisites

- **Node.js ≥ 20** (CommonJS; see ADR-004).
- A **SharePoint Server 2019** project site with the lists described in
  [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md).
- A SharePoint **service account** (domain user) for REST calls.
- Optional: the [`kerberos`](https://www.npmjs.com/package/kerberos) native package
  for SPNEGO authentication (otherwise use `SHAREPOINT_AUTH_MODE=ntlm`).

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

\* conditionally required.

## Running locally

```bash
# MCP server over stdio (for desktop clients)
npm start

# HTTP gateway (for the SPFx web part)
npm run start:gateway
```

### Connect a desktop client

- **VS Code** — `.vscode/mcp.json` is already configured to launch
  `node dist/server.js`.
- **Claude Desktop** — copy `claude_desktop_config.json` into Claude Desktop's
  config, replacing the placeholder path with the absolute path to
  `dist/server.js`.

The assistant's system prompt (with an auto-generated tool catalog) is
[`src/prompts/system-prompt.md`](src/prompts/system-prompt.md), regenerated via
`npm run generate:prompt`.

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
| `npm run generate:prompt`         | Regenerate the system-prompt tool catalog.                      |
| `npm run lint` / `lint:fix`       | ESLint.                                                         |
| `npm run format` / `format:check` | Prettier.                                                       |

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — design, ADRs, repository layout.
- [`USER_GUIDE.md`](USER_GUIDE.md) — for project managers using the assistant.
- [`ADMIN_GUIDE.md`](ADMIN_GUIDE.md) — for SharePoint administrators.
- [`SECURITY.md`](SECURITY.md) — permission model, audit, rate limiting, secrets.
- [`docs/deployment.md`](docs/deployment.md) — production deployment, SSL, rollback.
- [`TESTING.md`](TESTING.md) — test strategy and the end-to-end checklist.

## License

UNLICENSED (private).
