/* Run the eyes over the sheets QuickGrade prints, so a layout defect fails a
 * build instead of waiting for somebody to notice it on paper.
 *
 * Every finding this catches was, at some point, shipped: rules too light to
 * photocopy, a label sitting on the bubbles above it, an option truncated
 * mid-word so the correct answer could not be read.
 */
const { chromium } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  /* A sheet of each shape the app can print. */
  const shapes = [
    { name: 'plain 40q sheet', opts: {}, count: 40, choices: 5, written: 0 },
    { name: 'sheet with writing boxes', opts: { wPerPage: 5 }, count: 20, choices: 4, written: 6 },
    { name: 'two-digit class number', opts: { idDigits: 2 }, count: 30, choices: 4, written: 0 },
    { name: 'questions printed on the sheet',
      opts: { questionsOnSheet: true, idDigits: 2 }, count: 12, choices: 4, written: 0, text: true }
  ];

  /* Measure the one remaining machine mark off a rendered QG3 sheet. */
  const geom = await page.evaluate(() => {
    const S = QG.Sheet, P = QG.QRPacket;
    S.setPaper('a4');
    const t = { id: 't', title: 'Border probe', className: '', date: '', code: '117',
      mc: { count: 4, choices: 4, key: [], points: 1, text: [], options: [], topic: [], rules: {} },
      written: [], curve: { kind: 'none', value: 0 }, options: { paper: 'a4' } };
    const host = document.createElement('div');
    host.innerHTML = S.renderSheets(t, [{ sid: '07', name: '' }], {});
    document.body.appendChild(host);
    const pg = host.querySelector('.page');
    const qr = host.querySelector('.qgqrbox');
    const oldEdge = host.querySelector('.edge');
    if (!pg || !qr) { host.remove(); return { missing: true }; }
    const pr = pg.getBoundingClientRect(), qrRect = qr.getBoundingClientRect();
    const pxPerIn = pr.width / S.L.page.w;
    const want = P.rect();
    const g = {
      offX: Math.abs((qrRect.left - pr.left) / pxPerIn - want.x),
      offY: Math.abs((qrRect.top - pr.top) / pxPerIn - want.y),
      sizeIn: qrRect.width / pxPerIn,
      expectSizeIn: want.size,
      oldEdge: !!oldEdge,
      count: host.querySelectorAll('.qgqrbox').length
    };
    host.remove();
    return g;
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-look-'));
  const files = [];
  for (const sh of shapes) {
    const html = await page.evaluate(function (sh) {
      const S = QG.Sheet;
      const t = {
        id: 't', title: 'Layout check', className: 'M1', date: '', code: '117',
        mc: { count: sh.count, choices: sh.choices, key: [], points: 1,
              text: sh.text ? Array.from({ length: sh.count }, (_, i) =>
                'Question ' + (i + 1) + ': which of these is the one you want?') : [],
              options: sh.text ? Array.from({ length: sh.count }, () =>
                ['a short one', 'a rather longer option than the first',
                 'one more possible answer here', 'the last of the four choices']) : [],
              topic: [], rules: {} },
        written: Array.from({ length: sh.written }, (_, i) =>
          ({ label: (i + 1) + '. Explain your answer in full', max: 4, kind: 'short' })),
        curve: { kind: 'none', value: 0 },
        options: Object.assign({ paper: 'a4' }, sh.opts)
      };
      S.setPaper('a4');
      return S.renderSheets(t, [{ sid: '07', name: '' }], {});
    }, sh);
    const f = path.join(dir, sh.name.replace(/[^a-z0-9]+/gi, '-') + '.html');
    fs.writeFileSync(f, html, 'utf8');
    files.push({ sh, f });
  }
  await browser.close();

  /* The app itself is a screen, not a photocopy master. Its audit must keep
   * geometry checks without flooding the report with paper-only warnings. */
  let screenOut = '';
  try {
    screenOut = execFileSync(process.execPath,
      [path.join(__dirname, 'look.js'), BASE + '/index.html', '--screen', '--json', '--quiet'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (e) { screenOut = e.stdout || ''; }
  let screenReport = null;
  try { screenReport = JSON.parse(screenOut); } catch (e) {}

  /* The QR is the authoritative printed anchor, so verify its physical box
   * and also prove the removed border has not returned. */
  let failed = 0, checks = 0;
  function guard(name, pass, detail) {
    checks++;
    if (pass) { console.log('  ok   ' + name + '  - ' + detail); }
    else { failed++; console.log('  FAIL ' + name + '  - ' + detail); }
  }
  if (geom.missing || geom.sizeIn === undefined || !isFinite(geom.sizeIn)) {
    guard('QR geometry could be measured', false,
          'the probe returned nothing to measure');
  } else {
    guard('QR sits at the authoritative bottom-left geometry',
      geom.offX < 0.01 && geom.offY < 0.01 &&
      Math.abs(geom.sizeIn - geom.expectSizeIn) < 0.01,
      'offset ' + (Math.max(geom.offX, geom.offY) * 1000).toFixed(1) + ' thou, size ' +
      geom.sizeIn.toFixed(3) + 'in against ' + geom.expectSizeIn.toFixed(3) + 'in');
    guard('sheet has one machine mark and no registration border',
      geom.count === 1 && !geom.oldEdge,
      geom.count + ' QR box, old border ' + (geom.oldEdge ? 'present' : 'absent'));
  }
  guard('screen mode omits photocopy-only findings',
    !!screenReport && !screenReport.findings.some(x => ['faint', 'tiny', 'blank'].includes(x.kind)),
    screenReport ? JSON.stringify(screenReport.counts) : 'could not read screen report');
  for (const { sh, f } of files) {
    let out = '';
    try {
      out = execFileSync(process.execPath, [path.join(__dirname, 'look.js'), f, '--json'],
        { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } catch (e) { out = e.stdout || ''; }
    let rep;
    try { rep = JSON.parse(out); } catch (e) {
      console.log('  FAIL ' + sh.name + '  — could not read the report');
      failed++; checks++; continue;
    }
    /* Only the serious kinds fail a build. Size warnings are advice. */
    const bad = rep.findings.filter(x => x.weight >= 3);
    checks++;
    if (bad.length) {
      failed++;
      console.log('  FAIL ' + sh.name + '  — ' + bad.length + ' defect(s)');
      bad.slice(0, 4).forEach(b => console.log('        ' + b.kind + ': ' + b.why + '  ' + b.label));
    } else {
      console.log('  ok   ' + sh.name + '  — clean');
    }
  }

  console.log('\n  ' + (failed ? failed + ' of ' + checks + ' layouts have defects'
                               : 'all ' + checks + ' sheet layouts are clean'));
  process.exit(failed ? 1 : 0);
})();
