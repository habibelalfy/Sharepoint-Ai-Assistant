const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    if (process.env.TEST_LOCAL_PAGE === '1') await page.route('http://localhost:3001/', route => route.fulfill({contentType:'text/html',body:require('node:fs').readFileSync('public/index.html','utf8')}));
    let accept = true;
    await page.route('**/api/setup', route => route.fulfill({status: accept ? 200 : 401, contentType:'application/json', body:JSON.stringify(accept ? {accessToken:'test-only',userId:'test'} : {error:'Test rejection'})}));
    await page.goto('http://localhost:3001/');
    const values = {sharePointUrl:'http://example.test/PWA',username:'TEST\\user',password:'test-password',llmUrl:'https://example.test/v1',llmKey:'test-key',modelName:'test-model'};
    for(const [name,value] of Object.entries(values)) await page.locator(`[name="${name}"]`).fill(value);
    await page.locator('#connect').click();
    await page.locator('#chat-view').waitFor({state:'visible'});
    await page.locator('#change-connection').click();
    for(const [name,value] of Object.entries(values)) assert.equal(await page.locator(`[name="${name}"]`).inputValue(),value);
    await page.reload();
    for(const [name,value] of Object.entries(values)) assert.equal(await page.locator(`[name="${name}"]`).inputValue(),value);
    for(const name of ['password','llmKey']) assert.equal(await page.locator(`[name="${name}"]`).getAttribute('type'),'password');
    accept = false;
    await page.locator('[name="modelName"]').fill('failed-model');
    await page.locator('#connect').click();
    await page.getByText('Test rejection',{exact:true}).waitFor();
    await page.reload();
    assert.equal(await page.locator('[name="modelName"]').inputValue(),'test-model');
    await page.evaluate(()=>localStorage.setItem('unrelated','keep'));
    await page.locator('#forget-details').click();
    for(const name of Object.keys(values)) assert.equal(await page.locator(`[name="${name}"]`).inputValue(),'');
    assert.equal(await page.evaluate(()=>localStorage.getItem('sharepoint-ai.connection.v1')),null);
    assert.equal(await page.evaluate(()=>localStorage.getItem('unrelated')),'keep');
    await page.reload();
    for(const name of ['username','password','llmKey','sharePointUrl','llmUrl']) assert.equal(await page.locator(`[name="${name}"]`).inputValue(),'');
    console.log('PASS: six fields restored on reload and Change connection; secrets masked; failed connection preserves saved values; Forget removes only assistant details. Synthetic credentials only.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e.message);process.exitCode=1});
