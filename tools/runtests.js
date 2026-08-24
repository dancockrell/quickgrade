/* Runs both self-test pages in a real browser and reports the results. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const out = {};
  for (const [name, url, flag] of [
    ['vision + exports', '/selftest.html', '__selftest'],
    ['storage fallback', '/selftest-storage.html', '__storagetest']
  ]) {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + url, { waitUntil: 'networkidle' });
    const res = await page.waitForFunction(f => window[f], flag, { timeout: 60000 })
      .then(h => h.jsonValue()).catch(e => ({ error: String(e).slice(0, 120) }));
    const lines = await page.$$eval('#out div', ns =>
      [...new Set(ns.map(n => n.innerText).filter(t => /^FAIL/.test(t)))]);
    out[name] = { ...res, failures: lines, pageErrors: errs };
    await page.close();
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
