/** Live, read-only browser test. Reads configured secrets without logging them. */
const { readFileSync, writeFileSync } = require('node:fs');
const { parse } = require('dotenv');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
  const env = { ...parse(readFileSync('.env')), ...process.env };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto('http://localhost:3001/');
    await page.locator('#sharepoint-url').fill(env.SHAREPOINT_SITE_URL);
    await page
      .locator('[name=username]')
      .fill(`${env.SHAREPOINT_DOMAIN}\\${env.SHAREPOINT_USERNAME}`);
    await page.locator('#password').fill(env.SHAREPOINT_PASSWORD);
    await page.locator('#llm-url').fill(env.LLM_API_BASE_URL);
    await page.locator('#llm-key').fill(env.LLM_API_KEY);
    await page.locator('#model-name').fill(env.LLM_MODEL || 'deepseek-v4-pro');
    const setupResponse = page.waitForResponse((r) => r.url().endsWith('/api/setup'));
    await page.locator('#connect').click();
    const setup = await setupResponse;
    assert.equal(setup.status(), 200, 'Setup failed');
    const session = await setup.json();
    await page.locator('#chat-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#password').inputValue(), '');
    assert.equal(await page.locator('#llm-key').inputValue(), '');
    const aiResponse = await page.request.post('http://localhost:3001/api/chat', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: {
        messages: [
          {
            role: 'user',
            content: 'Compute 17 plus 25. Reply with the number only. Do not use tools.',
          },
        ],
      },
      timeout: 120000,
    });
    assert.equal(aiResponse.status(), 200, 'Live AI request failed');
    assert.ok((await aiResponse.json()).reply.includes('42'), 'Expected an AI answer of 42');
    const projectsResponse = await page.request.post('http://localhost:3001/api/mcp/tool', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: { toolName: 'list_projects', args: {} },
    });
    assert.equal(projectsResponse.status(), 200);
    const projects = (await projectsResponse.json()).result;
    assert.ok(Array.isArray(projects));
    const started = Date.now();
    await page.locator('#input').fill('List all projects');
    await page.locator('#send').click();
    await page.locator('.msg.assistant').waitFor({ timeout: 30000 });
    const reply = await page.locator('.msg.assistant').innerText();
    for (const project of projects) {
      assert.ok(reply.includes(project.title));
      assert.ok(reply.includes(project.id));
    }
    assert.ok(reply.startsWith(`${projects.length} published projects`));
    const documentsResponse = await page.request.post('http://localhost:3001/api/mcp/tool', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: { toolName: 'search_project_documents', args: { projectName: 'cloud1', query: '' } },
    });
    assert.equal(documentsResponse.status(), 200);
    const documents = (await documentsResponse.json()).result.documents;
    assert.ok(Array.isArray(documents));
    await page.locator('#input').fill('what document on cloud1?');
    await page.locator('#send').click();
    await page.locator('.msg.assistant').nth(1).waitFor({ timeout: 30000 });
    const documentReply = await page.locator('.msg.assistant').nth(1).innerText();
    for (const document of documents) {
      assert.ok(documentReply.includes(document.name));
      assert.ok(documentReply.includes(document.url));
    }
    assert.ok(documentReply.startsWith(`${documents.length} document(s) in cloud1:`));
    await page.screenshot({ path: 'plans/e2e-cloud1-documents.png', fullPage: true });
    const unauthorized = await page.request.post('http://localhost:3001/api/chat', {
      data: { messages: [{ role: 'user', content: 'List all projects' }] },
    });
    assert.equal(unauthorized.status(), 401);
    await page.screenshot({ path: 'plans/e2e-list-projects.png', fullPage: true });
    const result = {
      passed: true,
      documentCount: documents.length,
      documents: documents.map((d) => d.name),
      model: env.LLM_MODEL || 'deepseek-v4-pro',
      projectCount: projects.length,
      projects: projects.map((p) => p.title),
      chatMs: Date.now() - started,
      checks: [
        'browser setup',
        'live AI answered synthetic arithmetic question',
        'cloud1 document chat matches live SharePoint results',
        'credential fields cleared',
        'chat matches live MCP results',
        'unauthenticated chat rejected',
      ],
    };
    await page.locator('#change-connection').click();
    await page.locator('#setup-view').waitFor({ state: 'visible' });
    assert.equal(await page.locator('.msg').count(), 0);
    result.checks.push('change connection clears conversation');
    writeFileSync('plans/e2e-list-projects-result.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e.name + ': ' + e.message);
  process.exitCode = 1;
});
