# Architecture — SharePoint AI Project Management Assistant

> Status: **Phase 8** (RAG — retrieval-augmented generation over document libraries). Last updated: 2026-09-11.

## 1. Overview

A production-grade AI Project Management Assistant that fronts SharePoint Server
**2019 (on-premises)** using the **Model Context
Protocol (MCP)**. It lets project managers query project, task, milestone, and
escalation data in natural language, and it can act on their behalf (create
escalations, send scheduled alerts) with permission-aware, audit-logged results.

The system is deliberately layered so that **all SharePoint I/O flows through a
single `SharePointClient`**, isolating authentication and transport so they can
be swapped (e.g. NTLM → Kerberos, or a different HTTP adapter) without touching
business logic.

Phase 8 adds an **additive RAG subsystem** (`src/rag/`) that indexes unstructured
documents from SharePoint document libraries into a self-hosted pgvector store and
exposes semantic search with citations via `search_documents`. See
[`RAG_ARCHITECTURE.md`](RAG_ARCHITECTURE.md) for its dedicated design.

## 2. System context

```
┌─────────────────────┐      ┌──────────────────────┐      ┌───────────────────────┐
│  SPFx Web Part /     │      │  MCP HTTP Gateway      │      │  MCP Server (stdio)   │
│  Teams / VS Code /   │◄────►│  (Express, auth,       │◄────►│  Node.js + TypeScript  │
│  Claude Desktop       │      │  request routing)      │      │  Tools + Services      │
└─────────────────────┘      └──────────────────────┘      └───────────┬───────────┘
                                                                           │ NTLM/Kerberos
                                                                           ▼
                                                               ┌───────────────────────┐
                                                               │ SharePoint On-Prem     │
                                                               │ REST API (Lists:       │
                                                               │ Projects, Tasks,       │
                                                               │ Milestones,            │
                                                               │ Escalations, Audit)    │
                                                               └───────────────────────┘
```

RAG (Phase 8) adds two on-premises containers reachable from the MCP server over
plain HTTP/Postgres — **no Kerberos crosses that boundary and no request leaves
the network**: a **pgvector** (PostgreSQL) store and a
**text-embeddings-inference** embedding server.

Two consumption paths exist, both terminating at the same MCP server:

- **stdio** — for desktop MCP clients (Claude Desktop, VS Code).
- **HTTP gateway** (Phase 6) — an Express service that authenticates the SPFx
  web part, forwards tool calls to the MCP server over a persistent client
  connection, and returns results.

## 3. Repository layout

```
Sharepoint-Ai-Assistant/
├── docs/
│   ├── build-prompt.md            # The phased build prompt this repo implements
│   └── deployment.md              # Production deployment guide — Phase 7
├── src/                           # TypeScript source (compiles to dist/)
│   ├── server.ts                  # MCP server entry (stdio bootstrap) — Phase 1
│   ├── config.ts                  # Typed, env-driven config (fail-fast) — Phase 1
│   ├── errors.ts                  # Typed error classes — Phase 1
│   ├── sharepoint/                # SharePointClient + NTLM transport — Phase 1
│   ├── tools/                     # MCP tool handlers + zod schemas — Phase 2+
│   ├── services/                  # Business logic (health, alerts, perms…) — Phase 3+
│   ├── mappers/                   # SharePoint OData → clean JSON — Phase 2
│   ├── api/                       # HTTP gateway (Express) — Phase 6
│   ├── rag/                        # RAG: indexer, embeddings, pgvector, retrieval — Phase 8
│   └── types/                     # Shared domain + wire types — all phases
├── test/                          # Jest tests mirroring src/
│   ├── sharepoint/  tools/  services/  mappers/  api/  rag/  types/
├── spfx/                          # SPFx web part (Yeoman scaffold) — Phase 6
├── package.json
├── tsconfig.json                  # Base (type-check src + test, no emit)
├── tsconfig.build.json            # Build config (emit src → dist)
├── jest.config.js
├── eslint.config.mjs
├── .prettierrc.json
├── .env.example
├── sql/                           # pgvector schema migration — Phase 8
├── docker-compose.addendum.yml    # pgvector + embedding-server containers — Phase 8
├── RAG_ARCHITECTURE.md            # RAG pipeline, schema & topology — Phase 8
└── ARCHITECTURE.md                # This file
```

> Note: Phase 0's prompt lists `src/server` and `src/config` as folders. Phases
> 1–6 consistently name the concrete deliverables `src/server.ts` and
> `src/config.ts` (single modules), so `server` and `config` are **single-file
> modules at `src/` root** rather than folders. The multi-file areas
> (`sharepoint/`, `tools/`, `services/`, `mappers/`, `types/`, `api/`) are
> folders. `test/` mirrors `src/`.

## 4. Technology & dependency decisions

| Concern      | Choice                                                     | Rationale                                                                                                                                                                              |
| ------------ | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime      | Node.js ≥ 20                                               | Confirmed decision (raised from the spec's 18 floor). Node 20/22 LTS recommended in production.                                                                                        |
| Language     | TypeScript **~5.9.x** (strict)                             | Pinned to 5.x deliberately: `typescript@latest` is now 7.x, which `ts-jest` (`<7`) and `typescript-eslint` (`<6.1`) do not yet support.                                                |
| MCP          | `@modelcontextprotocol/sdk` ^1.30                          | Official SDK; supports stdio + HTTP transports.                                                                                                                                        |
| HTTP client  | `axios` ^1.20 + Kerberos/SPNEGO adapter (Phase 1)          | axios for REST; Kerberos (SPNEGO) is the primary auth. `axios-ntlm` ^1.4 is retained for NTLM fallback; the SPNEGO adapter (`kerberos` or `node-expose-sspi`) is finalized in Phase 1. |
| Validation   | `zod` ^4.6                                                 | MCP SDK peer dependency (`^3.25                                                                                                                                                        |     | ^4`); every tool parameter is schema-validated. |
| Logging      | `pino` ^10.3                                               | Structured JSON with correlation IDs; stdout-friendly for log shippers.                                                                                                                |
| Scheduling   | `node-cron` ^4.6                                           | Latest major; requires Node ≥ 20 (now satisfied).                                                                                                                                      |
| Gateway      | `express` ^5.2                                             | HTTP gateway for the SPFx web part (Phase 6).                                                                                                                                          |
| Embeddings   | `openai` ^7 (SDK, `baseURL` → TEI)                         | Official SDK pointed at the self-hosted text-embeddings-inference server (`BAAI/bge-large-en-v1.5`); no public-cloud endpoint (Phase 8).                                               |
| Vector store | `pg` + pgvector (`pgvector/pgvector:pg16`)                 | Parameterized SQL, HNSW index (`vector_cosine_ops`); no ORM (Phase 8).                                                                                                                 |
| Extraction   | `pdf-parse` + `mammoth` + `officeparser`                   | PDF/DOCX/PPTX text extraction for the RAG indexer (Phase 8).                                                                                                                           |
| Tests        | `jest` ^30.5 + `ts-jest` ^29.4                             | ts-jest 29.4 supports Jest 30 and TS `<7`.                                                                                                                                             |
| Lint/format  | `eslint` ^10 + `typescript-eslint` ^8.70 + `prettier` ^3.9 | Standard enterprise Node config (flat ESLint config).                                                                                                                                  |

### Module system

The server targets **CommonJS** (`module: CommonJS`) — confirmed decision
(ADR-004). This is the lowest-friction choice for ts-jest and the MCP SDK.

## 5. SharePoint list dependencies

The assistant reads/writes these on-premises lists (created by the SharePoint
admin; see Appendix B of the build prompt for full schemas):

| List          | Purpose                                                                                                    | Phase |
| ------------- | ---------------------------------------------------------------------------------------------------------- | ----- |
| `Projects`    | Title, Description, Owner, StartDate, EndDate, Budget, ActualCost, Status                                  | 2     |
| `Tasks`       | Title, Project (lookup), AssignedTo, Status, DueDate, PercentComplete                                      | 2     |
| `Milestones`  | Title, Project (lookup), DueDate, Status, Dependencies (lookup/multi)                                      | 2     |
| `Escalations` | Title, ProjectId (lookup), IssueDescription, Priority, Status, CreatedBy, CreatedDate, AssignedTo, DueDate | 4     |
| `AI_AuditLog` | Title, ToolName, Action, Parameters, UserId, Timestamp, Duration, Result, IPAddress                        | 5     |
| `Alerts`      | Title, AlertType, RelatedItemId, Recipients, SentDate, Status                                              | 4     |

## 6. Architecture decision records (ADRs)

### ADR-001 — Single `SharePointClient` facade

All SharePoint I/O goes through one `SharePointClient` class (Phase 1). It owns
authentication, request digest handling, OData query construction, error
wrapping (`SharePointError`), and retry policy. Business logic and tools depend
only on its methods, never on `axios`/NTLM details. **This lets us change
authentication or transport without touching business logic.**

### ADR-002 — Kerberos authentication (SharePoint Server 2019)

On-premises SharePoint Server 2019 REST is authenticated with **Kerberos
(SPNEGO)** as the primary mode (NTLM retained as fallback). No OAuth/Azure AD
app registrations. `SHAREPOINT_AUTH_MODE=kerberos` selects the mode; the Node
process must run under a domain account or present a keytab/SPN. The SPNEGO
adapter is the **`kerberos` native package**, loaded lazily (it is not a hard
dependency) — see `src/sharepoint/auth.ts`. `axios-ntlm` covers the NTLM
fallback path only.

### ADR-003 — Environment-driven configuration

Every tunable comes from environment variables (see `.env.example`), validated
fail-fast at startup. No secrets are hardcoded or committed.

### ADR-004 — CommonJS modules (confirmed)

CommonJS chosen for ts-jest/MCP SDK compatibility. Confirmed; not revisiting ESM.

### ADR-005 — TypeScript 5.x (not 7.x)

`typescript@latest` (7.x) is ahead of the toolchain (`ts-jest`, `typescript-eslint`
peer ranges). Pinned to `~5.9.3` until the ecosystem catches up.

### ADR-006 — Structured JSON logging (pino)

All logs are structured JSON with correlation/request IDs, ready for a log
shipper. Errors are never swallowed — typed error classes
(`SharePointError`, `ValidationError`, `PermissionError`) carry context.

### ADR-007 — Test strategy

Jest + ts-jest, unit tests mirroring `src/` in `test/`. Target ≥ 80% coverage on
services. Integration tests mock the SharePoint HTTP server with **nock**
(`test/integration/`); a smoke test (`npm run smoke:test`) exercises the real
stdio server + gateway end-to-end. Coverage thresholds are enforced via
`npm run test:coverage`.

### ADR-008 — RAG on self-hosted pgvector + text-embeddings-inference

Document search (Phase 8) is an **additive, on-premises** subsystem: the indexer
runs inside the existing process, chunks are stored in a self-hosted
**PostgreSQL + pgvector** container, and embeddings come from a self-hosted
**text-embeddings-inference** container (`BAAI/bge-large-en-v1.5`, 1024-dim). No
request may target a public cloud endpoint. Retrieval reuses the existing
`PermissionService` (filter before the model) and `AuditService` (same log shape).
See [`RAG_ARCHITECTURE.md`](RAG_ARCHITECTURE.md).

## 7. Engineering standards (apply to every phase)

- TypeScript **strict**; no `any` in public signatures.
- zod validation on every tool parameter.
- Centralized, typed error handling — never swallow errors.
- TSDoc on all exported classes/methods.
- Conventional commits for generated commit messages.
- `npm run build` / `typecheck` / `lint` / `test` must stay green each phase.

## 8. Confirmed decisions (from review)

1. **SharePoint version** — SharePoint Server **2019** (on-premises).
2. **Node runtime floor** — **Node ≥ 20** (`package.json` engines, tsconfig
   `ES2023`; `node-cron@4` and `pino@10` adopted).
3. **Module system** — **CommonJS** (confirmed).
4. **Authentication** — **Kerberos** (SPNEGO) primary, NTLM fallback.

The Kerberos/SPNEGO adapter was finalized in Phase 1: the **`kerberos` native
package** (lazily imported, with a clear `ConfigError` if absent). `axios-ntlm`
is retained for the NTLM fallback path only.
