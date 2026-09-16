# End-to-end test report — 2026-09-14

## Results

- Unit/integration suite: 36 suites, 201 tests passed. The installed dependencies lacked the Linux native Jest resolver; the matching npm package was downloaded into /tmp and supplied via NAPI_RS_NATIVE_LIBRARY_PATH. No dependency manifest was changed.
- TypeScript typecheck and production build: passed.
- Lint: failed on the pre-existing `src/sharepoint/project-workspace.ts:181` error: `preserve-caught-error` (thrown error does not retain its cause).
- Browser: assistant page loaded and correctly disabled Send without an access token. Authenticated behavior was tested through HTTP, not the browser.
- Live gateway: health 200; unauthenticated session 401; authenticated session 200; malformed chat 400.
- Live project search: returned `hexacloud` and `project1` with GUIDs.
- Repository smoke test in configured container: passed; MCP catalog contained six tools and project search succeeded through stdio and HTTP. The HTTP check exercised the already-running gateway.
- Live chat: plan request returned HTTP 200 and a capability-gap explanation.

## Requested plan outcome

Asked the SharePoint AI assistant to create a detailed plan for `project1`, based on the Kubernetes document in `hexacloud`, including phases, dependencies, estimates, roles, milestones, acceptance criteria, risks and source references.

The assistant identified both projects but could not read the document or create/save a plan. The deployed integration exposes six read-only Project Server tools; document access and plan creation are absent. No plan was created or saved.

An answer-quality defect was also observed: the assistant implied the Kubernetes document did not exist based on project-name search. That search cannot establish document absence. The document's existence/content remains unverified.

The untracked project-workspace implementation in the working tree is not registered in the current Project Server tool catalog. Completing and validating that integration is needed to support this workflow.

## Evidence

- `e2e-project-plan-result.txt`: live HTTP results, submitted prompt, assistant reply.
- `e2e-jest-result-live.txt`: test suite result.
- `../scripts/e2e-project-plan.cjs`: repeatable live request script, intended to run inside the configured gateway container. Tokens stay within the process and are not printed.
