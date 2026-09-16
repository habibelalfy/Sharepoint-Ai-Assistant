const { readFileSync, writeFileSync } = require('node:fs');
const { parse } = require('dotenv');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const env = { ...parse(readFileSync('.env')), ...process.env };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.goto('http://localhost:3001/');
    const values = {
      sharePointUrl: env.SHAREPOINT_SITE_URL,
      username: env.SHAREPOINT_DOMAIN + '\\' + env.SHAREPOINT_USERNAME,
      password: env.SHAREPOINT_PASSWORD,
      llmUrl: env.LLM_API_BASE_URL,
      llmKey: env.LLM_API_KEY,
      modelName: env.LLM_MODEL,
    };
    for (const [name, value] of Object.entries(values))
      await page.locator(`[name="${name}"]`).fill(value);
    const setupResponse = page.waitForResponse((r) => r.url().endsWith('/api/setup'));
    await page.locator('#connect').click();
    const setup = await setupResponse;
    assert.equal(setup.status(), 200, 'Setup failed');
    const session = await setup.json();
    const datasetResponse = page.waitForResponse((r) => r.url().endsWith('/api/analytics/dataset'));
    await page.locator('#show-reports').click();
    const response = await datasetResponse;
    assert.equal(response.status(), 200);
    const dataset = await response.json();
    await page.waitForFunction(() => !document.getElementById('download-dataset').disabled);
    assert.equal(await page.locator('#report-rows tr').count(), dataset.projects.length);
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#download-dataset').click();
    const download = await downloadEvent;
    const exported = JSON.parse(readFileSync(await download.path(), 'utf8'));
    assert.equal(exported.schemaVersion, 1);
    assert.equal(exported.projects.length, dataset.projects.length);
    assert.ok(exported.projects.every((p) => typeof p.id === 'string'));
    const noAuth = await page.request.get('http://localhost:3001/api/analytics/dataset');
    assert.equal(noAuth.status(), 401);
    const warnings = await page.request.post('http://localhost:3001/api/mcp/tool', {
      headers: { Authorization: 'Bearer ' + session.accessToken },
      data: { toolName: 'get_predictive_delay_warnings', args: {} },
    });
    assert.equal(warnings.status(), 200);
    const warningData = (await warnings.json()).result;
    assert.equal(warningData.predictions.length, dataset.projects.length);
    assert.ok(
      warningData.predictions.every((p) =>
        p.observations < 3 ? p.predictedFinish === null : true,
      ),
    );
    await page.screenshot({ path: 'plans/e2e-analytics.png', fullPage: true });
    const testAi = process.env.TEST_AI_CHAT === '1';
    if (testAi) {
      await page.locator('#back-to-chat').click();
      const aiStarted = new Date().toISOString();
      await page
        .locator('#input')
        .fill(
          'Give predictive delay warnings for the published projects. Use recorded progress history and do not invent forecasts.',
        );
      const aiResponse = page.waitForResponse((r) => r.url().endsWith('/api/chat'), {
        timeout: 180000,
      });
      await page.locator('#send').click();
      const ai = await aiResponse;
      assert.equal(ai.status(), 200);
      const aiData = await ai.json();
      const auditResponse = await page.request.post('http://localhost:3001/api/mcp/tool', {
        headers: { Authorization: 'Bearer ' + session.accessToken },
        data: { toolName: 'get_audit_logs', args: { userId: session.userId } },
      });
      const audit = (await auditResponse.json()).result;
      assert.ok(
        audit.some(
          (r) =>
            r.timestamp >= aiStarted &&
            r.toolName === 'get_predictive_delay_warnings' &&
            r.result?.isError === false,
        ),
        'AI must invoke the predictive tool',
      );
      writeFileSync('plans/e2e-predictive-chat.txt', aiData.reply + '\n');
    }

    const report = {
      passed: true,
      aiPredictionToolVerified: testAi,
      projectCount: dataset.projects.length,
      taskCount: dataset.tasks.length,
      predictions: warningData.predictions.map((p) => ({
        title: p.title,
        status: p.status,
        observations: p.observations,
      })),
      checks: [
        'real homepage login',
        'reports rendered from live dataset',
        'Power BI JSON download verified',
        'unauthenticated export rejected',
        'predictive tool available',
        'no invented forecasts without history',
      ],
    };
    writeFileSync('plans/e2e-analytics-result.json', JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.name + ': ' + e.message);
  process.exitCode = 1;
});
