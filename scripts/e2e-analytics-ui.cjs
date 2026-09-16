const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    let fail = false;
    const projects = [{ id: 'p', title: 'Synthetic project — UI test', percentComplete: 30 }];
    const fixture = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      projects,
      tasks: [],
      history: [],
      predictions: [
        {
          projectId: 'p',
          title: projects[0].title,
          status: 'at_risk',
          predictedFinish: '2026-09-22T00:00:00Z',
          delayDays: 6,
          observations: 3,
          explanation: 'Synthetic test: trend forecast',
        },
      ],
    };
    await page.route('**/api/setup', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ userId: 'synthetic-test', accessToken: 'test-token' }),
      }),
    );
    await page.route('**/api/analytics/dataset', (r) =>
      r.fulfill({
        status: fail ? 502 : 200,
        contentType: 'application/json',
        body: JSON.stringify(fail ? { error: 'Synthetic refresh failure' } : fixture),
      }),
    );
    await page.route('**/api/analytics/config', (r) =>
      r.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ configured: false, embedUrl: null }),
      }),
    );
    await page.goto('http://localhost:3001/');
    for (const [name, value] of Object.entries({
      sharePointUrl: 'http://example.test/PWA',
      username: 'TEST\\user',
      password: 'synthetic',
      llmUrl: 'https://example.test/v1',
      llmKey: 'synthetic',
      modelName: 'synthetic',
    }))
      await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('#connect').click();
    await page.locator('#show-reports').click();
    await page.waitForFunction(() => !document.getElementById('download-dataset').disabled);
    assert.equal(await page.locator('#report-rows tr').count(), 1);
    assert.ok((await page.locator('#reports-summary').innerText()).includes('1 warnings'));
    assert.ok((await page.locator('#report-rows').innerText()).includes('at risk'));
    assert.ok((await page.locator('#powerbi-status').innerText()).includes('No Report Server'));
    const event = page.waitForEvent('download');
    await page.locator('#download-dataset').click();
    const d = await event;
    assert.equal(
      JSON.parse(require('node:fs').readFileSync(await d.path(), 'utf8')).schemaVersion,
      1,
    );
    await page.screenshot({ path: 'plans/analytics-ui-synthetic.png', fullPage: true });
    fail = true;
    await page.locator('#refresh-reports').click();
    await page.getByText('Synthetic refresh failure', { exact: true }).waitFor();
    assert.equal(await page.locator('#report-rows tr').count(), 0);
    assert.ok(await page.locator('#download-dataset').isDisabled());
    await page.locator('#change-connection').click();
    assert.ok(await page.locator('#reports-panel').isHidden());
    const result = {
      passed: true,
      synthetic: true,
      checks: [
        'report rendering',
        'warning display',
        'Power BI dataset download',
        'missing Report Server state',
        'failed refresh clears stale dataset',
        'change connection hides reports',
      ],
    };
    writeFileSync(
      'plans/analytics-ui-synthetic-result.json',
      JSON.stringify(result, null, 2) + '\n',
    );
    console.log(JSON.stringify(result));
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
