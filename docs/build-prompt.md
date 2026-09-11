# Enterprise AI Project Management Assistant for SharePoint On-Premises
### A Phased Build Prompt Set for VS Code (GitHub Copilot / Claude Code / Cursor)

---

## How to Use This Document

1. Open your target repository in **VS Code** with an AI coding agent enabled (GitHub Copilot Chat in *Agent* mode, the **Claude Code** extension, or Cursor).
2. Paste the **Master Context Prompt** below once, at the start of your session (or keep it as a pinned/system message). It gives the assistant durable project context so later phases don't need to repeat it.
3. Work through **Phase 0 → Phase 7** in order, one phase per session or per sitting. Paste a phase's full prompt block as-is.
4. After each phase, run the **Test** checklist before moving on. Do not start Phase *N+1* until Phase *N* builds, runs, and passes its tests.
5. Adjust list names, field names, and environment specifics (SharePoint version, farm topology, AD structure) to match your actual SharePoint on-premises environment before Phase 1.

This assumes: **SharePoint Server 2016/2019/Subscription Edition (on-premises)**, NTLM or Kerberos authentication, a Node.js/TypeScript middle tier, and the **Model Context Protocol (MCP)** as the integration layer between the AI assistant and SharePoint.

---

## Solution Overview

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

**Feature map** (kept consistent across all phases so nothing gets lost):

| # | Feature | Delivered in |
|---|---|---|
| 1 | Query project/task/milestone data | Phase 2 |
| 2 | SPFx chat web part | Phase 6 |
| 3 | Permission-aware answers | Phase 5 |
| 4 | Escalation case creation | Phase 4 |
| 5 | Scheduled alerts (overdue, upcoming) | Phase 4 |
| 6 | Project health scoring | Phase 3 |
| 7 | Milestone delay / cascading impact analysis | Phase 3 |
| 8 | Escalation lifecycle tools | Phase 4 |
| 9 | Audit logging & compliance | Phase 5 |

---

## Master Context Prompt
*(Paste this once at the top of your VS Code AI chat session before Phase 0.)*

```
You are acting as a senior enterprise software architect and TypeScript/Node.js
engineer. We are building a production-grade AI Project Management Assistant
that sits in front of SharePoint Server (on-premises) using the Model Context
Protocol (MCP).

PROJECT CONSTRAINTS (non-negotiable):
- SharePoint is ON-PREMISES (2016/2019/SE) — no SharePoint Online / Graph API.
- Authentication is NTLM (or Kerberos where configured) against SharePoint's
  REST API — no OAuth/Azure AD app registrations for the SharePoint calls.
- The MCP server is written in Node.js + TypeScript, using
  @modelcontextprotocol/sdk, and must run both via stdio (for desktop MCP
  clients) and behind an HTTP gateway (for the SPFx web part).
- All configuration is environment-variable driven; no secrets hardcoded.
- Code must be production-quality: typed, tested, logged, and documented —
  not a prototype.

ENGINEERING STANDARDS (apply to every phase, every file):
- TypeScript strict mode; no `any` in public signatures.
- Structured JSON logging (pino or winston) with correlation/request IDs.
- Centralized error handling with typed error classes (e.g. SharePointError,
  ValidationError, PermissionError) — never swallow errors silently.
- Input validation on every tool parameter (zod or equivalent).
- Unit tests (Jest) for all business logic — target ≥80% coverage on
  services; integration tests may be mocked against a fake SharePoint client.
- ESLint + Prettier, consistent with a standard enterprise Node.js config.
- TSDoc comments on all exported classes/methods.
- Conventional commit messages when you generate commit suggestions.

Work phase by phase. At the end of each phase, summarize what changed, list
any assumptions you made, and flag anything that needs a decision from me
before continuing.
```

---

## Phase 0 — Discovery, Architecture Decisions & Environment Setup

**Objective:** Lock down the environment-specific decisions before any code is written, so later phases don't require rework.

**Prompt:**
```
Before writing code, help me finalize the project scaffold and record our
architecture decisions.

1. Propose a monorepo folder structure for:
   - the MCP server (src/server, src/sharepoint, src/tools, src/services,
     src/mappers, src/config)
   - the HTTP gateway (src/api)
   - the SPFx web part (spfx/)
   - shared types (src/types)
   - tests (test/ mirroring src/)

2. Draft a `package.json` with dependencies for:
   @modelcontextprotocol/sdk, axios, an NTLM client library, zod, pino,
   node-cron, express, jest, ts-jest, eslint, prettier, typescript.

3. Draft `tsconfig.json` in strict mode targeting Node 18+.

4. Draft `.env.example` covering: SHAREPOINT_SITE_URL, SHAREPOINT_USERNAME,
   SHAREPOINT_PASSWORD, SHAREPOINT_DOMAIN, SHAREPOINT_AUTH_MODE
   (ntlm|kerberos), LOG_LEVEL, ALERT_SCHEDULE_OVERDUE,
   ALERT_SCHEDULE_MILESTONES, HTTP_GATEWAY_PORT, JWT_SIGNING_KEY (for the
   gateway's SPFx auth).

5. Write a short ARCHITECTURE.md capturing: the diagram, the list of
   SharePoint lists we depend on (Projects, Tasks, Milestones, Escalations,
   AI_AuditLog), and the decision to keep all SharePoint I/O behind a single
   SharePointClient class so authentication/transport can change later
   without touching business logic.

Do not implement business logic yet — this phase is scaffold and decisions
only.
```

**Deliverables:** repo skeleton, `package.json`, `tsconfig.json`, `.env.example`, `ARCHITECTURE.md`.

**Acceptance criteria:** `npm install` succeeds; `npm run build` compiles an empty scaffold with no errors.

---

## Phase 1 — Foundation: MCP Server & SharePoint Connectivity

**Prompt:**
```
Implement the MCP server foundation and the SharePoint on-premises client.

SharePointClient (src/sharepoint/client.ts):
- Constructs from SHAREPOINT_SITE_URL / USERNAME / PASSWORD / DOMAIN /
  AUTH_MODE.
- Uses axios with an NTLM (or Kerberos) adapter; sets
  'Accept: application/json;odata=verbose' and 'Content-Type' headers.
- Methods:
  - getRequestDigest(): Promise<string>
  - queryList(listName: string, options?: { filter?: string; select?: string[];
    orderby?: string; top?: number }): Promise<any[]>
  - getItemById(listName: string, id: number): Promise<any>
  - createItem(listName: string, itemData: Record<string, unknown>): Promise<any>
  - updateItem(listName: string, id: number, itemData: Record<string, unknown>): Promise<any>
- Wrap all SharePoint HTTP errors in a typed SharePointError with the
  original status code and SharePoint's error message preserved.
- Retry transient failures (network/5xx) with exponential backoff (max 3
  attempts); do not retry 4xx.

MCP server (src/server.ts):
- Use @modelcontextprotocol/sdk with stdio transport.
- Register ListToolsRequestSchema and CallToolRequestSchema handlers.
- Define placeholder tools `query_project_data` and `get_project_by_id` with
  zod-validated input schemas (implementation comes in Phase 2).
- Structured startup/shutdown logging; graceful shutdown on SIGINT/SIGTERM.

Config (src/config.ts):
- Typed config object assembled from env vars, validated at startup (fail
  fast with a clear error if required vars are missing).
- List name constants: Projects, Tasks, Milestones (Escalations and
  AI_AuditLog are added in later phases).

Deliverables: src/server.ts, src/sharepoint/client.ts, src/config.ts,
src/errors.ts (typed error classes), unit tests for SharePointClient using a
mocked axios instance.
```

**Test:** Server starts, responds to an MCP `tools/list` request, and `SharePointClient` unit tests pass against mocked HTTP calls.

---

## Phase 2 — Core Data Access Tools

**Prompt:**
```
Extend the MCP server with the read-only data access tools.

Tool: query_project_data
- Params: listName ("Projects"|"Tasks"|"Milestones", required),
  filter (OData string, optional), fields (string[], optional).
- Validates listName against the allow-list; never interpolates raw user
  filter strings without sanitization.

Tool: get_project_by_id
- Params: projectId (required).
- Fetches the project and its related tasks and milestones (via lookup
  field queries), returns a nested structure:
  { project, tasks: [...], milestones: [...] }.

Tool: get_tasks_by_project
- Params: projectId (required), status (optional enum: "Not Started" |
  "In Progress" | "Completed" | "Overdue").

Tool: get_milestones_by_project
- Params: projectId (required), includeCompleted (boolean, default true).
- Sort by DueDate ascending.

Tool: search_projects
- Params: query (required), limit (default 10).
- Search Title and Description using SharePoint $filter substringof (or
  $search if full-text search is provisioned on the farm).

Data mapping (src/mappers/sharepoint-mapper.ts):
- Convert SharePoint's verbose OData shape into clean, flat JSON.
- Resolve lookup fields (id + title), user fields (login + display name),
  and date fields (ISO 8601) consistently across all tools.

Organize implementations as modular files: src/tools/project-tools.ts,
src/tools/task-tools.ts, src/tools/milestone-tools.ts, each exporting a
handler function and a zod schema, registered in server.ts.

Deliverables: the five tools above, sharepoint-mapper.ts, unit tests per
tool covering both the happy path and SharePoint error propagation.
```

**Test:** Each tool queries a mocked SharePoint response and returns correctly shaped, flattened JSON; invalid `listName`/`status` values are rejected before any HTTP call is made.

---

## Phase 3 — Business Logic: Health Assessment & Milestone Delay Analysis

**Prompt:**
```
Add platform-independent business logic services — no SharePoint calls
inside these services; they operate purely on data already fetched.

ProjectHealthService (src/services/health-assessment.ts):
- assessProjectHealth(project, tasks, milestones): ProjectHealth
- Score (0-100) weighted: task completion rate 30%, milestone completion
  rate 30%, overdue items 25%, budget variance 15% (skip this component,
  redistributing its weight, if budget fields are absent).
- Status thresholds: Healthy ≥ 80, At Risk 50-79, Critical < 50 — make the
  thresholds named constants, not magic numbers.
- Returns { score, status, issues: string[], recommendations: string[] }
  with issues/recommendations generated from which sub-scores are weak.
- Private helpers: calculateTaskCompletionRate, calculateMilestoneCompletionRate,
  countOverdueItems, determineStatus — each independently unit-testable.

MilestoneDelayAnalysisService (src/services/milestone-analysis.ts):
- analyzeDelayImpact(milestoneId, delayDays, allMilestones, tasks):
  DelayImpactAnalysis, returning directImpacts, cascadingImpacts,
  totalProjectDelay, criticalPathAffected, recommendedActions.
- getDependencyChain(milestoneId, allMilestones): string[] — walk the
  dependency graph (assume a Dependencies/PredecessorId field on
  Milestones); detect and reject circular dependencies rather than
  infinite-looping.
- calculateCascadingDates(milestoneId, delayDays, milestones):
  DateAdjustment[].

New MCP tools:
- check_plan_health(projectId) — fetches project/tasks/milestones via the
  Phase 2 tools, then calls ProjectHealthService.
- analyze_milestone_delay(milestoneId, delayDays) — calls
  MilestoneDelayAnalysisService.
- get_project_statistics(projectId) — totalTasks, completedTasks,
  overdueTasks, totalMilestones, completedMilestones, overallProgress (%),
  estimatedCompletionDate (derived from remaining task velocity).

Deliverables: the two services, three new tools wired into server.ts, and
thorough unit tests with hand-constructed fixtures — this is the highest-
risk business logic in the system, test the scoring math and the dependency
graph traversal exhaustively, including edge cases (no tasks, all overdue,
circular dependency).
```

**Test:** Given fixed test fixtures, health scores and delay-impact results match hand-calculated expected values; circular dependency input is rejected with a clear error, not a stack overflow.

---

## Phase 4 — Actions: Escalation Management & Alerting

**Prompt:**
```
Implement write actions and the scheduled alert system.

Tool: create_escalation
- Params: projectId, issue, priority ("Low"|"Medium"|"High"|"Critical"),
  assignedTo (optional), dueDate (optional).
- Creates an item in the "Escalations" list: Title auto-generated as
  "Escalation: [Project Title]", plus ProjectId (lookup), IssueDescription,
  Priority, Status (default "Open"), CreatedBy, CreatedDate, AssignedTo,
  DueDate.
- Returns the created item with its SharePoint ID; writes an audit log
  entry (audit service is stubbed here, wired fully in Phase 5).

Tool: update_escalation
- Params: escalationId, plus a partial set of updatable fields. Reject
  attempts to change ProjectId or CreatedBy after creation.

Tool: get_escalations_by_project
- Params: projectId, status (optional). Returns matching escalations.

AlertService (src/services/alert-service.ts):
- startAlertScheduler(): registers node-cron jobs from configurable
  schedules (default: overdue check daily 09:00, upcoming-milestones daily
  10:00, weekly health check Monday 08:00).
- checkOverdueItems(): queries overdue tasks/milestones across active
  projects.
- checkUpcomingMilestones(): milestones due within 7 days.
- sendAlertEmail(recipients, subject, body): use SharePoint's own
  alert/email mechanism if available, else SMTP via nodemailer as a
  fallback — make the transport pluggable behind an EmailSender interface.
- logAlert(alert): records to an Alerts list (define its schema alongside
  Escalations in this phase's deliverables).

Deliverables: src/tools/escalation-tools.ts, src/services/alert-service.ts,
src/services/email-service.ts, SharePoint list schema docs for Escalations
and Alerts, unit tests for escalation CRUD and for the alert-detection
logic (mock the clock/cron, don't rely on real timers in tests).
```

**Test:** `create_escalation` produces a correctly shaped SharePoint item; `checkOverdueItems`/`checkUpcomingMilestones` correctly classify a mocked mixed dataset of on-time, overdue, and upcoming items.

---

## Phase 5 — Security, Permissions & Audit Logging

**Prompt:**
```
Implement permission-aware responses and comprehensive audit logging —
treat this phase as a compliance requirement, not an optional add-on.

PermissionService (src/services/permission-service.ts):
- getUserADGroups(username): resolve AD group membership (via SharePoint's
  user info list or an LDAP call if available — make this pluggable).
- filterByPermissions<T>(items, permissionField, userGroups): filters a
  result set down to items the caller's groups may see.
- hasProjectAccess(userId, projectId): boolean check for a single project.
- trimResultsByADGroups(items, userGroups): applied uniformly wherever
  list data is returned.

Wire this into every read tool from Phases 2-4:
- Every tool accepts an optional `userId`.
- Every tool calls filterByPermissions before returning results, so an
  unauthorized caller never sees data they lack access to, rather than
  seeing it and being told "access denied" after the fact.

AuditService (src/services/audit-service.ts):
- logAIAction({ toolName, parameters, userId, timestamp, result, duration })
- logDataAccess({ listName, itemId, action: READ|CREATE|UPDATE|DELETE,
  userId, timestamp })
- logSecurityEvent({ eventType: PERMISSION_DENIED|UNAUTHORIZED_ACCESS|
  SUSPICIOUS_ACTIVITY, userId, details, timestamp })
- getAuditLogs(filters): query with date range, eventType, userId filters.
- Persist to an "AI_AuditLog" SharePoint list (Title, ToolName, Action,
  Parameters as JSON, UserId, Timestamp, Duration, Result as JSON,
  IPAddress) — document this schema.
- Also document how to enable SharePoint's native audit logging and query
  it via /_api/site/auditdata, and how the two logs relate.

Security hardening (apply across the codebase, not just new files):
- Validate and sanitize every tool parameter before it reaches a
  SharePoint query (defense against CAML/OData injection).
- Add basic rate limiting at the HTTP gateway (per-user, sliding window).
- Log every failed authentication attempt as a security event.
- Confirm no secrets are logged, ever — add a log redaction helper for
  known sensitive field names.

New tools: get_audit_logs, get_user_permissions.

Deliverables: permission-service.ts, audit-service.ts, updated tools with
permission filtering wired in, AI_AuditLog schema doc, a short
SECURITY.md, unit tests for filterByPermissions and for audit log writing.
```

**Test:** A user with limited AD group membership only sees the subset of projects/tasks they're entitled to; every tool call, successful or not, produces a corresponding audit log entry.

---

## Phase 6 — AI Assistant Integration & SPFx Web Part

**Prompt:**
```
Wire the MCP server up to real AI clients and build the SharePoint-native
chat interface.

Part A — MCP client configuration:
- Produce a working Claude Desktop config entry (mcpServers block) and a
  VS Code .vscode/mcp.json entry, both pointing at the built stdio server.
- Write src/prompts/system-prompt.md: a system prompt for the assistant
  describing its capabilities (query, health check, delay analysis,
  escalation creation, permission-aware responses), its guidelines (always
  respect permissions, confirm before creating escalations, use the
  correct tool for the correct question), and an auto-generated list of
  all registered tools with descriptions and parameters (generate this
  list from the tool registry, don't hand-maintain it).

Part B — Middle-tier HTTP gateway (src/api/mcp-http-server.ts):
- Express server exposing POST /api/mcp/tool { toolName, args }.
- Authenticates the caller using the SharePoint/SPFx context (validate a
  bearer token issued by your SSO, or pass through the SharePoint user
  context header if the farm is set up for that) — do not trust a raw
  client-supplied userId.
- Forwards to the MCP server (spawn/reuse a persistent MCP client
  connection rather than spawning a new process per request) and returns
  the tool result.
- Applies the Phase 5 rate limiting and logs every gateway request.

Part C — SPFx web part (spfx/webparts/projectAIAssistant/):
- React-based chat UI: ChatHistory, ChatInput, message list with
  role-based styling (user/assistant), a loading state while awaiting a
  tool response, and graceful error display if the gateway call fails.
- McpClientService.callTool(toolName, args) wraps the fetch to the
  gateway, attaching the SPFx context's access token.
- Web part properties: mcpGatewayUrl (configurable per-environment).

Deliverables: MCP client config files, system-prompt.md (with generated
tool catalog), the HTTP gateway, the SPFx web part source, and a short
manual test script for an end-to-end round trip (type a question in the
web part → gateway → MCP server → SharePoint → response rendered in chat).
```

**Test:** A question typed into the SPFx web part returns a live, permission-filtered answer sourced from SharePoint data, and the round trip is captured in the audit log.

---

## Phase 7 — Testing, Hardening & Production Deployment

**Prompt:**
```
Close out the project with the testing, hardening, and deployment work
needed to run this in production, not just in a dev sandbox.

Testing:
- Fill any coverage gaps so business logic (health scoring, delay
  analysis, permission filtering) has ≥80% coverage.
- Add integration tests that exercise the full tool-call flow against a
  mocked SharePoint server (e.g. nock or msw), not just unit-level mocks.
- Add a smoke-test script that starts the MCP server and gateway and
  verifies tools/list and one representative tool call succeed.

Hardening:
- Move secrets (SharePoint credentials, JWT signing key, SMTP creds) out
  of .env files in production — document how to source them from Windows
  DPAPI, a vault, or the hosting platform's secret store instead.
- Review and tighten the rate limiter and input validation added in
  Phase 5 against realistic abuse scenarios.
- Add a health-check endpoint on the HTTP gateway for monitoring.
- Confirm structured logs are shippable to whatever log aggregation the
  organization uses (stdout in JSON, ready for a log shipper).

Deployment:
- Document deploying the MCP server + gateway to a Windows Server host as
  a Node.js service (nssm or a native Windows Service wrapper), including
  SSL termination and firewall rules.
- Document building and shipping the SPFx package (gulp bundle --ship,
  gulp package-solution --ship) to the App Catalog, and adding the web
  part to project site pages.
- Produce a rollback plan: what to do if a deployed phase breaks
  production SharePoint access.

Documentation deliverables:
- README.md: setup, environment variables, how to run locally.
- USER_GUIDE.md: for project managers using the chat assistant.
- ADMIN_GUIDE.md: for the SharePoint admin maintaining lists, schedules,
  and AD group mappings.
- A final testing checklist confirming all 13 tools and both features 1-9
  identified in the Solution Overview are working end-to-end.

Deliverables: expanded test suite, hardening changes, deployment docs,
README/USER_GUIDE/ADMIN_GUIDE.
```

**Test:** Full end-to-end checklist passes; a fresh clone of the repo can be configured via `.env` and deployed following only the written documentation, with no undocumented steps.

---

## Appendix A — Full Tool Catalog

| # | Tool | Phase | Purpose |
|---|---|---|---|
| 1 | query_project_data | 2 | Generic list query |
| 2 | get_project_by_id | 2 | Project + related tasks/milestones |
| 3 | get_tasks_by_project | 2 | Tasks for a project, optional status filter |
| 4 | get_milestones_by_project | 2 | Milestones for a project |
| 5 | search_projects | 2 | Free-text project search |
| 6 | check_plan_health | 3 | Health score, status, issues |
| 7 | analyze_milestone_delay | 3 | Cascading delay impact |
| 8 | get_project_statistics | 3 | Progress metrics |
| 9 | create_escalation | 4 | Open a new escalation |
| 10 | update_escalation | 4 | Update an escalation |
| 11 | get_escalations_by_project | 4 | List escalations |
| 12 | get_audit_logs | 5 | Query audit trail |
| 13 | get_user_permissions | 5 | Inspect a user's access |

## Appendix B — SharePoint List Schemas (summary)

- **Projects** — Title, Description, Owner, StartDate, EndDate, Budget, ActualCost, Status.
- **Tasks** — Title, Project (lookup), AssignedTo, Status, DueDate, PercentComplete.
- **Milestones** — Title, Project (lookup), DueDate, Status, Dependencies (lookup/multi).
- **Escalations** — Title, ProjectId (lookup), IssueDescription, Priority, Status, CreatedBy, CreatedDate, AssignedTo, DueDate.
- **AI_AuditLog** — Title, ToolName, Action, Parameters (JSON text), UserId, Timestamp, Duration, Result (JSON text), IPAddress.
- **Alerts** — Title, AlertType, RelatedItemId, Recipients, SentDate, Status.

## Appendix C — `.env.example`

```
SHAREPOINT_SITE_URL=http://sp-server/sites/projects
SHAREPOINT_USERNAME=svc_ai_assistant
SHAREPOINT_PASSWORD=changeme
SHAREPOINT_DOMAIN=CORP
SHAREPOINT_AUTH_MODE=ntlm

LOG_LEVEL=info

ALERT_SCHEDULE_OVERDUE=0 9 * * *
ALERT_SCHEDULE_MILESTONES=0 10 * * *
ALERT_SCHEDULE_HEALTHCHECK=0 8 * * 1

HTTP_GATEWAY_PORT=3001
JWT_SIGNING_KEY=changeme
```
