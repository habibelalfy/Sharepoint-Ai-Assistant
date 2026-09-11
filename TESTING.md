# Testing

## Running the suite

```bash
npm test                # unit + integration tests
npm run test:coverage   # tests with coverage thresholds (fails if below the bar)
npm run typecheck       # tsc --noEmit
npm run lint            # eslint
npm run smoke:test      # end-to-end smoke test (requires .env + SharePoint)
```

## Coverage

Coverage thresholds are enforced in `jest.config.js`. Current aggregate:

| Metric     | %     |
| ---------- | ----- |
| Statements | 87.4% |
| Lines      | 87.9% |
| Functions  | 87.0% |
| Branches   | 72.8% |

The three core business-logic modules named in the build prompt are held at
≥ 80% statements/lines:

| Module                                                      | Statements | Lines | Branches |
| ----------------------------------------------------------- | ---------- | ----- | -------- |
| `src/services/health-assessment.ts` (health scoring)        | 100%       | 100%  | 96.9%    |
| `src/services/milestone-analysis.ts` (delay analysis)       | 98.5%      | 98.4% | 77.4%    |
| `src/services/permission-service.ts` (permission filtering) | 96.0%      | 95.8% | 88.9%    |

Branch coverage is lower overall because the Kerberos (SPNEGO) interceptor in
`src/sharepoint/auth.ts` and the stdio/gateway process bootstraps require a real
domain/host and are covered by integration/smoke tests rather than unit tests.

## Integration tests

`test/integration/tool-flow.test.ts` exercises the **full tool-call flow** against
a mocked SharePoint HTTP server (nock), not just unit mocks: MCP client → server →
tool handler → permission filtering → `SharePointClient` → mocked REST → mapper →
response. It covers permission-filtered queries, project search, and
project+task+milestone fetch.

## Final end-to-end checklist

Confirm each item against a configured `.env` and reachable SharePoint farm.

### Tools (13)

| #   | Tool                         | Verify                                                  |
| --- | ---------------------------- | ------------------------------------------------------- |
| 1   | `query_project_data`         | Returns mapped Projects/Tasks/Milestones rows.          |
| 2   | `get_project_by_id`          | Returns a project with its tasks + milestones.          |
| 3   | `get_tasks_by_project`       | Returns tasks for a project (status filter works).      |
| 4   | `get_milestones_by_project`  | Returns milestones, sorted by due date.                 |
| 5   | `search_projects`            | Free-text title/description match returns projects.     |
| 6   | `check_plan_health`          | Returns a 0–100 score, status, issues, recommendations. |
| 7   | `analyze_milestone_delay`    | Returns cascading delay impact (cycles handled).        |
| 8   | `get_project_statistics`     | Returns progress metrics + estimated completion.        |
| 9   | `create_escalation`          | Writes an escalation row (project/creator immutable).   |
| 10  | `update_escalation`          | Updates an escalation; rejects `projectId`/`createdBy`. |
| 11  | `get_escalations_by_project` | Lists escalations, optionally by status.                |
| 12  | `get_audit_logs`             | Returns redacted `AI_AuditLog` rows with filters.       |
| 13  | `get_user_permissions`       | Returns a user's AD groups + accessible projects.       |

### Features (9)

| #   | Feature                           | Verify                                                                                          |
| --- | --------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | Query project/task/milestone data | Tools 1–4 return live SharePoint data.                                                          |
| 2   | SPFx chat web part                | `spfx/webparts/projectAIAssistant/` builds; web part renders a chat round trip via the gateway. |
| 3   | Permission-aware answers          | A user without the required AD group cannot see restricted rows (tool 1 / 13).                  |
| 4   | Escalation case creation          | Tool 9 writes an `Escalations` row.                                                             |
| 5   | Scheduled alerts                  | Overdue/upcoming/health jobs email `ALERT_RECIPIENTS` on schedule.                              |
| 6   | Project health scoring            | Tool 6 returns a weighted score + status.                                                       |
| 7   | Milestone delay analysis          | Tool 7 returns cascading impact.                                                                |
| 8   | Escalation lifecycle tools        | Tools 9–11 cover open → update → list.                                                          |
| 9   | Audit logging & compliance        | Tool 12 shows redacted audit entries; `AUTH_FAILURE` events are logged.                         |

## Smoke test

`npm run smoke:test` boots the MCP server (stdio) and the gateway, asserts
`tools/list` returns all 13 tools, and performs one representative tool call
(`get_user_permissions`) through both paths. It requires `npm run build` and a
working `.env`.
