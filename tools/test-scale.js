/* A secondary teacher has ~150 students across five periods, three pages each:
 * 450 scanned sheets with images, in one browser.
 *
 * Decode throughput is measured on real photographs, then everything that
 * happens AFTER decoding — storage, scoring, rendering, exporting — is measured
 * against a full 450-sheet load, fabricated directly so the run finishes in
 * minutes rather than a quarter of an hour.
 */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';
const STUDENTS = +(process.env.QG_STUDENTS || 150);
const PAGES = +(process.env.QG_PAGES || 3);
const QUESTIONS = +(process.env.QG_QUESTIONS || 50);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const out = await page.evaluate(async ({ STUDENTS, PAGES, QUESTIONS }) => {
    const res = []; const rec = (n, v, limit, unit) => res.push({ n, v, limit, unit });
    const ms = f => { const t = performance.now(); const r = f(); return [performance.now() - t, r]; };
    const msA = async f => { const t = performance.now(); const r = await f(); return [performance.now() - t, r]; };

    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const S = QG.Sheet, V = QG.Vision, Sy = QG.Synth;

    // ---------------- 1. decode throughput, on real photographs -------------
    const T = {
      id: 'scale', title: 'Final Exam', className: 'P1, P2, P3, P4, P5',
      date: '2026-08-23', code: '999',
      mc: { count: QUESTIONS, choices: 5, key: [], points: 1, text: [], topic: [], rules: {} },
      written: [{ label: 'Explain your reasoning.', max: 10, kind: 'essay', expected: '' }],
      curve: { kind: 'none', value: 0 },
      options: { prefillId: false, idDigits: 3, paper: 'letter', wPerPage: 2, instructions: '',
        scale: [[90,'A'],[80,'B'],[70,'C'],[60,'D'],[0,'F']], footer: '', topsheet: {} },
      createdAt: 1
    };
    for (let i = 0; i < QUESTIONS; i++) T.mc.key[i] = i % 5;
    const pages = S.layoutTest(T);

    const SAMPLE = 6;
    let decodeTotal = 0;
    for (let i = 0; i < SAMPLE; i++) {
      const ans = {};
      for (let q = 0; q < QUESTIONS; q++) ans[q] = (q + i) % 5;
      const sheet = Sy.renderSynthetic(T, 0, { sid: String(i + 1), name: 'S ' + i, answers: ans });
      const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450, noise: 12, vignette: .4,
        corners: [[250,190],[1060,118],[1128,1290],[176,1218]] });
      const t0 = performance.now();
      const detW = 480, detH = Math.round(photo.height * detW / photo.width);
      const dc = document.createElement('canvas'); dc.width = detW; dc.height = detH;
      dc.getContext('2d').drawImage(photo, 0, 0, detW, detH);
      const g = V.toGray(dc.getContext('2d').getImageData(0, 0, detW, detH));
      const found = V.findSheet(g.g, detW, detH);
      if (found) {
        const H = V.scaleH(found.H, photo.width / detW);
        const cap = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height);
        const cg = V.toGray(cap);
        const white = V.whiteLevel(cg.g, photo.width, photo.height, H);
        V.decodeIdentity(cg.g, photo.width, photo.height, H, white, 3);
        V.decodeAnswers(cg.g, photo.width, photo.height, H, white, pages[0]);
      }
      decodeTotal += performance.now() - t0;
    }
    const perSheet = decodeTotal / SAMPLE;
    rec('decode one sheet (' + QUESTIONS + ' questions)', Math.round(perSheet), 400, 'ms');
    rec('camera frames per second this allows', Math.round(1000 / perSheet), null, 'fps');

    // ---------------- 2. fabricate a full year-group load -------------------
    // Realistic image payloads, so storage and deserialisation are measured
    // against something the size of the real thing.
    function jpeg(w, h) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      for (let i = 0; i < 400; i++) {
        x.strokeStyle = 'hsl(' + (i * 7 % 360) + ',40%,45%)';
        x.beginPath(); x.moveTo(Math.random() * w, Math.random() * h);
        x.lineTo(Math.random() * w, Math.random() * h); x.stroke();
      }
      return c.toDataURL('image/jpeg', 0.7);
    }
    const thumbData = jpeg(150, 200);
    const nameData = jpeg(760, 90);
    const writtenData = jpeg(1100, 420);
    const pageData = jpeg(850, 1100);

    const students = [], scans = [], blobs = [];
    for (let i = 0; i < STUDENTS; i++) {
      const sid = String(i + 1);
      students.push({ sid, name: 'Student ' + (i + 1), cls: 'P' + (i % 5 + 1),
                      email: 's' + (i + 1) + '@school.org' });
      for (let p = 1; p <= PAGES; p++) {
        const answers = {}, states = {};
        const from = (p - 1) * Math.ceil(QUESTIONS / PAGES);
        const to = Math.min(QUESTIONS, from + Math.ceil(QUESTIONS / PAGES));
        for (let q = from; q < to; q++) {
          answers[q] = (i + q) % 7 === 0 ? (T.mc.key[q] + 1) % 5 : T.mc.key[q];
          states[q] = 'ok';
        }
        const sc = { id: 'sc' + i + '_' + p, testId: 'scale', sid, page: p,
          answers, states, confs: {}, flags: [], checks: {}, overrides: {},
          ts: Date.now(), thumb: thumbData, written: {}, nameCrop: null,
          classCrop: null, pageImg: null };
        if (p === 1) {
          sc.nameCrop = 'b' + i + '_n'; sc.classCrop = 'b' + i + '_c';
          blobs.push({ id: sc.nameCrop, data: nameData }, { id: sc.classCrop, data: nameData });
        }
        if (p === PAGES) {
          sc.written[0] = 'b' + i + '_w'; sc.pageImg = 'b' + i + '_p';
          blobs.push({ id: sc.written[0], data: writtenData }, { id: sc.pageImg, data: pageData });
        }
        scans.push(sc);
      }
    }
    rec('sheets in this load', scans.length, null, 'sheets');
    rec('images stored', blobs.length, null, 'images');

    // ---------------- 3. writing it all down --------------------------------
    await QG.DB.put('tests', T);
    let [tStud] = await msA(() => QG.DB.putMany('students', students));
    let [tScan] = await msA(() => QG.DB.putMany('scans', scans));
    let [tBlob] = await msA(() => QG.DB.putMany('blobs', blobs));
    rec('write ' + scans.length + ' sheets to storage', Math.round(tScan), 8000, 'ms');
    rec('write ' + blobs.length + ' images to storage', Math.round(tBlob), 20000, 'ms');

    const est = navigator.storage && navigator.storage.estimate
      ? await navigator.storage.estimate() : null;
    if (est) {
      rec('storage used by this test', Math.round(est.usage / 1048576), null, 'MB');
      rec('storage the browser allows', Math.round(est.quota / 1048576), null, 'MB');
      rec('share of the quota used', Math.round(est.usage / est.quota * 100), 60, '%');
    }

    // ---------------- 4. opening the test ----------------------------------
    let [tOpen] = await msA(() => QG.App.selectTest(T));
    rec('open the test (loads every scan)', Math.round(tOpen), 4000, 'ms');
    rec('students resolved', QG.App.State.results.rows.length, null, 'rows');
    rec('sheets attached', QG.App.State.scans.length, null, 'sheets');

    // ---------------- 5. the things a teacher waits on ----------------------
    let [tRecompute] = ms(() => QG.App.recompute());
    rec('rescore the whole class', Math.round(tRecompute), 800, 'ms');

    let [tReview] = await msA(async () => {
      QG.App.route('review'); await new Promise(r => setTimeout(r, 0));
    });
    await new Promise(r => setTimeout(r, 400));
    rec('draw the review screen', Math.round(tReview), 3000, 'ms');
    rec('rows drawn', document.querySelectorAll('#reviewTable tbody tr').length, null, 'rows');
    rec('question rows drawn', document.querySelectorAll('#questionBox tbody tr').length, null, 'rows');

    // dropping a question rescores everyone — the interactive worst case
    let [tRule] = ms(() => {
      QG.App.State.test.mc.rules = { 3: { drop: true } };
      QG.App.recompute();
    });
    rec('drop a question and rescore everyone', Math.round(tRule), 800, 'ms');
    QG.App.State.test.mc.rules = {};
    QG.App.recompute();

    let [tGrade] = await msA(async () => {
      QG.App.route('written'); await new Promise(r => setTimeout(r, 0));
    });
    await new Promise(r => setTimeout(r, 500));
    rec('open written grading', Math.round(tGrade), 3000, 'ms');

    // ---------------- 6. exports -------------------------------------------
    const ctx = { test: QG.App.State.test, results: QG.App.State.results, byId: QG.App.State.byId };
    const fmt = QG.ExportMap.PRESETS.find(p => p.id === 'full');
    let [tRows, built] = ms(() => QG.ExportMap.buildRows(fmt, ctx, { onlyScanned: true }));
    rec('build the gradebook rows', Math.round(tRows), 1500, 'ms');
    let [tXlsx, xlsx] = ms(() => QG.OOXML.buildXlsx([{ name: 'Grades',
      rows: [built.head].concat(built.rows), freezeHeader: true, autoFilter: true }]));
    rec('build the Excel file', Math.round(tXlsx), 4000, 'ms');
    rec('Excel file size', Math.round(xlsx.size / 1024), null, 'KB');

    let [tDocx, docx] = ms(() => {
      const P = QG.OOXML;
      let body = '';
      ctx.results.rows.filter(r => r.scanned).forEach((x, i) => {
        if (i) body += P.pageBreak();
        body += P.p(x.name, { style: 'Heading1' });
        const rows = [[{ text: '#' }, { text: 'Yours' }, { text: 'Key' }, { text: 'Pts' }]];
        for (let q = 0; q < ctx.test.mc.count; q++) {
          rows.push([{ text: String(q + 1) }, { text: 'A' }, { text: 'B' }, { text: '1' }]);
        }
        body += P.table(rows, { header: true });
      });
      return P.buildDocx(body);
    });
    rec('build ' + ctx.results.scannedRows.length + ' graded top sheets', Math.round(tDocx), 25000, 'ms');
    rec('Word file size', Math.round(docx.size / 1048576 * 10) / 10, 40, 'MB');

    if (performance.memory) {
      rec('javascript heap in use', Math.round(performance.memory.usedJSHeapSize / 1048576), null, 'MB');
    }
    return res;
  }, { STUDENTS, PAGES, QUESTIONS });

  let bad = 0;
  const w = Math.max(...out.map(r => r.n.length));
  for (const r of out) {
    const val = r.v + (r.unit ? ' ' + r.unit : '');
    let verdict = '     ';
    if (r.limit != null) {
      const okv = r.v <= r.limit;
      if (!okv) bad++;
      verdict = okv ? 'ok   ' : 'SLOW ';
    }
    console.log(verdict + r.n.padEnd(w) + '  ' + String(val).padStart(12) +
      (r.limit != null ? '   (budget ' + r.limit + (r.unit ? ' ' + r.unit : '') + ')' : ''));
  }
  console.log('\n' + (bad ? bad + ' measurement(s) over budget' : 'every measurement within budget'));
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
