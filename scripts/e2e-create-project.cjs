/** Live write test: asks the assistant to create openstack through chat. Reads secrets without logging them. */
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
    const started = new Date().toISOString();
    await page.locator('#input').fill('Create a new project named openstack.');
    const chatResponse = page.waitForResponse((r) => r.url().endsWith('/api/chat'), {
      timeout: 180000,
    });
    await page.locator('#send').click();
    const response = await chatResponse;
    const data = await response.json();
    console.log(
      JSON.stringify({ chatStatus: response.status(), reply: data.reply, error: data.error }),
    );
    assert.equal(response.status(), 200);
    await page.locator('.msg.assistant').waitFor();
    const result = await page.request.post('http://localhost:3001/api/mcp/tool', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: { toolName: 'list_projects', args: {} },
    });
    assert.equal(result.status(), 200);
    const projects = (await result.json()).result.filter(
      (p) => p.title.toLowerCase() === 'openstack',
    );
    assert.equal(projects.length, 1, 'Expected exactly one openstack project');
    const auditResult = await page.request.post('http://localhost:3001/api/mcp/tool', {
      headers: { Authorization: `Bearer ${session.accessToken}` },
      data: { toolName: 'get_audit_logs', args: { userId: session.userId } },
    });
    const audit = (await auditResult.json()).result;
    assert.ok(
      audit.some(
        (r) =>
          r.timestamp >= started && r.toolName === 'create_project' && r.result?.isError === false,
      ),
      'Assistant must call create_project successfully',
    );
    await page.screenshot({ path: 'plans/e2e-create-project.png', fullPage: true });
    const report = {
      passed: true,
      project: projects[0],
      reply: data.reply,
      checks: [
        'assistant selected create_project from chat',
        'successful audited tool execution',
        'new project verified in SharePoint listing',
      ],
    };
    writeFileSync('plans/e2e-create-project-result.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e.name + ': ' + e.message);
  process.exitCode = 1;
});
