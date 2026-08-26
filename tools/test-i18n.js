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

  const res = [];
  const ok = (n, pass, d) => res.push({ n, pass: !!pass, d });
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  /* Load the sample class before measuring anything about layout.
   *
   * The overflow checks below used to run on empty screens, which is a much
   * easier test than the real one: with no scans there are no handwriting
   * crops, no student rows and no uncertain marks to overflow. A crop running
   * off the side of a phone got all the way to a real Android before anyone
   * saw it. Populated screens are the ones that break. */
  await page.evaluate(async () => {
    const b = [...document.querySelectorAll('.demoline button')][0];
    if (!b) return;
    b.click();
    for (let i = 0; i < 120; i++) {
      await new Promise(r => setTimeout(r, 400));
      if (QG.App.State.scans.length >= 15) break;
    }
    await new Promise(r => setTimeout(r, 800));
    const t = document.getElementById('toasts');
    if (t) t.innerHTML = '';
  });
  const populated = await page.evaluate(() => QG.App.State.scans.length);
  ok('the layout checks run against a populated app', populated >= 15,
    populated + ' scans loaded');

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
        /* A pack may add plural categories English does not have — Russian
         * needs .few and .many where English only distinguishes one/other.
         * That is a correct translation, not a stray key. */
        stray: keys.filter(k => I.packs.en[k] == null &&
          I.packs.en[k.replace(/[.](one|two|few|many|zero|other)$/, '.other')] == null),
        empty: keys.filter(k => typeof p[k] !== 'string' || !p[k].trim()),
        /* {name}, {size} and the rest must survive translation or the value
         * vanishes from the sentence. The one exception is {n} in a singular
         * form: "delete the sheet" is a better translation than "delete 1
         * sheet" in most languages, and the count is implied by the grammar. */
        badVars: enKeys.filter(k => {
          if (p[k] == null) return false;
          const singular = /[.](one|zero)$/.test(k);
          const strip = s => (String(s).match(/\{\w+\}/g) || [])
            .filter(v => !(singular && v === '{n}')).sort().join(',');
          return strip(I.packs.en[k]) !== strip(p[k]);
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

    /* Every view, on a desktop and on a phone. Translated text is routinely
     * a third longer than the English it replaces, and the place it breaks
     * is a narrow screen on a view nobody thought to look at. */
    const VIEWS = ['tests', 'roster', 'review', 'written', 'export'];
    const raw = new Set(), over = new Set();
    let dir, langAttr, h1, scrollX = 0;

    for (const [w, h] of [[1280, 900], [420, 820]]) {
      await page.setViewportSize({ width: w, height: h });
      const r = await page.evaluate(async (a) => {
        const [c, views] = a;
        function inScroller(el) {
          for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth) return true;
          }
          return false;
        }
        QG.I18N.set(c);
        await new Promise(r => setTimeout(r, 200));
        const rawKeys = [], overflowing = [];
        let maxScroll = 0;
        for (const v of views) {
          QG.App.route(v);
          await new Promise(r => setTimeout(r, 160));
          /* Anything the walker failed to reach shows as a dotted key. */
          document.querySelectorAll('#view-' + v + ' *, #topbar *').forEach(el => {
            if (el.offsetParent === null) return;
            [...el.childNodes].filter(n => n.nodeType === 3).forEach(n => {
              const t = n.textContent.trim();
              if (/^[a-z]+(\.[a-zA-Z0-9]+){1,}$/.test(t)) rawKeys.push(t);
            });
            /* Longer words must wrap, not push the page sideways. Content
             * inside a container that scrolls horizontally on purpose — the
             * nav strip, a wide table — is doing what it was told to. */
            const b = el.getBoundingClientRect();
            if (b.width > 0 && (b.right > window.innerWidth + 2 || b.left < -2) &&
                !inScroller(el)) {
              overflowing.push(v + ':' + (el.className || el.tagName).toString().slice(0, 20));
            }
          });
          maxScroll = Math.max(maxScroll,
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
        }
        QG.App.route('tests');
        await new Promise(r => setTimeout(r, 160));
        const d = document.documentElement;
        return { dir: d.getAttribute('dir'), lang: d.getAttribute('lang'),
                 raw: rawKeys, over: overflowing, scrollX: maxScroll,
                 h1: document.querySelector('#view-tests h1').textContent };
      }, [code, VIEWS]);
      r.raw.forEach(x => raw.add(x));
      r.over.forEach(x => over.add(x));
      scrollX = Math.max(scrollX, r.scrollX);
      dir = r.dir; langAttr = r.lang; h1 = r.h1;
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    const wantDir = await page.evaluate(c => QG.I18N.meta(c).dir, code);
    ok('[' + code + '] sets lang and dir on the document',
      langAttr === code && dir === wantDir, langAttr + ' / ' + dir);
    ok('[' + code + '] leaves no untranslated key on screen', raw.size === 0,
      [...raw].slice(0, 5).join(', ') || 'none');
    ok('[' + code + '] fits every view on desktop and phone',
      over.size === 0 && scrollX <= 0,
      [...over].slice(0, 4).join(', ') || ('scrollX ' + scrollX));
    if (code !== 'en') {
      ok('[' + code + '] actually changed the visible text', h1 !== english, h1);
    }
  }

  // ------------------------------- the parsers speak the language too
  /* A teacher pastes a key in their own notation. Korean papers are marked
   * O and X; Thai writes points as คะแนน. If the parser only knows English,
   * the written maximum silently falls back to the default and the test is
   * marked out of the wrong number — wrong, and it looks right. */
  const parse = await page.evaluate(async () => {
    const out = {};
    const set = async c => { QG.I18N.set(c); await new Promise(r => setTimeout(r, 120)); };

    await set('ko');
    const koKey = QG.Parse.parseAnswerKey('1. O\n2. X\n3. O\n4. X');
    out.koTF = { n: koKey.filled, mode: koKey.mode, max: koKey.maxChoice };
    out.koPts = QG.Parse.parseWritten('삼투 현상을 설명하시오 (7점)', 5)[0];

    await set('th');
    out.thPts = QG.Parse.parseWritten('อธิบายออสโมซิส (8 คะแนน)', 5)[0];
    const thKey = QG.Parse.parseAnswerKey('1. ถูก\n2. ผิด\n3. ถูก');
    out.thTF = { n: thKey.filled, mode: thKey.mode };

    await set('ru');
    out.ruPts = QG.Parse.parseWritten('Объясните осмос - 6 баллов', 5)[0];

    /* English must still parse an English key while another language is set, */
    out.enInKo = QG.Parse.parseWritten('Explain osmosis (4 points)', 5)[0];

    /* and English on its own must not start reading O as true. */
    await set('en');
    out.enO = QG.Parse.parseAnswerKey('1. O\n2. X\n3. O').mode;
    out.enPts = QG.Parse.parseWritten('Explain osmosis (9 points)', 5)[0];
    return out;
  });

  ok('[ko] reads an O/X key as true/false',
    parse.koTF.mode === 'true/false' && parse.koTF.n === 4 && parse.koTF.max === 2,
    parse.koTF.mode + ', ' + parse.koTF.n + ' answers');
  ok('[ko] reads points written as 점', parse.koPts && parse.koPts.max === 7,
    parse.koPts ? parse.koPts.max : 'no match');
  ok('[th] reads points written as คะแนน', parse.thPts && parse.thPts.max === 8,
    parse.thPts ? parse.thPts.max : 'no match');
  ok('[th] reads a ถูก/ผิด key as true/false',
    parse.thTF.mode === 'true/false' && parse.thTF.n === 3, parse.thTF.mode);
  ok('[ru] reads points written as баллов', parse.ruPts && parse.ruPts.max === 6,
    parse.ruPts ? parse.ruPts.max : 'no match');
  ok('an English key still parses while another language is active',
    parse.enInKo && parse.enInKo.max === 4, parse.enInKo ? parse.enInKo.max : 'no match');
  ok('English alone does not treat O as true', parse.enO !== 'true/false', parse.enO);
  ok('English points still parse', parse.enPts && parse.enPts.max === 9,
    parse.enPts ? parse.enPts.max : 'no match');

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
