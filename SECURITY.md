# Security, Permissions & Audit Logging

This document describes the Phase 5 security controls. Treat these as a
compliance requirement, not an optional add-on.

## 1. Permission model

Data is protected with a **least-exposure** filter applied uniformly across
every read tool (see `src/services/permission-service.ts`).

- Every read tool accepts an optional `userId`.
- Items carry an optional `PermittedGroups` column (a multi-value text field of
  AD group names). The mapper normalizes it to `permittedGroups: string[]`.
- **Visibility rule:** an item with no `permittedGroups` (or an empty list) is
  _public_ and visible to everyone. An item with a non-empty `permittedGroups`
  is visible only to callers who belong to at least one of those groups.
- `PermissionService.filterByPermissions(items, permissionField, userGroups)`
  is the generic primitive; `trimResultsByADGroups(items, userGroups)` applies
  it on the `permittedGroups` field. Results are filtered **before** they are
  returned — an unauthorized caller never receives data and is never told
  "access denied" after the fact.
- `PermissionService.getUserADGroups(username)` is pluggable behind the
  `ADGroupProvider` interface. The default `EmptyADGroupProvider` returns no
  groups (public-only). Replace it with a SharePoint/LDAP-backed provider in a
  production deployment.

## 2. Audit logging

`src/services/audit-service.ts` writes to the `AI_AuditLog` SharePoint list.

| Column       | Meaning                                                                            |
| ------------ | ---------------------------------------------------------------------------------- |
| `Title`      | Human-readable subject (tool name / list name / event type).                       |
| `ToolName`   | The MCP tool that triggered the entry (empty for non-AI events).                   |
| `Action`     | `AI_ACTION`, `DATA_READ`/`DATA_CREATE`/`DATA_UPDATE`/`DATA_DELETE`, or `SECURITY`. |
| `Parameters` | JSON-encoded, redacted parameters.                                                 |
| `UserId`     | Caller identity (from the optional `userId`).                                      |
| `Timestamp`  | ISO 8601 timestamp.                                                                |
| `Duration`   | Milliseconds for AI actions.                                                       |
| `Result`     | JSON-encoded, redacted result summary.                                             |
| `IPAddress`  | Source IP (populated by the Phase 6 gateway).                                      |

Three entry points:

- `logAIAction({ toolName, parameters, userId, timestamp, result, durationMs })` — every tool call.
- `logDataAccess({ listName, itemId, action, userId, timestamp })` — granular read/write access.
- `logSecurityEvent({ eventType, userId, details, timestamp })` — `PERMISSION_DENIED`, `UNAUTHORIZED_ACCESS`, `SUSPICIOUS_ACTIVITY`, or `AUTH_FAILURE`.

Every read tool is wrapped in a `withAudit` decorator (see `src/server.ts`) so a
successful _or_ failed call produces an entry; auditing is best-effort and never
breaks the underlying tool call. The `get_audit_logs` tool queries these rows
with optional `userId`, `action`, `from`, and `to` filters.

### Native SharePoint audit logging

SharePoint Server's own audit logging is a complementary record that captures
farm-level events (list item access, permission changes) independently of this
service. Enable it via the Site Collection Audit Settings, then query it
through the REST endpoint:

```
GET /_api/site/auditdata?startTime=...&endTime=...&user=...&event=...
```

The `AI_AuditLog` list records _why the assistant acted_ (tool, parameters,
result), while SharePoint's native audit records _what happened at the platform
layer_. They relate through the shared `UserId`/timestamp; both should be
retained together for a complete audit trail.

## 3. Input sanitization

All tool parameters are validated before they reach a SharePoint query
(defense against OData/CAML injection):

- `listName` is allow-listed against known list titles.
- Raw OData `$filter` strings are length/character-sanitized
  (`sanitizeFilter`), and literal values are single-quote-escaped
  (`escapeODataString`).
- `$select` field lists are validated against an identifier pattern.
- `projectId`/`milestoneId`/`escalationId` are coerced to non-negative integers.

## 4. Rate limiting

`src/api/rate-limiter.ts` provides a per-key **sliding-window** rate limiter. It
is wired into the HTTP gateway in Phase 6; apply it per-user to bound request
volume.

## 5. Secret handling

- `src/services/log-redaction.ts` recursively replaces values under
  sensitive-looking keys (`password`, `token`, `authorization`, `jwt`,
  `api_key`, `credential`, …) with `[REDACTED]`.
- The audit service runs `redactSecrets` over parameters and results before
  persisting, and the same helper should be applied to any structured logs that
  may contain request data.
- Never log credentials, tokens, or `.env` values.

## 6. Authentication failures

Every failed authentication attempt must be recorded as a security event:
`audit.logSecurityEvent({ eventType: 'AUTH_FAILURE', userId, details, timestamp })`.
The HTTP gateway (Phase 6) calls this on rejected bearer tokens / failed SSO
validation.

## 7. Production secret sourcing

`.env` files are for local development only. In production, never place real
credentials on disk in plaintext. Source the three secret classes from a store and
inject them into the process environment (the app only ever reads `process.env`,
so no code change is required):

| Secret                                    | Production source                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SharePoint service-account password       | Run the Node service under the domain account (Kerberos needs no stored password), or retrieve from **Windows DPAPI / Credential Manager** (`CredRead`), a vault, or the host's secret store. |
| `JWT_SIGNING_KEY` (gateway token signing) | A vault or managed secret; rotate on a schedule. Never use the `changeme` default.                                                                                                            |
| SMTP credentials (if `SMTP_HOST` is set)  | A vault or the host's secret store.                                                                                                                                                           |

### Windows DPAPI example

Store the gateway signing key with Credential Manager, then export it before
launching Node:

```powershell
$cred = Get-StoredCredential -Target "sharepoint-ai-jwt" -AsCredentialObject
$env:JWT_SIGNING_KEY = $cred.GetNetworkCredential().Password
node dist\api\mcp-http-server.js
```

### Vault example (HashiCorp Vault)

```bash
export JWT_SIGNING_KEY="$(vault kv get -field=value secret/sharepoint-ai/jwt)"
export SHAREPOINT_PASSWORD="$(vault kv get -field=value secret/sharepoint-ai/svc-password)"
node dist/server.js
```

The same injection pattern applies to Azure Key Vault, AWS Secrets Manager, or any
hosting platform's secret store. See `docs/deployment.md` §1.3 for the service
wiring.
