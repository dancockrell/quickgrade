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

  /* Measure the registration border off a rendered sheet.
   *
   * This used to read the corner brackets back out of cornerBars(). When the
   * page moved to a ruled border that function went away, the probe returned
   * undefined, and the guard reported "NaN, NaN clear of the threshold" and
   * PASSED - because NaN < 0.10 is false. A check whose input has vanished
   * should be the loudest thing in the run, not the quietest. */
  const geom = await page.evaluate(() => {
    const S = QG.Sheet;
    S.setPaper('a4');
    const t = { id: 't', title: 'Border probe', className: '', date: '', code: '117',
      mc: { count: 4, choices: 4, key: [], points: 1, text: [], options: [], topic: [], rules: {} },
      written: [], curve: { kind: 'none', value: 0 }, options: { paper: 'a4' } };
    const host = document.createElement('div');
    host.innerHTML = S.renderSheets(t, [{ sid: '07', name: '' }], {});
    document.body.appendChild(host);
    const pg = host.querySelector('.page');
    const edge = host.querySelector('.edge');
    if (!pg || !edge) { host.remove(); return { missing: true }; }
    const pr = pg.getBoundingClientRect(), er = edge.getBoundingClientRect();
    const cs = getComputedStyle(edge);
    const pxPerIn = pr.width / S.L.page.w;
    const g = {
      /* where the border sits, in inches, against the rectangle the scanner
       * solves the page from */
      offX: Math.abs((er.left - pr.left) / pxPerIn - S.L.fid.x0),
      offY: Math.abs((er.top - pr.top) / pxPerIn - S.L.fid.y0),
      widthIn: er.width / pxPerIn,
      expectWidthIn: S.L.W,
      ruleIn: parseFloat(cs.borderTopWidth) / pxPerIn,
      footIn: parseFloat(cs.borderBottomWidth) / pxPerIn
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

  /* The registration border is the one thing on the page the whole system
   * depends on, so it is measured off a rendered sheet rather than trusted.
   *
   * Three properties, each of which has actually broken:
   *   - it sits on the fiducial rectangle. Every other coordinate is relative
   *     to that, so an offset here skews the whole page.
   *   - the rule is thick enough to survive the downscale the detector works
   *     on. A hairline came out at six tenths of a pixel and vanished, taking
   *     the sheet with it.
   *   - the foot rule is heavier than the rest, because that difference is
   *     the only thing telling an upright page from an upside-down one.
   */
  let failed = 0, checks = 0;
  function guard(name, pass, detail) {
    checks++;
    if (pass) { console.log('  ok   ' + name + '  - ' + detail); }
    else { failed++; console.log('  FAIL ' + name + '  - ' + detail); }
  }
  if (geom.missing || geom.ruleIn === undefined || !isFinite(geom.ruleIn)) {
    /* Say so loudly. A probe that returns nothing used to leave NaN in the
     * comparison, and NaN < threshold is false, so the guard passed. */
    guard('border geometry could be measured', false,
          'the probe returned nothing to measure');
  } else {
    guard('border sits on the geometry the scanner solves from',
      geom.offX < 0.01 && geom.offY < 0.01 &&
      Math.abs(geom.widthIn - geom.expectWidthIn) < 0.01,
      'offset ' + (Math.max(geom.offX, geom.offY) * 1000).toFixed(1) + ' thou, width ' +
      geom.widthIn.toFixed(3) + 'in against ' + geom.expectWidthIn.toFixed(3) + 'in');

    /* At 480 across, a sheet filling the frame gives about 58 pixels to the
     * inch. Two pixels is the floor for a line that has to be found; 0.0347in
     * gives two. Anything under 0.030in is asking to disappear. */
    /* The floor is where evidence puts it, not where the current value
     * happens to land. A border at 0.69px is not found at all (a page held
     * far back, before the higher-resolution retry existed). At 1.81px every
     * suite passes. The boundary between those has not been measured, so the
     * floor sits at 1.5 and the border is drawn thick enough to clear it by
     * a wide margin rather than by a hundredth of a pixel, which is what the
     * first attempt at this check did. */
    const pxAtDetection = geom.ruleIn * 58;
    guard('border survives the detection downscale', pxAtDetection >= 1.5,
      geom.ruleIn.toFixed(4) + 'in is ' + pxAtDetection.toFixed(2) + 'px at 480 across');

    guard('the foot rule is heavier than the others', geom.footIn > geom.ruleIn * 1.6,
      geom.footIn.toFixed(4) + 'in against ' + geom.ruleIn.toFixed(4) + 'in');
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
