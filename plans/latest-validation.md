# Validation — 2026-09-15 (successful retry)

The live browser test passed after the user confirmed SharePoint was available.

- Homepage setup authenticated successfully using the configured SharePoint connection and deepseek-v4-pro.
- The authenticated chat API answered a synthetic arithmetic prompt correctly (42).
- Browser chat listed all four projects returned by SharePoint: cloud1, cloud2, K8S, project10.
- Browser chat answered “what document on cloud1?” with the single PDF returned by SharePoint: dc Project Management Plan Template (V1.0) (1).pdf.
- Password and key fields cleared after setup; unauthenticated chat returned 401; Change connection cleared the conversation.
- Prior targeted configuration, agent, and provider regression tests: 39 passed.
- No PDF contents were sent to DeepSeek. A live PDF summary remains untested pending explicit transfer permission.

Machine-readable results: e2e-list-projects-result.json.
