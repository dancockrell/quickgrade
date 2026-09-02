/* How it behaves on a phone that is not new.
 *
 *   node tools/test-slowphone.js [throttle...]
 *
 * Emulates a mid-range Android viewport with touch and a mobile user agent,
 * then slows the CPU through the debugger protocol and measures the work a
 * teacher actually waits for. QG3 correctness means the QR page/document
 * identity survives throttling; student identity is intentionally absent from
 * the photocopied paper.
 */
const { chromium, devices } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

const RATES = process.argv.slice(2).map(Number).filter(Boolean);
const THROTTLES = RATES.length ? RATES : [1, 6, 12];
const SAMPLE_RATE = Math.max(...THROTTLES);
const RUN_RATES = [SAMPLE_RATE].concat(THROTTLES.filter(r => r !== SAMPLE_RATE));

const BUDGET = {
  'cold load to usable':      6000,
  /* QG3 validates both its QR and the natural paper boundary, including a
   * full-resolution retry when the first phone-sized pass is marginal. The
   * 12x check takes about 12 seconds on a shared Actions runner, so 15 seconds
   * remains a regression limit without encoding workstation-only speed. */
  'read one sheet':          15000,
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
  let sampleFixture = null;

  for (const rate of RUN_RATES) {
    const ctx = await browser.newContext({
      ...devices['Pixel 5'],
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

    /* Import the complete 15-sheet fixture at the worst throttle. Repeating
     * the same batch at faster rates adds minutes without covering a harder
     * completion case. Its resulting test, students, scans and image blobs are
     * copied into the faster isolated contexts so their UI timings still use
     * the same realistic data rather than an empty test. */
    if (rate === SAMPLE_RATE) {
      sampleFixture = await page.evaluate(async () => {
        const b = [...document.querySelectorAll('.demoline button')][0];
        if (!b) return null;
        b.click();
        for (let i = 0; i < 600; i++) {
          await new Promise(r => setTimeout(r, 250));
          if (!b.disabled) break;
        }
        return {
          test: QG.App.State.test,
          students: await QG.DB.all('students'),
          scans: await QG.DB.all('scans'),
          blobs: await QG.DB.all('blobs')
        };
      });
    } else {
      await page.evaluate(async f => {
        await QG.DB.put('tests', f.test);
        await QG.DB.putMany('students', f.students);
        await QG.DB.putMany('scans', f.scans);
        await QG.DB.putMany('blobs', f.blobs);
        QG.App.State.tests.unshift(f.test);
        QG.App.State.students = f.students;
        await QG.App.selectTest(f.test);
      }, sampleFixture);
    }
    const decoded = sampleFixture ? sampleFixture.scans.length : 0;
    await page.waitForTimeout(400);

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
      const capW = Math.min(980, photo.width), capH = Math.round(photo.height * capW / photo.width);
      const cap = document.createElement('canvas'); cap.width = capW; cap.height = capH;
      cap.getContext('2d').drawImage(photo, 0, 0, capW, capH);
      const detW = Math.min(620, capW), detH = Math.round(capH * detW / capW);
      const det = document.createElement('canvas'); det.width = detW; det.height = detH;
      det.getContext('2d').drawImage(cap, 0, 0, detW, detH);

      const detImg = det.getContext('2d').getImageData(0, 0, detW, detH);
      const capImg = cap.getContext('2d').getImageData(0, 0, capW, capH);

      function once() {
        let gray = V.toGray(detImg);
        let found = V.findSheet(gray.g, detW, detH);
        let scale = capW / detW;
        if (!found && capW > detW) {
          gray = V.toGray(capImg);
          found = V.findSheet(gray.g, capW, capH);
          scale = 1;
        }
        if (!found) return null;
        const H = V.scaleH(found.H, scale);
        const capGray = V.toGray(capImg);
        const white = V.whiteLevel(capGray.g, capW, capH, H);
        const ident = V.decodeIdentity(capGray.g, capW, capH, H, white, S.idDigitsOf(t));
        const ans = V.decodeAnswers(capGray.g, capW, capH, H, white, pageDesc);
        return { sid: ident.sid, code: ident.code, page: ident.page,
                 qr: !!(ident.qrPacket && ident.qrPacket.geometry === 3),
                 n: Object.keys(ans.answers || {}).length };
      }

      const warm = once();
      if (!warm) return { ms: Infinity, ok: false };

      const N = 3;
      const t0 = performance.now();
      for (let i = 0; i < N; i++) once();
      const ms = (performance.now() - t0) / N;
      return { ms: Math.round(ms), ok: true, sid: warm.sid, code: warm.code,
               page: warm.page, qr: warm.qr, n: warm.n };
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

    const fold = await page.evaluate(async () => {
      QG.App.route('written');
      await new Promise(r => setTimeout(r, 600));
      const bar = document.getElementById('gradeBar');
      if (!bar) return null;
      const vis = [...bar.children].filter(c => c.offsetParent !== null);
      const last = vis.length ? vis[vis.length - 1].getBoundingClientRect().bottom : 0;
      return { over: Math.round(last - innerHeight), scrolls: bar.scrollHeight > bar.clientHeight + 1 };
    });

    const mem = await page.evaluate(() =>
      performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null);

    results.push({ rate, t, mem, decoded, frame, fold, errs });
    await ctx.close();
  }

  const names = Object.keys(BUDGET);
  const slowest = Math.max(...THROTTLES);

  console.log('QuickGrade on a slower phone\n');
  console.log('  Pixel 5 viewport, touch, mobile user agent.');
  console.log('  CPU throttled through the debugger protocol. 1x is this desktop;');
  console.log('  6x is about a cheap current Android, 12x an old one.\n');

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
    console.log('  ' + (r.rate + 'x').padEnd(5) +
      (r.decoded == null ? 'focused decode only' : 'decoded ' + r.decoded + '/15 sheets') +
      (r.frame && r.frame.ok ? ', QR ' + r.frame.code + ' page ' + r.frame.page : '') +
      (r.mem ? ', heap ' + r.mem + ' MB' : '') +
      (r.errs.length ? ', ERRORS: ' + r.errs.slice(0, 2).join(' | ') : ''));
  }

  const f = results[0].fold;
  if (f) {
    console.log('  ' + (f.over <= 2 && !f.scrolls ? 'ok   ' : 'FAIL ') +
      'no marking control below the fold'.padEnd(26) +
      (f.over <= 2 ? '  all visible' : '  ' + f.over + 'px below'));
  }

  for (const r of results) {
    const readOk = r.frame && r.frame.ok && r.frame.qr && r.frame.sid == null &&
                   r.frame.page === 1 && !!r.frame.code;
    console.log('  ' + (readOk ? 'ok   ' : 'FAIL ') +
      ('the reader is still correct at ' + r.rate + 'x').padEnd(26) +
      (readOk ? '  QR ' + r.frame.code + ', page ' + r.frame.page + ', no student ID' : '  MISREAD'));
    if (r.rate === SAMPLE_RATE) {
      const allIn = r.decoded === 15;
      console.log('  ' + (allIn ? 'ok   ' : 'FAIL ') +
        ('all 15 sheets read at ' + r.rate + 'x').padEnd(26) + '  ' + r.decoded + '/15');
    }
  }

  const anyErr = (f && (f.over > 2 || f.scrolls)) ||
                 results.some(r => r.errs.length) ||
                 results.some(r => r.rate === SAMPLE_RATE && r.decoded !== 15) ||
                 results.some(r => !(r.frame && r.frame.ok && r.frame.qr &&
                                      r.frame.sid == null && r.frame.page === 1));
  console.log('\n  ' + (over || anyErr
    ? (over + ' measurement(s) over budget' + (anyErr ? ' and something errored' : ''))
    : 'every measurement within budget at ' + slowest + 'x'));

  await browser.close();
  process.exit(over || anyErr ? 1 : 0);
})();
