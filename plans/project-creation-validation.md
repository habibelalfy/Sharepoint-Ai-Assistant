# Assistant project creation

Implemented and deployed `create_project` in the Project Server tool catalog. The AI can invoke it from an explicit creation request, with required name and optional description. The handler uses a request digest, connected-account permissions, exact-name duplicate detection, concurrent-request protection, and read-back verification. Failed or uncertain writes return an error rather than a success claim; no automatic write retry occurs.

Validation: TypeScript Docker build passed; 20 targeted tests passed across project client, tool catalog, and agent suites. Tests cover successful creation/read-back, existing names, permission denial, uncertain write retry prevention, and validation.

The live browser test `scripts/e2e-create-project.cjs` submits “Create a new project named openstack” to the assistant and verifies both its create_project audit record and the resulting project listing. Both live attempts stopped during setup before sending that prompt. A subsequent read-only Project Server query returned HTTP 500. No project was created directly or through chat during these attempts; live write verification remains pending server recovery.

Microsoft API reference: https://learn.microsoft.com/en-us/previous-versions/office/project-javascript-api/jj668478(v=office.15)

## Successful retry — 2026-09-15

The assistant received the creation prompt through its browser chat, selected create_project, and created openstack successfully. The audit records confirmed successful tool execution; an independent listing confirmed exactly one matching project with GUID 065a1d9e-8c29-45bd-8b54-9b1b590607a8. See e2e-create-project-result.json and e2e-create-project.png. The earlier blocked attempts above describe historical server unavailability, not the current result.

## Stale refusal and spelling regression

Explicit standalone project-creation prompts now route to create_project inside ChatAgent. The exact user prompt `craete new project name project20` succeeded through the browser with an old assistant capability refusal seeded in the conversation. Verified exactly one project20 in SharePoint, GUID 7333f972-529e-481a-8d4e-14d10d8c0fb5, and a successful audited create_project invocation. The updated build and 21 targeted tests passed. See e2e-project20-result.json and e2e-project20.png.
