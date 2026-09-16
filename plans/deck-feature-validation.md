# SharePoint AI Assistant feature validation

Date: 2026-09-14  
Source: `/home/ha/Downloads/sharepoint-ai-pm-assistant-v2-with-examples.pptx`

## Conclusion

The assistant cannot currently achieve every feature in the deck. The repository contains working implementations for much of the MVP, but the deployed Project Server configuration exposes a smaller capability set than the custom-list configuration. All five later-phase features remain unimplemented, and the deck's complete approval model is absent.

The current deployment is strongest at published Project Server lookup, standalone browser chat, direct project-site document reading, document-based plan drafting for an existing project, controlled plan publishing, and local audit logging.

## Validation evidence

- The attached 10-slide deck was rendered and its full text was extracted. It defines nine MVP features, six high-priority features, five later-phase features, and eight governance controls.
- Full automated suite: 37 test suites passed, 203 tests passed.
- TypeScript typecheck, production build, ESLint, and the live MCP smoke test passed.
- Live gateway configuration: `project-server` data source, LLM enabled with `deepseek-flash`, plan publishing allowlists enabled, SMTP disabled.
- Live MCP catalog: 10 Project Server tools.
- Live document-plan test: found and read all 30 pages of `_K8s on Openstack STG - Deployment Guide.pdf` from the Hexacloud project site and prepared a validated 17-task preview for `project1`.
- The prepared plan has not been published because the final Project Server mutation requires explicit approval.

Status meanings:

- **Available**: the current deployment can perform the core feature.
- **Partial**: code or a narrower version exists, but the deployed behavior or deck example is incomplete.
- **Absent**: no usable implementation was found.

## MVP features

| # | Deck feature | Status | Validation |
|---|---|---|---|
| 1 | SharePoint project data model | Partial | Custom-list mode defines Projects, Tasks, Milestones, Escalations, Alerts, and AI audit data. The live deployment uses native Project Server/PWA entities instead of the deck's standard-list model. |
| 2 | Chatbot for project questions | Partial | The standalone browser chat completes live LLM/tool round trips. The SPFx component is only a prototype: it always calls `search_projects`, has no intent/chat endpoint integration, lacks a complete SPFx build scaffold, and requests an AAD token for a placeholder audience while the gateway accepts its own HMAC tokens. |
| 3 | Permission-aware answers | Partial | Custom-list mode filters mapped rows by configured AD-group metadata and has integration tests. It does not call CSOM `GetUserEffectivePermissions`. Live Project Server reads use one service account and explicitly lack per-user permission trimming. |
| 4 | Project/task/milestone lookup | Available | Live tools search projects and read project details, tasks, milestones, and statistics. Project-name normalization now matches `Project 1` to `project1`. The deck's example lookup by assignee is not exposed in Project Server mode. |
| 5 | Overdue task and milestone alerts | Partial | Scheduled overdue, upcoming milestone, and health jobs exist and are tested in custom-list mode. The runtime disables them in Project Server mode. SMTP is not configured in the live deployment. |
| 6 | Basic plan health assessment | Partial | Weighted health scoring, issues, and recommendations are implemented and tested. The live Project Server catalog does not expose the health tool. Its thresholds also differ from the deck's illustrative red/yellow/green percentages. |
| 7 | Basic milestone delay impact analysis | Partial | Cascading date and critical-path analysis is implemented and tested for custom-list milestones. The live Project Server catalog does not expose it. |
| 8 | Escalation case creation | Partial | Custom-list mode can create, update, and list Escalations and writes an AI audit event. Project Server mode does not expose escalation tools, and creation does not trigger the PMO notification described in the deck. |
| 9 | Audit logging | Partial | Custom-list mode writes a SharePoint `AI_AuditLog`; Project Server mode writes redacted JSONL audit records. The implementation does not provide the deck's full before value, after value, approved-by record, or a query combining native SharePoint audit entries with AI actions. |

## High-priority features

| # | Deck feature | Status | Validation |
|---|---|---|---|
| 1 | AI-assisted project plan creation | Available with limits | The live assistant reads a source document, produces an additive task/dependency preview, requires an explicit publish step, preserves existing published tasks, refuses unrelated draft changes, uses user/project allowlists, and verifies publication. It adds a plan to an existing Project Server project; it does not create the project container itself. |
| 2 | Dependency/critical-path delay simulation | Partial | The custom-list milestone engine identifies a longest dependency path and cascades a uniform delay. It is unavailable in the live Project Server mode and is not a full task-level CPM scheduler with calendars, lag, slack, or resource constraints. |
| 3 | Approval workflows | Partial | Plan creation has a two-step preview/publish control. There is no general approval service, SharePoint Designer workflow, Nintex/K2 integration, approval inbox, approver identity record, or state machine for other writes. |
| 4 | AI-generated status reports | Partial | Chat can summarize retrieved data, but there is no structured report generator, saved report artifact, review state, or controlled send/publish workflow. |
| 5 | Power BI dashboards | Absent | No Power BI Report Server dataset, report, embed configuration, or dashboard integration was found. |
| 6 | Semantic search/RAG with citations | Partial | Embedding, pgvector indexing, permission-filtered retrieval, and citations are implemented and tested for custom-list mode. The runtime disables this RAG path in Project Server mode. The live Project Server tools support filename search and full document reading, not semantic retrieval. |

## Later-phase features

| # | Deck feature | Status | Validation |
|---|---|---|---|
| 1 | Predictive delay warnings | Absent | No historical-data model, training pipeline, prediction service, or warning tool was found. |
| 2 | Cross-project resource conflict detection | Absent | No resource-capacity model or cross-project allocation analysis was found. |
| 3 | Teams notifications | Absent | No Teams connector, webhook, bot, or hybrid notification path was found. |
| 4 | External system integration | Absent | No Jira, ServiceNow, or generic external-system adapter was found. |
| 5 | Multilingual support | Absent | No localization framework or language controls exist for the assistant. An LLM may answer in another language, but that does not validate product-level multilingual support. |

## Governance controls

| Deck control | Status | Validation |
|---|---|---|
| Read data: allowed and permission-filtered | Partial | True in custom-list tests. Live Project Server reads use service-account access without caller-specific trimming. |
| Draft plans/reports: allowed and shown as drafts | Partial | Project plans use a non-mutating preview. Formal report drafts are not implemented. |
| Create low-risk task: user confirmation | Partial | Plan publishing requires a prepared preview and explicit request, but there is no general single-task creation tool or reusable confirmation record. |
| Update own task: allowed | Absent | No task-update tool or ownership check exists. |
| Update another user's task: approval required | Absent | No task-update or approval workflow exists. |
| Change milestone/baseline date: PM/PMO approval | Absent | No milestone/baseline update tool or PM/PMO approval check exists. |
| Escalate a case: confirmation and approval | Partial | The system prompt asks for confirmation, but no durable approval workflow or approver record is enforced. The tool is unavailable in Project Server mode. |
| Delete items: admin approval | Absent | No delete tool or admin approval workflow exists. The absence of deletion is safe, but it does not implement the stated control. |

## Priority gaps

1. Replace the SPFx prototype's AAD placeholder flow with an authentication design supported by SharePoint 2019 on premises, and route natural-language questions to `/api/chat`.
2. Add caller-specific permission enforcement for Project Server and project-site documents before describing the live system as permission-aware.
3. Expose or reimplement alerts, plan health, delay analysis, and escalation for Project Server data if the deployment will remain in that mode.
4. Build a reusable approval workflow with approver identity, decision, timestamps, target, before/after values, and audit linkage.
5. Add task and milestone update operations with ownership and approval rules.
6. Decide whether semantic RAG must support Project Server sites, then enable its index/retrieval path with caller-specific permissions.
7. Treat Power BI, predictive warnings, resource conflicts, Teams, external integrations, and multilingual support as future work rather than current capabilities.

## Release assessment

The current system is suitable for a controlled Project Server pilot focused on read-only project lookup, browser chat, document-informed plan drafts, approved plan publication to allowlisted existing projects, and local auditing. It does not satisfy the deck as a complete MVP because the SPFx path, permission model, alerts, health/delay tools, escalation, and governance controls are incomplete in the deployed mode.
