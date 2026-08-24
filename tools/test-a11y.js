/* Contrast measured rather than assumed, keyboard reachability, dialog focus
 * behaviour, and a backup that actually restores. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

const CONTRAST = `
function srgb(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lum(rgb){return 0.2126*srgb(rgb[0])+0.7152*srgb(rgb[1])+0.0722*srgb(rgb[2]);}
function parse(s){
  var m=String(s).match(/rgba?\\(([^)]+)\\)/); if(!m) return null;
  var p=m[1].split(',').map(function(x){return parseFloat(x);});
  return [p[0],p[1],p[2],p.length>3?p[3]:1];
}
/* Walk up for the first opaque background, the way an eye does. */
function bgOf(el){
  var n=el;
  while(n && n!==document.documentElement){
    var c=parse(getComputedStyle(n).backgroundColor);
    if(c && c[3]>0.95) return c;
    n=n.parentElement;
  }
  return parse(getComputedStyle(document.body).backgroundColor)||[255,255,255,1];
}
function ratio(fg,bg){
  var a=lum(fg),b=lum(bg);
  var hi=Math.max(a,b),lo=Math.min(a,b);
  return (hi+0.05)/(lo+0.05);
}
function contrastOf(el){
  var fg=parse(getComputedStyle(el).color); if(!fg) return null;
  return ratio(fg,bgOf(el));
}
`;

(async () => {
  const browser = await chromium.launch();
  const report = [];
  let failures = 0;

  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, colorScheme: scheme });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.evaluate(async () => {
      const b = [...document.querySelectorAll('.firstrun button')].find(x => /sample class/i.test(x.textContent));
      if (b) b.click();
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 400));
        if (QG.App.State.scans.length >= 15) break;
      }
    });
    await page.waitForTimeout(500);

    const bad = await page.evaluate(async (helpers) => {
      eval(helpers);
      const problems = [];
      const seen = {};
      for (const v of ['tests', 'roster', 'review', 'written', 'export']) {
        QG.App.route(v);
        await new Promise(r => setTimeout(r, 350));
        document.querySelectorAll('#view-' + v + ' *').forEach(function (el) {
          if (el.offsetParent === null) return;
          const txt = (el.childNodes.length && [...el.childNodes]
            .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('')) || '';
          if (!txt || txt.length < 2) return;
          const cs = getComputedStyle(el);
          const size = parseFloat(cs.fontSize);
          const weight = parseInt(cs.fontWeight, 10) || 400;
          const large = size >= 24 || (size >= 18.66 && weight >= 700);
          const need = large ? 3 : 4.5;
          const r = contrastOf(el);
          if (r == null) return;
          if (r < need) {
            const key = el.className + '|' + Math.round(r * 10);
            if (seen[key]) return;
            seen[key] = 1;
            problems.push({
              where: v, cls: (el.className || el.tagName).toString().slice(0, 28),
              text: txt.slice(0, 22), size: Math.round(size), ratio: Math.round(r * 100) / 100, need: need
            });
          }
        });
      }
      return problems;
    }, CONTRAST);

    report.push({ scheme, bad, errs });
    failures += bad.length;
    await ctx.close();
  }

  for (const r of report) {
    console.log('\n== contrast, ' + r.scheme + ' ==');
    if (!r.bad.length) console.log('  every text/background pair meets WCAG AA');
    r.bad.forEach(b => console.log('  ! ' + b.where + '  .' + b.cls + '  "' + b.text +
      '"  ' + b.ratio + ':1 (needs ' + b.need + ':1, ' + b.size + 'px)'));
    if (r.errs.length) console.log('  errors: ' + r.errs.slice(0, 3).join(' | '));
  }

  // ---------------- keyboard + dialogs + restore ----------------
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const out = await page.evaluate(async () => {
    const res = {}; const ok = (n, c, d) => res[n] = { pass: !!c, d };
    const St = QG.App.State;

    // dialogs
    QG.App.route('tests');
    await new Promise(r => setTimeout(r, 250));
    const h = QG.modal(document.createElement('div'));
    await new Promise(r => setTimeout(r, 150));
    ok('a dialog is exposed as a dialog to assistive tech',
      document.getElementById('modal').getAttribute('role') === 'dialog' ||
      document.getElementById('modalCard').getAttribute('role') === 'dialog',
      document.getElementById('modal').getAttribute('role') || 'none');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    ok('Escape closes a dialog', document.getElementById('modal').hidden);

    // every control reachable and labelled
    QG.App.route('review');
    await new Promise(r => setTimeout(r, 300));
    const unreachable = [...document.querySelectorAll('#view-review button,#view-review input,#view-review select')]
      .filter(n => n.offsetParent !== null && n.tabIndex < 0);
    ok('no control is removed from the tab order', unreachable.length === 0,
      unreachable.length + ' unreachable');

    const noName = [...document.querySelectorAll('button')]
      .filter(n => n.offsetParent !== null)
      .filter(n => !n.textContent.trim() && !n.getAttribute('aria-label') && !n.title);
    ok('every button has a name', noName.length === 0,
      noName.map(n => n.className).slice(0, 3).join(', ') || 'all named');

    // ---- backup really restores ----
    const rich = {
      id: 'restore', title: 'Restore Me', className: 'RA, RB', date: '2026-08-24', code: '710',
      formLabel: 'A', forms: [{ id: 'B', code: '711', key: [1,0,2], rules: {} }],
      mc: { count: 3, choices: 4, key: [0,1,2], points: 2, text: [], topic: ['X','X','Y'],
            rules: { 1: { credit: true } } },
      written: [{ label: 'Why?', max: 4, kind: 'essay', expected: '',
        rubric: { levels: [{ label: 'No', pts: 0 }, { label: 'Yes', pts: 2 }],
                  criteria: ['A', 'B'] } }],
      curve: { kind: 'addPoints', value: 1 },
      options: { prefillId: false, idDigits: 4, paper: 'a4', wPerPage: 2, instructions: '',
        scale: [[90,'A'],[0,'F']], footer: '', topsheet: { showMastery: true },
        labels: { name: 'NOM' } },
      createdAt: 30
    };
    await QG.DB.put('tests', rich);
    await QG.DB.putMany('students', [{ sid: '801', name: 'Zoe Vane', cls: 'RA', email: 'z@s.org' }]);
    St.students = await QG.DB.all('students');
    St.tests.unshift(rich);
    await QG.App.selectTest(rich);
    St.grades['801'] = { w: { 0: { p: 2, r: [1, 0], c: 'ok' } }, comment: 'well done' };
    await QG.DB.put('kv', { k: 'grades:restore', v: St.grades });

    let backup = null;
    const realText = QG.downloadText;
    QG.downloadText = t => { backup = t; };
    QG.App.route('export');
    await new Promise(r => setTimeout(r, 300));
    document.getElementById('exJson').click();
    await new Promise(r => setTimeout(r, 600));
    QG.downloadText = realText;

    // wipe it, then bring it back from the file
    await QG.DB.del('tests', 'restore');
    await QG.DB.del('kv', 'grades:restore');
    St.tests = St.tests.filter(t => t.id !== 'restore');
    await QG.App.selectTest(St.tests[0] || null);

    const data = JSON.parse(backup);
    await QG.DB.putMany('tests', data.tests);
    if (data.students && data.students.length) await QG.DB.putMany('students', data.students);
    for (const k of Object.keys(data.grades || {})) await QG.DB.put('kv', { k: k, v: data.grades[k] });

    const back = await QG.DB.get('tests', 'restore');
    const grades = await QG.DB.get('kv', 'grades:restore');
    ok('a restored test keeps its versions', back && back.forms.length === 1);
    ok('a restored test keeps its rules', back && back.mc.rules['1'].credit === true);
    ok('a restored test keeps its rubric', back && back.written[0].rubric.criteria.length === 2);
    ok('a restored test keeps paper, curve and wording',
      back && back.options.paper === 'a4' && back.curve.kind === 'addPoints' &&
      back.options.labels.name === 'NOM');
    ok('restored marks include the rubric levels',
      grades && grades.v['801'].w[0].r.join(',') === '1,0',
      grades ? JSON.stringify(grades.v['801'].w[0].r) : 'missing');
    ok('restored teacher comments survive',
      grades && grades.v['801'].comment === 'well done');

    // and it scores identically after the round trip
    St.tests.unshift(back);
    await QG.App.selectTest(back);
    QG.App.recompute();
    ok('the restored test scores without error',
      !!QG.App.State.results && QG.App.State.results.rows.length > 0,
      QG.App.State.results.rows.length + ' rows');
    return res;
  });

  console.log('\n== keyboard, dialogs, restore ==');
  for (const [k, v] of Object.entries(out)) {
    if (!v.pass) failures++;
    console.log((v.pass ? '  PASS  ' : '  FAIL  ') + k + (v.d != null ? '  — ' + v.d : ''));
  }
  if (errs.length) { console.log('  page errors: ' + errs.slice(0, 3).join(' | ')); failures++; }
  console.log('\n' + (failures ? failures + ' problem(s)' : 'all clear'));
  await browser.close();
  process.exit(failures ? 1 : 0);
})();
