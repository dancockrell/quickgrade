/* Language packs: completeness, no strays, no layout damage, and a clean
 * round trip back to English. A missing key here is a string that would show
 * up as a raw dotted identifier in front of a class. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';
const ROOT = path.join(__dirname, '..');
const SOURCES = ['app.js', 'scan.js', 'lib.js', 'scoring.js', 'mastery.js'];

/* Every T('key') the code calls must exist in the English pack. Without this
 * check a dropped pack entry ships as a raw dotted identifier on screen, and
 * only the one code path that uses it would ever reveal the problem. */
const KEY_CALL = /(?:^|[^A-Za-z0-9_$.])(?:QG\.T|T)\(\s*'([a-z][A-Za-z0-9.]*)'/g;
function keysUsedInSource() {
  const used = new Set();
  for (const f of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, 'js', f), 'utf8');
    for (const m of src.matchAll(KEY_CALL)) used.add(m[1]);
  }
  return [...used];
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const res = [];
  const ok = (n, pass, d) => res.push({ n, pass: !!pass, d });

  // ---------------------------------------------------- pack integrity
  const packs = await page.evaluate(() => {
    const I = QG.I18N;
    const out = {};
    const enKeys = Object.keys(I.packs.en);
    for (const code of Object.keys(I.packs)) {
      const p = I.packs[code];
      const keys = Object.keys(p);
      out[code] = {
        count: keys.length,
        /* A language with no plural distinction supplies only .other; that
         * is complete, not missing. */
        missing: enKeys.filter(k => p[k] == null &&
          p[k.replace(/[.](one|few|many|two|zero)$/, '.other')] == null),
        stray: keys.filter(k => I.packs.en[k] == null),
        empty: keys.filter(k => typeof p[k] !== 'string' || !p[k].trim()),
        /* {n} and friends must survive translation or the number vanishes. */
        badVars: enKeys.filter(k => {
          if (p[k] == null) return false;
          const want = (String(I.packs.en[k]).match(/\{\w+\}/g) || []).sort().join(',');
          const got = (String(p[k]).match(/\{\w+\}/g) || []).sort().join(',');
          return want !== got;
        }),
        /* A pack copied without being translated would match English on
         * nearly every line. */
        identical: enKeys.filter(k => p[k] === I.packs.en[k]).length
      };
    }
    return out;
  });

  const codes = Object.keys(packs);
  ok('more than one language is available', codes.length > 1, codes.join(', '));

  // -------------------------------------------- code vs English pack
  const enPack = await page.evaluate(() => Object.keys(QG.I18N.packs.en));
  const used = keysUsedInSource();
  /* Guard against the check passing because the scan found nothing: a broken
   * pattern would otherwise report success while testing zero keys. */
  ok('the source scan actually found T() calls', used.length > 100, used.length + ' found');
  const hasKey = k => enPack.includes(k) || enPack.includes(k + '.other');
  const orphaned = used.filter(k => !hasKey(k));
  ok('every key the code asks for exists in English', orphaned.length === 0,
    orphaned.slice(0, 8).join(', ') || used.length + ' keys used');

  // ------------------------------------------- switching, per language
  const english = await page.evaluate(() => document.querySelector('#view-tests h1').textContent);

  for (const code of codes) {
    const p = packs[code];
    ok('[' + code + '] has every English key', p.missing.length === 0,
      p.missing.length ? p.missing.slice(0, 6).join(', ') : p.count + ' keys');
    ok('[' + code + '] has no keys English does not', p.stray.length === 0,
      p.stray.slice(0, 6).join(', ') || 'none');
    ok('[' + code + '] has no empty values', p.empty.length === 0,
      p.empty.slice(0, 6).join(', ') || 'none');
    ok('[' + code + '] keeps every {placeholder}', p.badVars.length === 0,
      p.badVars.slice(0, 6).join(', ') || 'none');
    if (code !== 'en') {
      ok('[' + code + '] is actually translated', p.identical < p.count * 0.5,
        p.identical + ' of ' + p.count + ' identical to English');
    }

    const r = await page.evaluate(async (c) => {
      QG.I18N.set(c);
      await new Promise(r => setTimeout(r, 250));
      const d = document.documentElement;
      /* Anything the walker failed to reach shows as a dotted key. */
      const raw = [];
      document.querySelectorAll('#main *, #topbar *').forEach(el => {
        if (el.offsetParent === null) return;
        [...el.childNodes].filter(n => n.nodeType === 3).forEach(n => {
          const t = n.textContent.trim();
          if (/^[a-z]+(\.[a-zA-Z0-9]+){1,}$/.test(t)) raw.push(t);
        });
      });
      /* Nothing may push the page sideways. */
      const over = [];
      document.querySelectorAll('#view-tests *, #view-export *').forEach(el => {
        if (el.offsetParent === null) return;
        const b = el.getBoundingClientRect();
        if (b.width > 0 && (b.right > window.innerWidth + 2 || b.left < -2)) {
          over.push((el.className || el.tagName).toString().slice(0, 24));
        }
      });
      return { dir: d.getAttribute('dir'), lang: d.getAttribute('lang'),
               raw: [...new Set(raw)], over: [...new Set(over)],
               h1: document.querySelector('#view-tests h1').textContent,
               scrollX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    }, code);

    const wantDir = await page.evaluate(c => QG.I18N.meta(c).dir, code);
    ok('[' + code + '] sets lang and dir on the document',
      r.lang === code && r.dir === wantDir, r.lang + ' / ' + r.dir);
    ok('[' + code + '] leaves no untranslated key on screen', r.raw.length === 0,
      r.raw.slice(0, 5).join(', ') || 'none');
    ok('[' + code + '] does not overflow the viewport', r.over.length === 0 && r.scrollX <= 0,
      r.over.slice(0, 4).join(', ') || ('scrollX ' + r.scrollX));
    if (code !== 'en') {
      ok('[' + code + '] actually changed the visible text', r.h1 !== english, r.h1);
    }
  }

  // ------------------------------------------------------- round trip
  const back = await page.evaluate(async () => {
    QG.I18N.set('en');
    await new Promise(r => setTimeout(r, 250));
    return { h1: document.querySelector('#view-tests h1').textContent,
             dir: document.documentElement.getAttribute('dir') };
  });
  ok('switching back to English restores it exactly',
    back.h1 === english && back.dir === 'ltr', back.h1 + ' / ' + back.dir);

  // ------------------------------------------------------------ report
  let failed = 0;
  for (const r of res) {
    if (!r.pass) failed++;
    console.log((r.pass ? '  PASS  ' : '  FAIL  ') + r.n + (r.d != null ? '  — ' + r.d : ''));
  }
  if (errs.length) { console.log('  page errors: ' + errs.slice(0, 3).join(' | ')); failed++; }
  console.log('\n' + (failed ? failed + ' problem(s)' : 'all clear'));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
