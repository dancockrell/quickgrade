/* Covers the teacher/admin-facing additions: PWA installability, offline
 * service worker, CSV roster import from a messy gradebook export, the
 * printing check, and the accessibility affordances. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

  const res = {};
  const ok = (n, c, d) => { res[n] = { pass: !!c, detail: d }; };

  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  // ---------- PWA ----------
  const mf = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    if (!link) return { err: 'no manifest link' };
    const r = await fetch(link.href);
    if (!r.ok) return { err: 'manifest ' + r.status };
    const j = await r.json();
    const icons = [];
    for (const i of j.icons || []) {
      const ir = await fetch(new URL(i.src, link.href));
      icons.push({ src: i.src, ok: ir.ok, type: ir.headers.get('content-type') });
    }
    return { j, icons };
  });
  ok('manifest loads and parses', !mf.err, mf.err || 'ok');
  if (!mf.err) {
    const j = mf.j;
    ok('manifest has installability fields',
      !!(j.name && j.short_name && j.start_url && j.display === 'standalone' && j.icons.length >= 2),
      j.display + ', ' + j.icons.length + ' icons');
    ok('every declared icon actually exists', mf.icons.every(i => i.ok),
      mf.icons.map(i => i.src.split('/').pop() + (i.ok ? '' : ' MISSING')).join(', '));
    ok('a maskable icon is provided',
      (j.icons || []).some(i => (i.purpose || '').includes('maskable')));
  }

  const sw = await page.evaluate(async () => {
    const r = await fetch('sw.js');
    if (!r.ok) return { err: 'sw.js ' + r.status };
    const reg = await navigator.serviceWorker.getRegistration();
    return { text: (await r.text()).length, registered: !!reg,
             state: reg && (reg.active ? 'active' : reg.installing ? 'installing' : 'waiting') };
  });
  ok('service worker is served', !sw.err, sw.err || sw.text + ' bytes');
  ok('service worker registers', sw.registered, 'state: ' + sw.state);

  // ---------- offline ----------
  await page.waitForTimeout(1800);          // let the shell finish caching
  await ctx.setOffline(true);
  const offline = await page.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' })
    .then(r => ({ status: r && r.status() })).catch(e => ({ err: e.message.slice(0, 60) }));
  const offlineWorks = await page.evaluate(() => !!(window.QG && QG.App && QG.Sheet)).catch(() => false);
  ok('app still loads with the network cut off', offlineWorks,
    offline.err ? offline.err : 'served from cache, app booted');
  await ctx.setOffline(false);
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  // ---------- messy CSV roster import ----------
  const csv = await page.evaluate(async () => {
    // a realistic gradebook export: header, quoted "Last, First", extra columns
    const text = [
      'Student ID,Student Name,Grade Level,Homeroom',
      '"100","Nguyen, Avery",9,"A-12"',
      '"101","Carter, Ben",9,"A-12"',
      '"102","O\'Brien, Chloe",9,"B-03"',
      '"103","Diaz, Diego",9,"B-03"'
    ].join('\n');
    const file = new File([text], 'roster.csv', { type: 'text/csv' });
    QG.App.route('roster');
    await new Promise(r => setTimeout(r, 250));
    const sel = document.getElementById('rosterClass');
    sel.value = 'CsvClass';                      // it is a combobox now: typing is enough
    sel.dispatchEvent(new Event('input', { bubbles: true }));
    const input = document.getElementById('rosterFile');
    const dt = new DataTransfer(); dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 600));
    return document.getElementById('rosterPaste').value;
  });
  const lines = csv.split('\n').filter(Boolean);
  ok('CSV import finds every student', lines.length === 4, lines.length + ' rows');
  ok('CSV import flips "Last, First" round', /^Avery Nguyen, 100$/.test(lines[0] || ''),
    JSON.stringify(lines[0] || ''));
  ok('CSV import keeps apostrophes and ids',
    (lines[2] || '').indexOf("O'Brien") > 0 && /102$/.test(lines[2] || ''),
    JSON.stringify(lines[2] || ''));

  // ---------- printing check ----------
  const cali = await page.evaluate(async () => {
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const S = QG.Sheet, V = QG.Vision, Sy = QG.Synth;
    const T = { id: 'cal', title: 'Cal', className: 'CsvClass', date: '2026-08-23', code: '456',
      mc: { count: 10, choices: 5, key: [0,1,2,3,4,0,1,2,3,4], points: 1, text: [], topic: [] },
      written: [], options: { prefillId: false, idDigits: 3, wPerPage: 2, instructions: '',
        scale: [[0,'F']], footer: '', topsheet: {} }, createdAt: 5 };
    await QG.DB.put('tests', T);
    await QG.App.selectTest(T);
    const pages = S.layoutTest(T);
    // a BLANK printed sheet: nothing bubbled by a student
    const sheet = Sy.renderSynthetic(T, 0, { sid: '', name: '', answers: {} });
    const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
      corners: [[190,120],[1090,120],[1090,1330],[190,1330]], noise: 8, vignette: 0.15 });
    const detW = 480, detH = Math.round(photo.height * detW / photo.width);
    const dc = document.createElement('canvas'); dc.width = detW; dc.height = detH;
    dc.getContext('2d').drawImage(photo, 0, 0, detW, detH);
    const g = V.toGray(dc.getContext('2d').getImageData(0, 0, detW, detH));
    const found = V.findSheet(g.g, detW, detH);
    if (!found) return { err: 'not found' };
    const H = V.scaleH(found.H, photo.width / detW);
    const cap = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height);
    const cg = V.toGray(cap);
    const white = V.whiteLevel(cg.g, photo.width, photo.height, H);
    const ident = V.decodeIdentity(cg.g, photo.width, photo.height, H, white, 3);
    const ans = V.decodeAnswers(cg.g, photo.width, photo.height, H, white, pages[0]);
    let marked = 0;
    pages[0].mc.forEach(it => { if (ans.states[it.q] !== 'blank') marked++; });
    return { code: ident.code, page: ident.page, marked, total: pages[0].mc.length };
  });
  ok('printing check reads the pre-printed test code', cali.code === '456', 'read ' + cali.code);
  ok('printing check reads the page number', cali.page === 1, 'page ' + cali.page);
  ok('printing check sees a blank sheet as blank', cali.marked === 0,
    cali.marked + ' of ' + cali.total + ' bubbles read as filled');

  // ---------- accessibility ----------
  const a11y = await page.evaluate(() => {
    const live = document.getElementById('srAnnounce');
    const unlabelled = [...document.querySelectorAll('select,input:not([type=checkbox]):not([type=hidden])')]
      .filter(n => n.offsetParent !== null)
      .filter(n => !n.getAttribute('aria-label') && !n.closest('label') &&
                   !n.labels?.length && !n.placeholder && !n.title)
      .map(n => n.id || n.tagName);
    const imgsNoAlt = [...document.querySelectorAll('img')].filter(i => i.alt == null || i.alt === '').length;
    return {
      liveRegion: !!live && live.getAttribute('aria-live') === 'assertive',
      liveHidden: !!live && getComputedStyle(live).position === 'absolute',
      unlabelled, imgsNoAlt,
      lang: document.documentElement.lang,
      themeColor: !!document.querySelector('meta[name=theme-color]')
    };
  });
  ok('scan results are announced to screen readers', a11y.liveRegion && a11y.liveHidden,
    'aria-live assertive, visually hidden');
  ok('no visible form control is unlabelled', a11y.unlabelled.length === 0,
    a11y.unlabelled.join(', ') || 'all labelled');
  ok('page declares a language', a11y.lang === 'en', a11y.lang);

  for (const [k, v] of Object.entries(res)) {
    console.log((v.pass ? 'PASS  ' : 'FAIL  ') + k + (v.detail ? '  — ' + v.detail : ''));
  }
  const bad = Object.values(res).filter(v => !v.pass).length;
  console.log('\n' + (bad ? bad + ' FAILED' : 'all ' + Object.keys(res).length + ' passed'));
  if (errs.length) console.log('page errors:', errs.slice(0, 5));
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
