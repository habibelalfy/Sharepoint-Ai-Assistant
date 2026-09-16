# SharePoint AI Assistant full-feature delivery plan

Date: 2026-09-14  
Planning horizon: 28 weeks  
Target platform: SharePoint Server 2019 and Project Server/PWA, on premises

## Goal

Deliver every capability and governance control in `sharepoint-ai-pm-assistant-v2-with-examples.pptx`, using Project Server as the primary project system and SharePoint lists for supporting records such as approvals, escalations, alerts, reports, and AI audit events.

The plan starts from the current implementation. Published project lookup, standalone chat, document reading, plan preview/publishing, and local audit logging already work. The remaining work closes the SPFx, identity, permissions, Project Server feature parity, approval, reporting, RAG, analytics, and integration gaps.

## Delivery assumptions

- One Product Owner/PM and one technical lead remain assigned throughout.
- Core delivery team: two backend engineers, one SPFx engineer, one SharePoint/Project Server engineer, one QA automation engineer, and part-time security/AD and platform support.
- Phase 4 adds a Power BI engineer. Phase 5 adds a data/ML engineer and integration engineer.
- Development, test, and production SharePoint farms are available.
- Production uses an on-premises LLM endpoint approved by security.
- Teams notifications require an approved hybrid/data-gateway exception. Without that exception, the Teams feature cannot be delivered under the deck's fully on-premises constraint.
- Predictive warnings require enough clean historical schedule data. Phase 5 includes a rules-based fallback until a model meets quality thresholds.

## Timeline

| Phase | Weeks | Outcome |
|---|---:|---|
| 0. Architecture and security foundation | 1–3 | Approved identity, authorization, data, approval, and deployment designs |
| 1. Secure MVP access and lookup | 4–7 | Working SPFx chat with caller-specific Project Server access |
| 2. Project management operations | 8–12 | Alerts, health, delay analysis, escalation, and complete audit coverage |
| 3. Governed project changes | 13–17 | Plan, task, milestone, baseline, and approval workflows |
| 4. Reports, semantic search, and dashboards | 18–21 | Status reports, Project Server RAG, and Power BI Report Server dashboards |
| 5. Later-phase intelligence and integrations | 22–26 | Predictions, resource conflicts, Teams, external adapters, and multilingual UI |
| 6. Hardening and production rollout | 27–28 | Security approval, recovery testing, UAT, and production launch |

## Phase 0: Architecture and security foundation

Duration: 3 weeks  
Exit milestone: Architecture and security baseline approved

| ID | Work item | Duration | Owner | Depends on | Acceptance criteria |
|---|---|---:|---|---|---|
| 0.1 | Confirm Project Server/PWA as the canonical project/task/milestone source | 2 days | Product Owner, SharePoint architect | None | Data ownership and write boundaries are signed off |
| 0.2 | Design SPFx-to-gateway Windows authentication | 4 days | Security/AD engineer, backend lead | 0.1 | Design identifies the caller without AAD placeholders or browser-entered bearer tokens |
| 0.3 | Design caller permission evaluation for PWA and project sites | 4 days | SharePoint architect, security engineer | 0.2 | Read and write authorization rules cover projects, tasks, documents, and supporting lists |
| 0.4 | Define supporting SharePoint lists | 3 days | SharePoint engineer | 0.1 | Schemas approved for Escalations, Alerts, Approvals, Status Reports, and AI Action Log |
| 0.5 | Define a reusable approval state machine | 4 days | Technical lead, Product Owner | 0.3, 0.4 | Request, approver, decision, expiry, target, before/after values, and audit linkage are specified |
| 0.6 | Define deployment topology and environments | 3 days | Platform engineer | 0.2 | Dev/test/prod topology, certificates, secrets, backups, monitoring, and rollback are documented |
| 0.7 | Build the feature-level test matrix | 3 days | QA lead | 0.1–0.6 | Every deck feature and governance control has an automated or UAT acceptance test |

Key decisions:

- Use IIS or an approved reverse proxy with Windows Integrated Authentication in front of the gateway.
- Pass a server-validated caller identity to the application. Do not trust a browser-supplied identity header.
- Use the caller's effective SharePoint/Project Server permissions for reads and a separate action policy for writes.
- Retain the existing plan preview and verified Project Server publish protections.

## Phase 1: Secure MVP access and lookup

Duration: 4 weeks  
Exit milestone: Permission-aware SPFx read experience accepted

| ID | Work item | Duration | Owner | Depends on | Acceptance criteria |
|---|---|---:|---|---|---|
| 1.1 | Complete the SPFx solution scaffold and production build | 4 days | SPFx engineer | 0.2, 0.6 | `.sppkg` builds, deploys to the app catalog, and renders in SharePoint 2019 |
| 1.2 | Replace the AAD placeholder token flow | 5 days | SPFx and backend engineers | 0.2 | SPFx authenticates through the approved on-premises flow and the gateway rejects forged identities |
| 1.3 | Route SPFx natural-language questions to `/api/chat` | 4 days | SPFx engineer | 1.1, 1.2 | Project questions invoke the LLM tool loop instead of always calling `search_projects` |
| 1.4 | Implement caller-specific PWA permission trimming | 7 days | SharePoint and backend engineers | 0.3, 1.2 | Two users with different PWA access receive different, correct results before data reaches the LLM |
| 1.5 | Enforce document-library permissions | 5 days | SharePoint engineer | 1.4 | Project-site document search/read rejects files the caller cannot read |
| 1.6 | Complete lookup filters | 4 days | Backend engineer | 1.4 | Project, task, milestone, owner/assignee, status, overdue, and date-range queries work |
| 1.7 | Add citations and structured result rendering in SPFx | 4 days | SPFx engineer | 1.3, 1.5, 1.6 | Chat shows readable tables and source links without exposing hidden fields |
| 1.8 | Execute security and functional tests | 3 days | QA, security engineer | 1.1–1.7 | Authentication, authorization, prompt-injection, and data-leakage tests pass |

Deck coverage: project data model, chatbot, permission-aware answers, and project/task/milestone lookup.

## Phase 2: Project management operations

Duration: 5 weeks  
Exit milestone: All nine MVP features pass in Project Server mode

| ID | Work item | Duration | Owner | Depends on | Acceptance criteria |
|---|---|---:|---|---|---|
| 2.1 | Add Project Server adapters for health inputs | 5 days | Backend engineer | 1.6 | Health tool consumes published PWA project, task, milestone, and cost data without custom-list assumptions |
| 2.2 | Calibrate health thresholds and explanations | 4 days | Product Owner, backend engineer | 2.1 | Red/yellow/green or approved equivalent matches agreed rules and returns traceable reasons |
| 2.3 | Add Project Server task/dependency graph retrieval | 6 days | SharePoint engineer | 1.6 | Task links, calendars, lag, milestones, and dates are mapped accurately |
| 2.4 | Upgrade delay and critical-path simulation | 6 days | Backend engineer | 2.3 | Simulation reports downstream date effects, slack, critical path, and unsupported scheduling cases |
| 2.5 | Enable scheduled overdue and milestone alerts for PWA | 6 days | Backend and SharePoint engineers | 1.4, 1.6 | Scheduled jobs group actionable items by owner/PM and avoid unauthorized disclosure |
| 2.6 | Configure SMTP and SharePoint alert records | 3 days | Platform engineer | 0.4, 2.5 | Test messages arrive, retries work, and every notification has an Alerts record |
| 2.7 | Implement Project Server escalation creation | 5 days | Backend engineer | 0.4, 1.4 | Authorized users can draft and confirm an escalation linked to a PWA project |
| 2.8 | Add escalation notification and lifecycle | 4 days | Backend engineer | 2.6, 2.7 | PMO notification, assignment, status updates, due dates, and closure are tested |
| 2.9 | Unify AI and native audit evidence | 6 days | Backend and SharePoint engineers | 0.4, 0.5 | Reads, writes, approvals, before/after values, actor, target, duration, result, and correlation ID are queryable |
| 2.10 | Run MVP end-to-end tests | 4 days | QA lead | 2.1–2.9 | All nine deck MVP scenarios pass with two permission profiles |

Deck coverage: overdue alerts, plan health, milestone delay analysis, escalation creation, and audit logging.

## Phase 3: Governed project changes

Duration: 5 weeks  
Exit milestone: Human-approved project changes available in SPFx

| ID | Work item | Duration | Owner | Depends on | Acceptance criteria |
|---|---|---:|---|---|---|
| 3.1 | Productize document-based plan drafting | 5 days | Backend engineer | 1.5, 2.9 | Plan draft distinguishes source facts from estimates and records source sections |
| 3.2 | Add existing-project and new-project plan paths | 6 days | SharePoint engineer | 3.1 | User can select an existing project or request a new PWA project through an approved provisioning policy |
| 3.3 | Implement general approval service | 7 days | Backend engineer | 0.5, 2.9 | Approval requests enforce approver role, expiry, single use, immutable target, and complete audit evidence |
| 3.4 | Build SPFx draft and approval UI | 7 days | SPFx engineer | 1.3, 3.3 | Users can inspect changes, assumptions, sources, and approvers before submitting or approving |
| 3.5 | Add low-risk single-task creation | 4 days | Backend engineer | 3.3 | Authorized user confirmation creates one task idempotently and verifies it after publish |
| 3.6 | Add own-task update rules | 4 days | Backend engineer | 1.4, 3.3 | Owners can update permitted fields; ownership is resolved server-side |
| 3.7 | Add other-user task approval | 4 days | Backend engineer | 3.3, 3.6 | Updates to another user's task remain pending until an authorized approver accepts them |
| 3.8 | Add milestone and baseline approval | 5 days | Backend and SharePoint engineers | 2.3, 3.3 | PM/PMO approval is required and date changes preserve before/after values |
| 3.9 | Add admin-controlled deletion workflow | 4 days | Backend engineer | 3.3 | Only admins approve deletion; preview identifies dependent records and recovery procedure |
| 3.10 | Add recovery and partial-failure handling | 4 days | Backend engineer | 3.2, 3.5–3.9 | Retry, idempotency, queue-job failure, checkout conflict, and rollback tests pass |

Deck coverage: AI-assisted project plan creation, approval workflows, and all eight human-in-the-loop controls.

## Phase 4: Reports, semantic search, and dashboards

Duration: 4 weeks  
Exit milestone: All high-priority features available

| ID | Work item | Duration | Owner | Depends on | Acceptance criteria |
|---|---|---:|---|---|---|
| 4.1 | Enable the RAG indexer for PWA project sites | 6 days | Backend engineer | 1.5 | Supported files are indexed incrementally with site, project, URL, version, and ACL metadata |
| 4.2 | Enforce retrieval-time permissions and citations | 5 days | Backend and security engineers | 4.1 | Every returned chunk passes current caller permission checks and links to its exact source |
| 4.3 | Build status-report data model and generator | 6 days | Backend engineer | 2.1–2.4, 4.2 | Weekly/status reports cite project data, list assumptions, and remain drafts |
| 4.4 | Add report review, approval, and publish/send controls | 5 days | SPFx and backend engineers | 3.3, 4.3 | Human reviewer can edit, approve, save, and send with an audit trail |
| 4.5 | Create Power BI Report Server semantic model | 6 days | BI engineer | 2.9 | Dataset covers portfolio health, milestones, overdue work, escalations, and resources |
| 4.6 | Build and embed dashboards | 5 days | BI and SPFx engineers | 4.5 | Role-filtered reports render in the approved on-premises experience |
| 4.7 | Validate RAG, reports, and BI security | 3 days | QA, security engineer | 4.1–4.6 | Citation, stale-index, ACL-change, report approval, and row-level-security tests pass |

Deck coverage: AI-generated status reports, Power BI dashboards, and semantic search/RAG with citations.

## Phase 5: Later-phase intelligence and integrations

Duration: 5 weeks  
Exit milestone: All later-phase features accepted or placed behind approved feature flags

| ID | Work item | Duration | Owner | Depends on | Acceptance criteria |
|---|---|---:|---|---|---|
| 5.1 | Build historical schedule-quality pipeline | 6 days | Data engineer | 2.9 | Baselines, changes, actuals, delays, and data-quality scores are versioned for training |
| 5.2 | Deliver predictive delay warnings | 8 days | Data/ML engineer | 5.1 | Model or rules fallback meets agreed precision/recall, explains drivers, and is monitored for drift |
| 5.3 | Build cross-project resource model | 6 days | SharePoint and data engineers | 2.3, 4.5 | Capacity, calendars, assignments, skills, and availability are normalized across projects |
| 5.4 | Add resource conflict detection | 6 days | Backend engineer | 5.3 | Assistant identifies overlapping over-allocation and shows dates, projects, and proposed resolution |
| 5.5 | Approve and implement Teams notification path | 6 days | Security, integration engineer | Hybrid exception, 3.3 | Only approved events cross the boundary; messages contain permitted data and delivery is audited |
| 5.6 | Build external-system adapter framework | 5 days | Integration engineer | 3.3, 2.9 | Adapters enforce authentication, allowlisted operations, idempotency, mapping, and audit rules |
| 5.7 | Deliver first Jira or ServiceNow adapter | 5 days | Integration engineer | 5.6 | One approved read/write use case passes contract and failure-recovery tests |
| 5.8 | Add multilingual product support | 6 days | SPFx and backend engineers | 1.3 | UI, prompts, dates, errors, accessibility labels, and report templates support approved languages |
| 5.9 | Validate later-phase features | 4 days | QA lead | 5.1–5.8 | Bias, privacy, integration, localization, and fallback tests pass |

Deck coverage: predictive delay warnings, cross-project resource conflicts, Teams notifications, external integrations, and multilingual support.

## Phase 6: Hardening and production rollout

Duration: 2 weeks  
Exit milestone: Production launch approved

| ID | Work item | Duration | Owner | Depends on | Acceptance criteria |
|---|---|---:|---|---|---|
| 6.1 | Performance and scale test | 3 days | QA, platform engineer | Phases 1–5 | Defined concurrent-user, project, task, and document volumes meet response-time targets |
| 6.2 | Security assessment and remediation | 4 days | Security team | Phases 1–5 | Threat model, penetration test, secret review, dependency scan, and access review pass |
| 6.3 | Backup, restore, and disaster-recovery exercise | 2 days | Platform and SharePoint admins | 6.1 | Gateway state, databases, indexes, lists, and configuration restore within agreed RTO/RPO |
| 6.4 | User acceptance testing | 4 days | Product Owner, PMO users | 6.1–6.3 | Every deck scenario has signed evidence and no unresolved critical defect |
| 6.5 | Operations handover and production release | 2 days | Technical lead, operations | 6.4 | Runbooks, monitoring, support ownership, rollback, training, and release approval are complete |

## Feature-to-phase traceability

| Deck feature | Delivery phase |
|---|---|
| SharePoint project data model | 0, 1 |
| Chatbot for project questions | 1 |
| Permission-aware answers | 0, 1 |
| Project/task/milestone lookup | 1 |
| Overdue task and milestone alerts | 2 |
| Basic plan health assessment | 2 |
| Basic milestone delay impact analysis | 2 |
| Escalation case creation | 2 |
| Audit logging | 0, 2 |
| AI-assisted project plan creation | 3 |
| Dependency/critical-path simulation | 2 |
| Approval workflows | 0, 3 |
| AI-generated status reports | 4 |
| Power BI dashboards | 4 |
| Semantic search/RAG with citations | 4 |
| Predictive delay warnings | 5 |
| Cross-project resource conflict detection | 5 |
| Teams notifications | 5, subject to hybrid approval |
| External system integration | 5 |
| Multilingual support | 5 |
| Human-in-the-loop controls | 0, 3 |

## Stage gates

### Gate A: secure read access

- SPFx authenticates without AAD placeholder code.
- Project Server and document results reflect the authenticated user's permissions.
- Security tests show no cross-user data leakage.

### Gate B: MVP complete

- All nine MVP scenarios work in Project Server mode.
- Alerts reach test recipients and write traceable records.
- Every read and write has correlated audit evidence.

### Gate C: governed writes

- Draft, approval, publish, rejection, expiry, retry, and rollback paths pass.
- Ownership, PM/PMO, and admin rules are enforced server-side.
- Project Server checkout and queue failures cannot silently produce partial success.

### Gate D: high-priority features complete

- Status reports remain human-reviewed before send.
- RAG citations and permissions remain correct after document and ACL changes.
- Power BI Report Server applies the approved role filters.

### Gate E: production readiness

- All deck scenarios have signed acceptance evidence.
- Performance, security, recovery, accessibility, localization, and support readiness pass.

## Main risks and controls

| Risk | Impact | Control |
|---|---|---|
| Service-account reads expose data across PWA permissions | Critical | Complete Phase 1 caller-specific authorization before broader rollout |
| SPFx authentication design is incompatible with SharePoint 2019 | Critical | Prove Windows-auth flow in week 2 before building the full web part |
| Project Server draft/publish operations cause partial changes | High | Keep idempotent IDs, preview, checkout checks, queue verification, and recovery runbooks |
| RAG index retains access after ACL changes | Critical | Store ACL/version metadata and recheck permissions at retrieval time |
| Historical data is insufficient for predictions | High | Add data-quality gates and use transparent rules until the model qualifies |
| Teams conflicts with the on-premises-only constraint | High | Require an explicit architecture/security exception or leave the feature disabled |
| Power BI Report Server capacity or licensing is unavailable | Medium | Confirm infrastructure and licensing in Phase 0 |
| LLM produces unsupported project claims | High | Require tool-grounded answers, citations, source/estimate labels, and human approval for writes |

## Recommended delivery governance

- Demonstrate working software at the end of every two-week sprint.
- Keep feature flags for every write, external integration, prediction, and notification capability.
- Require test evidence and security review at each stage gate.
- Do not begin predictive analytics until audit/history data meets the approved quality threshold.
- Do not describe a feature as complete when it exists only in custom-list mode but the production deployment uses Project Server.
