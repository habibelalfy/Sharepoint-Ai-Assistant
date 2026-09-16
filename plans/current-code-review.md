# Current Code Review and Missing Capabilities

Date: 2026-09-14

## Readiness conclusion

The repository is a credible controlled pilot: the gateway, LLM chat, Project Server reads, document extraction, plan preview, allowlisted publishing, and audit logging are implemented, and the automated suite passes. It is not ready for broad production use or complete against the presentation feature set. The main blockers are caller-specific authorization, an incompatible SPFx authentication design, non-durable approval state, and insufficient verification of the Project Server write path.

## Findings by priority

### P0 — Caller permissions are not enforced in Project Server mode

- `src/sharepoint/project-server-client.ts:42-52` performs all reads through one configured service account.
- `src/tools/project-server-tools.ts:58-67` accepts a caller `userId` but does not use it to filter Project Server results.
- `src/sharepoint/project-workspace.ts:110-184` tracks document discovery by caller in process memory, but does not check SharePoint effective permissions before returning document content.
- `src/runtime.ts:44` constructs `PermissionService` without a real AD group provider; `src/services/permission-service.ts:19-29` therefore uses the empty provider.

Impact: any valid gateway token can read every project and project-site document visible to the service account. Before wider use, resolve the caller from trusted Windows/proxy authentication and enforce SharePoint effective permissions for every project, task, document, retrieval result, and write.

### P0 — The SPFx authentication flow cannot authenticate to the gateway

- `spfx/webparts/projectAIAssistant/services/McpClientService.ts:31-34` requests an AAD token for the placeholder scope `api://sharepoint-ai-assistant/.default`.
- `src/api/mcp-http-server.ts:193-194` accepts only the gateway's locally signed HMAC bearer token.
- The target is SharePoint 2019 on-premises, so the current AAD-token assumption also conflicts with the documented deployment model.

Impact: the standalone browser UI can authenticate, but the SPFx client cannot use the deployed gateway. Choose and implement one production identity flow end to end, preferably Windows authentication at a trusted reverse proxy with verified identity headers or a documented hybrid identity design.

### P1 — The SPFx web part is not a deployable AI chat client

- `spfx/webparts/projectAIAssistant/components/ProjectAIAssistant.tsx:26-33` sends every user message directly to `search_projects`; it never calls `/api/chat` or preserves an LLM conversation.
- The `spfx` tree contains source fragments but no package manifest, build configuration, solution packaging, or `.sppkg` generation path.

Impact: the UI shown in SharePoint would behave as a project-search form and cannot currently be built and installed as a normal SPFx solution.

### P1 — Audit failures can turn successful Project Server actions into reported failures

- `src/tools/project-server-tools.ts:29-49` awaits the audit write after the handler succeeds. An audit storage error enters the catch path and rethrows, so the caller sees failure after the SharePoint operation may have completed.
- `src/server.ts:105-111` already contains a safer best-effort audit helper for the other tool path.

Impact: write operations can be duplicated or manually retried after a misleading failure. Use one audit policy consistently and return an explicit audit warning or operate a reliable transactional audit sink for governed writes.

### P1 — Plan publication can report completion without checking dependencies

- `src/sharepoint/project-workspace.ts:249-252` returns `already_published` when all deterministic task IDs exist.
- Dependency verification occurs only later at `src/sharepoint/project-workspace.ts:318-329`, so the early return bypasses it.

Impact: a partial prior publish with all tasks but missing or incorrect task links can be reported as complete. The idempotency check must compare task fields, notes/source signature, and every expected dependency.

### P1 — The actual Project Server publish path lacks automated coverage

- `test/sharepoint/project-workspace.test.ts:9-66` covers document search, chunked reads, and preview preparation only.
- There are no tests for checkout, draft comparison, task creation, task links, queue jobs, publish verification, retry behavior, partial writes, timeouts, or recovery.

Impact: 203 passing tests demonstrate good unit coverage elsewhere, but do not establish that the most consequential write workflow is safe. Add mocked protocol tests and a dedicated non-production PWA integration environment.

### P1 — Approval and concurrency state is process-local

- `src/sharepoint/project-workspace.ts:58-61` stores discovered documents, read progress, pending previews, and busy locks in `Map` and `Set` instances.

Impact: restarts invalidate approvals, and multiple replicas can publish concurrently. Persist previews with caller, source version, expiry, target, proposed diff, and approval evidence. Add a distributed project lock or enforce a single writer operationally.

### P1 — A document can change between chunks

- `src/sharepoint/project-workspace.ts:153-175` downloads and extracts the complete file for each chunk while tracking only the next character offset.

Impact: a plan can be derived from mixed source versions. Capture the SharePoint file unique ID, version/ETag, modified time, and content hash on discovery, and require the same version for every read and publish preview.

### P1 — Failed writes have no durable recovery workflow

- `src/sharepoint/project-workspace.ts:283-355` warns after a failure following checkout, but leaves recovery to manual inspection and stores no durable incident record.

Impact: projects may remain checked out or partially edited. Record the operation ID, caller, target, created IDs, queue jobs, and final observed state; provide a documented operator recovery path.

### P2 — Project Server data is too thin for several planned features

- `src/sharepoint/project-server-client.ts:76-98` maps basic task identity, dates, progress, milestone, and derived status only.

Missing fields include assignments, owners, resources, calendars, duration, baselines, costs, task links, notes, slack, and enterprise custom fields. These are required for owner alerts, critical-path analysis, baseline approvals, resource conflicts, cost health, and richer status reports.

### P2 — Major capabilities are disabled in Project Server mode

- `src/runtime.ts:50` disables semantic RAG for Project Server.
- `src/runtime.ts:82` disables scheduled alerts for Project Server.
- `src/server.ts:142-145` returns immediately after registering the Project Server catalog, excluding the custom-list health, delay, escalation, permission, and semantic-search tools.

Current Project Server mode therefore lacks semantic document retrieval, automated alerts, health assessment, delay simulation, escalation workflows, and permission inspection.

### P2 — Empty plans are reported as fully healthy

- `src/services/health-assessment.ts:82-95` returns 100% task and milestone completion for empty inputs.
- `src/services/statistics.ts:52-54` uses the same 100% convention.

Impact: an unpublished or empty project can appear Healthy and 100% complete. Return `No data`/`Unknown`, and exclude absent components from weighted scores.

### P2 — Audit records do not yet satisfy the proposed governance model

- `src/services/audit-service.ts:17-24` has no before/after values, approval identity, target object, correlation ID, source version, or operation ID.
- `src/services/file-audit-service.ts:30-49` reads the entire append-only file for queries and has no rotation, retention, tamper evidence, or indexed reporting.

Add immutable proposal/approval/execution records and operational retention controls before using the log as compliance evidence.

### P2 — Gateway and deployment hardening is incomplete

- `src/api/mcp-http-server.ts:103-128` uses a normal string comparison for signatures, does not validate the JWT header, and permits tokens without an expiry.
- `src/api/mcp-http-server.ts:193` and `scripts/mint-token.mjs:16` fall back to `changeme` when the signing key is absent.
- `docker-compose.yml:23,47-52` contains a default database password and publishes PostgreSQL to the host.
- `docker-compose.yml:36-37,61-67` publishes the gateway and embedding service on all interfaces, with no TLS reverse proxy in the stack.

Require strong secrets at startup, validate all token claims with timing-safe signature checks, shorten sessions, place internal services on an unexposed network, and terminate TLS at a trusted proxy.

### P2 — Error handling and smoke coverage are too broad and too shallow

- `src/api/mcp-http-server.ts:90-96` maps every tool exception to HTTP 500 and returns raw messages. Validation, permission, conflict, and upstream failures should receive stable status codes and sanitized public errors.
- `scripts/smoke-test.mjs:49-61,88-104` checks tool count, health, and one read only.

Expand the smoke path to cover session authentication, chat, caller permissions, document reads, plan preview, approval/publish in a test PWA, audit evidence, and expected denial paths.

## Missing presentation capabilities

The following capabilities are absent or only represented by scaffolding:

1. Production AD/effective-permission enforcement and security trimming.
2. A complete SPFx package with a real conversational client and supported authentication.
3. Durable approval workflows for other-user task updates, milestone/baseline changes, and deletion.
4. General project creation, individual task creation/update, and admin deletion flows.
5. Formal status-report generation, reviewer approval, distribution, and retained evidence.
6. Power BI Report Server reports and embedded/on-premises reporting integration.
7. Predictive delay warnings backed by historical data and a measured model.
8. Cross-project resource-capacity and conflict analysis.
9. Project Server semantic RAG with permission-aware indexing and citations.
10. Project Server alerts and owner/recipient resolution.
11. Teams integration, subject to the documented hybrid-connectivity exception.
12. Jira, ServiceNow, and other external system adapters.
13. Multilingual UI, prompts, extraction, and retrieval evaluation.

## Recommended delivery order

1. **Secure the pilot:** trusted caller identity, effective permissions, fail-closed secrets, stable error taxonomy, and audit reliability.
2. **Make writes recoverable:** durable proposals and approvals, source version pinning, full idempotency checks, distributed locking, recovery records, and publish integration tests.
3. **Ship the SharePoint client:** complete the SPFx scaffold, align its authentication with the gateway, call `/api/chat`, package it, and test in SharePoint 2019.
4. **Restore core PM intelligence for Project Server:** richer task/resource/baseline fields, health, delay simulation, alerts, status reports, and semantic RAG.
5. **Add portfolio and enterprise features:** resource conflicts, Power BI assets, predictive models, external integrations, Teams where permitted, and multilingual support.

## Validation evidence

- Type checking, build, lint, smoke checks, and the full Jest suite passed in the latest validation run.
- Full Jest result: 37 suites and 203 tests passed.
- The newly configured SharePoint endpoint was verified with an authenticated `search_projects` request through the running gateway.
- No production Project Server publish was executed during validation; the write-path conclusion is therefore based on code inspection and unit coverage, not a live destructive test.
