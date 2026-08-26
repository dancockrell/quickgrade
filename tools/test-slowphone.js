/* How it behaves on a phone that is not new.
 *
 *   node tools/test-slowphone.js [throttle...]
 *
 * Emulates a mid-range Android viewport with touch and a mobile user agent,
 * then slows the CPU through the debugger protocol and measures the work a
 * teacher actually waits for.
 *
 * On throttling: 1x is this desktop. A budget Android phone is roughly 5x to
 * 15x slower than a desktop for single-threaded JavaScript, so 6x is a fair
 * stand-in for a cheap current phone and 12x for an old one. This is a proxy,
 * not a phone. It measures compute honestly and says nothing about slow
 * storage, a weak GPU, or thermal throttling.
 *
 * Budgets are what a teacher would tolerate standing in front of a class,
 * not what is technically impressive.
 */
const { chromium, devices } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

const RATES = process.argv.slice(2).map(Number).filter(Boolean);
const THROTTLES = RATES.length ? RATES : [1, 6, 12];

/* seconds a teacher will put up with, at the slowest rate tested */
const BUDGET = {
  'cold load to usable':      6000,
  'read one sheet':            900,
  'open a scanned test':      4000,
  'draw the review screen':   4000,
  'rescore the whole class':  1500,
  'open written marking':     3000,
  'mark one answer':           600,
  'build the gradebook file': 6000,
};

(async () => {
  const browser = await chromium.launch();
  const results = [];

  for (const rate of THROTTLES) {
    const ctx = await browser.newContext({
      ...devices['Pixel 5'],
      /* a real teacher's phone is not in dark mode at 3am */
      colorScheme: 'light',
    });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));

    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });

    const t = {};
    let t0 = Date.now();
    await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.QG && QG.App && QG.App.State, null, { timeout: 120000 });
    await page.waitForTimeout(300);
    t['cold load to usable'] = Date.now() - t0;

    const decoded = await page.evaluate(async () => {
      const b = [...document.querySelectorAll('.demoline button')][0];
      if (!b) return 0;
      b.click();
      for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 250));
        if (QG.App.State.scans.length >= 15) break;
      }
      return QG.App.State.scans.length;
    });
    await page.waitForTimeout(400);

    /* Time the decode by itself.
     *
     * Dividing the sample-class build by fifteen would be wrong: that build
     * also renders each sheet and fakes a camera photo of it, work a teacher
     * never does. What matters is one pass of the real pipeline over one
     * frame, because that is what has to keep up with a camera. */
    const frame = await page.evaluate(async () => {
      const t = QG.App.State.test;
      const sheet = QG.Synth.renderSynthetic(t, 0, { sid: '3', name: 'Chloe Diaz', answers: {} });
      const photo = QG.Synth.simulateCamera(sheet, {
        w: 980, h: 1110, noise: 9, vignette: 0.3,
        corners: [[150, 96], [880, 88], [905, 1010], [128, 1022]]
      });

      const V = QG.Vision, S = QG.Sheet;
      S.usePaper(t);
      const pageDesc = QG.App.State.pages[0];

      /* the two canvases the scanner keeps, at the sizes it uses */
      const capW = Math.min(980, photo.width), capH = Math.round(photo.height * capW / photo.width);
      const cap = document.createElement('canvas'); cap.width = capW; cap.height = capH;
      cap.getContext('2d').drawImage(photo, 0, 0, capW, capH);
      const detW = Math.min(620, capW), detH = Math.round(capH * detW / capW);
      const det = document.createElement('canvas'); det.width = detW; det.height = detH;
      det.getContext('2d').drawImage(cap, 0, 0, detW, detH);

      const detImg = det.getContext('2d').getImageData(0, 0, detW, detH);
      const capImg = cap.getContext('2d').getImageData(0, 0, capW, capH);

      function once() {
        const gray = V.toGray(detImg);
        const found = V.findSheet(gray.g, detW, detH);
        if (!found) return null;
        const H = V.scaleH(found.H, capW / detW);
        const capGray = V.toGray(capImg);
        const white = V.whiteLevel(capGray.g, capW, capH, H);
        const ident = V.decodeIdentity(capGray.g, capW, capH, H, white, S.idDigitsOf(t));
        const ans = V.decodeAnswers(capGray.g, capW, capH, H, white, pageDesc);
        return { sid: ident.sid, page: ident.page, n: (ans.answers || []).length };
      }

      const warm = once();
      if (!warm) return { ms: Infinity, ok: false };

      const N = 6;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) once();
      const ms = (performance.now() - t0) / N;
      return { ms: Math.round(ms), ok: true, sid: warm.sid, page: warm.page };
    });
    t['read one sheet'] = frame.ok ? frame.ms : Infinity;

    t['open a scanned test'] = await page.evaluate(async () => {
      const t0 = performance.now();
      await QG.App.selectTest(QG.App.State.test);
      return Math.round(performance.now() - t0);
    });

    t['draw the review screen'] = await page.evaluate(async () => {
      const t0 = performance.now();
      QG.App.route('review');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    });

    t['rescore the whole class'] = await page.evaluate(() => {
      const t0 = performance.now();
      QG.App.recompute();
      return Math.round(performance.now() - t0);
    });

    t['open written marking'] = await page.evaluate(async () => {
      const t0 = performance.now();
      QG.App.route('written');
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    });

    /* One keystroke of marking: the thing done hundreds of times in a row. */
    t['mark one answer'] = await page.evaluate(async () => {
      const btn = document.querySelector('#pointsRow .pbtn');
      if (!btn) return 0;
      const t0 = performance.now();
      btn.click();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return Math.round(performance.now() - t0);
    });

    t['build the gradebook file'] = await page.evaluate(async () => {
      QG.App.route('export');
      await new Promise(r => setTimeout(r, 250));
      const real = QG.downloadBlob;
      let bytes = 0;
      QG.downloadBlob = b => { bytes = b.size || 0; };
      const t0 = performance.now();
      document.getElementById('exXlsx').click();
      const ms = Math.round(performance.now() - t0);
      QG.downloadBlob = real;
      return ms;
    });

    const mem = await page.evaluate(() =>
      performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);

    results.push({ rate, t, mem, decoded, frame, errs });
    await ctx.close();
  }

  // ---------------------------------------------------------------- report
  const names = Object.keys(BUDGET);
  const slowest = Math.max(...THROTTLES);

  console.log('QuickGrade on a slower phone\n');
  console.log('  Pixel 5 viewport, touch, mobile user agent.');
  console.log('  CPU throttled through the debugger protocol. 1x is this desktop;');
  console.log('  6x is about a cheap current Android, 12x an old one.\n');

  /* Each measurement is reported as its own check, so the shared runner
   * counts them instead of seeing a suite that asserted nothing. */
  const head = '       ' + 'what a teacher waits for'.padEnd(26) +
    THROTTLES.map(r => (r + 'x').padStart(9)).join('') + '     budget';
  console.log(head);
  console.log('       ' + '-'.repeat(head.length - 7));

  let over = 0;
  for (const n of names) {
    const cells = THROTTLES.map(r => {
      const v = results.find(x => x.rate === r).t[n];
      return (v === Infinity ? 'n/a' : String(v)).padStart(9);
    }).join('');
    const worst = results.find(x => x.rate === slowest).t[n];
    const bad = worst > BUDGET[n];
    if (bad) over++;
    console.log('  ' + (bad ? 'FAIL ' : 'ok   ') + n.padEnd(26) + cells + '  ' +
      String(BUDGET[n]).padStart(7) + (bad ? '  OVER' : ''));
  }

  console.log('\n  all times in milliseconds. budget is measured against ' + slowest + 'x.');
  for (const r of results) {
    console.log('  ' + (r.rate + 'x').padEnd(5) + 'decoded ' + r.decoded + '/15 sheets' +
      (r.frame && r.frame.ok ? ', frame read id ' + r.frame.sid + ' page ' + r.frame.page : '') +
      (r.mem ? ', heap ' + r.mem + ' MB' : '') +
      (r.errs.length ? ', ERRORS: ' + r.errs.slice(0, 2).join(' | ') : ''));
  }

  /* Fast and wrong is not a pass. */
  for (const r of results) {
    const readOk = r.frame && r.frame.ok && r.frame.sid === '003' && r.frame.page === 1;
    console.log('  ' + (readOk ? 'ok   ' : 'FAIL ') +
      ('the reader is still correct at ' + r.rate + 'x').padEnd(26) +
      (readOk ? '  id ' + r.frame.sid + ', page ' + r.frame.page : '  MISREAD'));
    const allIn = r.decoded === 15;
    console.log('  ' + (allIn ? 'ok   ' : 'FAIL ') +
      ('all 15 sheets read at ' + r.rate + 'x').padEnd(26) + '  ' + r.decoded + '/15');
  }

  const anyErr = results.some(r => r.errs.length) ||
                 results.some(r => r.decoded !== 15) ||
                 results.some(r => !(r.frame && r.frame.ok && r.frame.sid === '003'));
  console.log('\n  ' + (over || anyErr
    ? (over + ' measurement(s) over budget' + (anyErr ? ' and something errored' : ''))
    : 'every measurement within budget at ' + slowest + 'x'));

  await browser.close();
  process.exit(over || anyErr ? 1 : 0);
})();
