# Admin Guide — SharePoint Administrators

This guide covers deploying and operating the assistant against your SharePoint
Server 2019 farm: the lists it depends on, the service account, permissions,
schedules, alert delivery, and audit logging.

## 1. Required SharePoint lists

Create these lists on the project site. Field types are the SharePoint
"additional column types" (lookup, person/group, multiple lines of text, etc.).

| List          | Key columns                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Projects`    | Title, Description, Owner (person), StartDate, EndDate, Budget, ActualCost, Status, PermittedGroups (multi-line text)                                  |
| `Tasks`       | Title, Project (lookup → Projects), AssignedTo (person), Status, DueDate, PercentComplete, PermittedGroups                                             |
| `Milestones`  | Title, Project (lookup → Projects), DueDate, Status, Dependencies (lookup, multi), PermittedGroups                                                     |
| `Escalations` | Title, Project (lookup → Projects), IssueDescription, Priority, Status, CreatedBy (person), CreatedDate, AssignedTo (person), DueDate, PermittedGroups |
| `Alerts`      | Title, AlertType, RelatedItemId, Recipients, SentDate, Status                                                                                          |
| `AI_AuditLog` | Title, ToolName, Action, Parameters, UserId, Timestamp, Duration, Result, IPAddress                                                                    |

List titles are configured in `src/constants.ts` (`LIST_NAMES`); adjust there if
your farm uses different titles.

## 2. Service account & authentication

Create a dedicated domain service account (e.g. `svc_ai_assistant`) with **read**
access to `Projects`, `Tasks`, `Milestones`, and **contribute** access to
`Escalations`, `Alerts`, and `AI_AuditLog`.

- **Kerberos (recommended)** — `SHAREPOINT_AUTH_MODE=kerberos`. Run the Node
  process under the service account (or present a keytab/SPN) and install the
  native package: `npm install kerberos`.
- **NTLM (fallback)** — `SHAREPOINT_AUTH_MODE=ntlm` (pure JS, no native package).

## 3. Permissions (`PermittedGroups`)

Add a **`PermittedGroups`** column (multiple lines of text) to each restricted
list. Put AD group names in it (one per line):

- **Empty** column → the item is public (visible to everyone).
- **Non-empty** column → visible only to users in at least one listed AD group.

The default AD-group provider returns no groups (public-only). In production,
replace `EmptyADGroupProvider` (`src/services/permission-service.ts`) with a
provider backed by your directory (SharePoint user profile / LDAP) so
`PermittedGroups` is actually enforced against real AD membership.

## 4. Schedules & alert delivery

Set these in `.env` (cron expressions, `node-cron`):

- `ALERT_SCHEDULE_OVERDUE` — overdue items check.
- `ALERT_SCHEDULE_MILESTONES` — upcoming-milestones check.
- `ALERT_SCHEDULE_HEALTHCHECK` — weekly project health scan.
- `ALERT_RECIPIENTS` — comma-separated recipients.
- `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` — enable SMTP delivery (requires
  `npm i nodemailer`). If `SMTP_HOST` is unset, alerts are logged to stderr only.

## 5. Audit logging

Two complementary records:

1. **`AI_AuditLog` list** — why the assistant acted (tool name, parameters,
   caller, result). Every read/write tool call is recorded; parameters and
   results are secret-redacted before persisting.
2. **SharePoint native audit** — what happened at the platform layer. Enable via
   Site Collection Audit Settings, then query with
   `/_api/site/auditdata?startTime=…&endTime=…&user=…&event=…`.

The `get_audit_logs` tool exposes the `AI_AuditLog` rows; `get_user_permissions`
shows a caller's AD groups and the projects they can see.

## 6. Rate limiting & input validation

- The gateway applies a per-user **sliding-window rate limiter**
  (`src/api/rate-limiter.ts`). It is in-memory per gateway process; run a single
  gateway instance, or replace it with a shared store (Redis) behind the same
  interface for a multi-replica deployment.
- All tool parameters are zod-validated and OData-sanitized
  (`src/tools/common.ts`) before reaching a SharePoint query.

## 7. Secrets

Never put real credentials in `.env` in production. Source them from DPAPI, a
vault, or the host's secret store — see [`SECURITY.md`](SECURITY.md) §7 and
[`docs/deployment.md`](docs/deployment.md).
