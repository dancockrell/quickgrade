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

  const geom = await page.evaluate(() => {
    const S = QG.Sheet;
    /* Read the bracket back out of what it actually draws rather than
     * trusting a constant: two bars, arm width over mark size, and the
     * centroid is the point the caller asked for. */
    S.setPaper('a4');
    const bars = S.cornerBars(2, 3, false, false);
    const size = bars[0].w;
    const arm = bars[0].h / size;
    const t = arm, area = 2 * t - t * t;
    const cx = (0.5 * t + t * t * (1 - t) / 2) / area;
    return { size, arm, centroid: (2 - bars[0].x) / size };
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

  /* The corner marks are the one thing on the page that the whole system
   * depends on. The detector keeps a component only if it fills more than
   * 0.70 of its box, and a printed, blurred, photographed bracket measures
   * about 0.04 below its geometry. An arm that looks fine on screen and sits
   * a hundredth above the threshold loses a corner to noise and the sheet
   * becomes unfindable - which is how this was found. */
  let failed = 0, checks = 0;
  {
    const arm = geom.arm;
    const fill = 1 - (1 - arm) * (1 - arm);
    const margin = fill - 0.70;
    checks++;
    if (margin < 0.10) {
      failed++;
      console.log("  FAIL corner mark fill  — " + fill.toFixed(3) +
        " is only " + margin.toFixed(3) + " above the detector threshold");
    } else {
      console.log("  ok   corner mark fill  — " + fill.toFixed(3) +
        ", " + margin.toFixed(3) + " clear of the threshold");
    }
    const drift = Math.abs(geom.centroid - (function (t) {
      return (0.5 * t + t * t * (1 - t) / 2) / (2 * t - t * t);
    }(arm)));
    checks++;
    if (drift > 1e-6) {
      failed++;
      console.log("  FAIL corner mark centroid  — off by " + drift.toExponential(2) +
        ", which skews the whole page");
    } else {
      console.log("  ok   corner mark centroid  — matches the arm exactly");
    }
  }
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
