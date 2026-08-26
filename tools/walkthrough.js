/* Walk the whole teacher journey and photograph every step, at desktop and
 * phone width. This is not a pass/fail suite — it exists so a human can look
 * at what a teacher actually sees, in order, and judge it.
 *
 *   node tools/walkthrough.js <outDir> [lang] [width]
 */
const { chromium } = require('playwright');
const path = require('path');

const OUT = process.argv[2];
const LANG = process.argv[3] || 'en';
const W = parseInt(process.argv[4] || '1280', 10);
const H = W < 700 ? 860 : 900;
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

const shots = [];
let step = 0;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  async function shot(name) {
    /* Clear any toast first: a message that happens to be on screen is not
     * part of the design, and it hides whatever it lands on. */
    await page.evaluate(() => {
      const t = document.getElementById('toasts');
      if (t) t.innerHTML = '';
    });
    await page.waitForTimeout(120);
    step++;
    const file = path.join(OUT, `${W}-${LANG}-${String(step).padStart(2, '0')}-${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    console.log('  ' + String(step).padStart(2) + '. ' + name);
  }

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  if (LANG !== 'en') {
    await page.evaluate(async l => { QG.I18N.set(l); await new Promise(r => setTimeout(r, 300)); }, LANG);
  }

  // 1. cold open — the very first thing a teacher sees
  await shot('first-run');

  // 2. fill the three questions the way a real teacher would
  await page.evaluate(() => {
    const ins = [...document.querySelectorAll('.firstrun input, .firstrun textarea')];
    const set = (el, v) => {
      const proto = el.tagName === 'TEXTAREA'
        ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(ins[0], 'Unit 4 — Cell Biology');
    set(ins[1], 'Biology P3');
    set(ins[2], '1. B\n2. C\n3. A\n4. D\n5. B\n6. E\n7. A\n8. C\n9. D\n10. B');
  });
  await page.waitForTimeout(400);
  await shot('first-run-filled');

  // 3. the sample class — the "see it work" path
  await page.evaluate(async () => {
    const b = [...document.querySelectorAll('.demoline button')][0];
    if (b) b.click();
    for (let i = 0; i < 90; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (QG.App.State.scans.length >= 15) break;
    }
    await new Promise(r => setTimeout(r, 800));
  });
  await shot('review-after-sample');

  // 4. every main view in the order they are used
  for (const v of ['tests', 'roster', 'scan', 'review', 'written', 'export']) {
    await page.evaluate(async n => { QG.App.route(n); await new Promise(r => setTimeout(r, 500)); }, v);
    await shot(v);
  }

  // 5. the test editor, opened on a real test
  await page.evaluate(async () => {
    QG.App.route('tests');
    await new Promise(r => setTimeout(r, 300));
    const card = document.querySelector('#testList .card');
    if (card) { const b = card.querySelector('button'); if (b) b.click(); }
    await new Promise(r => setTimeout(r, 500));
  });
  await shot('test-editor');

  // 6. the dialogs a teacher meets
  const dialogs = [
    ['paste-key',   () => document.getElementById('btnKeyPaste')],
    ['privacy',     () => document.getElementById('btnPrivacy')],
  ];
  for (const [name, get] of dialogs) {
    await page.evaluate(async g => {
      const el = eval('(' + g + ')')();
      if (el) el.click();
      await new Promise(r => setTimeout(r, 450));
    }, get.toString());
    await shot(name);
    await page.evaluate(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
    });
  }

  console.log('\n  page errors: ' + (errs.length ? errs.slice(0, 5).join(' | ') : 'none'));
  await browser.close();
})();
