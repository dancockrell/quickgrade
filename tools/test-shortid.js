/* The bulk-copy workflow: ONE blank master sheet, photocopied, with each
 * student bubbling a short class number. Verifies every ID width round-trips
 * through the real print -> photograph -> decode path. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const out = await page.evaluate(async () => {
    const res = [];
    const S = QG.Sheet, V = QG.Vision;
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;

    function mkTest(idDigits) {
      const T = { id: 'w' + idDigits, title: 'Width ' + idDigits, className: 'C', date: '2026-08-23',
        code: '314', mc: { count: 12, choices: 5, key: [], points: 1, text: [], topic: [] },
        written: [], options: { prefillId: false, idDigits, wPerPage: 2, instructions: '',
          scale: [[0, 'F']], footer: '', topsheet: {} }, createdAt: 1 };
      for (let i = 0; i < 12; i++) T.mc.key[i] = i % 5;
      return T;
    }

    for (const nId of S.ID_DIGIT_CHOICES) {
      const T = mkTest(nId);
      const pages = S.layoutTest(T);
      // a plausible id for this width, plus the reserved answer-key id
      const sid = String(7).padStart(nId, '0');
      const ids = [sid, S.keySid(nId)];
      for (const useId of ids) {
        const ans = {};
        for (let q = 0; q < T.mc.count; q++) ans[q] = T.mc.key[q];
        const sheet = Sy.renderSynthetic(T, 0, { sid: useId, name: 'Test Student', answers: ans });
        const photo = Sy.simulateCamera(sheet, { w: 1280, h: 1450,
          corners: [[250, 190], [1060, 118], [1128, 1290], [176, 1218]], noise: 14, vignette: 0.4 });

        const detW = 480, detH = Math.round(photo.height * detW / photo.width);
        const dc = document.createElement('canvas'); dc.width = detW; dc.height = detH;
        dc.getContext('2d').drawImage(photo, 0, 0, detW, detH);
        const g = V.toGray(dc.getContext('2d').getImageData(0, 0, detW, detH));
        const found = V.findSheet(g.g, detW, detH);
        if (!found) { res.push({ nId, useId, ok: false, why: 'sheet not found' }); continue; }
        const H = V.scaleH(found.H, photo.width / detW);
        const cap = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height);
        const cg = V.toGray(cap);
        const white = V.whiteLevel(cg.g, photo.width, photo.height, H);
        const ident = V.decodeIdentity(cg.g, photo.width, photo.height, H, white, nId);
        const ansRead = V.decodeAnswers(cg.g, photo.width, photo.height, H, white, pages[0]);
        let wrong = 0;
        pages[0].mc.forEach(it => { if (ansRead.answers[it.q] !== T.mc.key[it.q]) wrong++; });

        res.push({
          nId, useId,
          ok: S.normId(ident.sid) === S.normId(useId) && ident.code === '314' &&
              ident.page === 1 && wrong === 0,
          read: ident.sid, code: ident.code, page: ident.page, wrongAnswers: wrong,
          isKey: S.isKeySid(ident.sid, nId)
        });
      }
    }

    // canonical-id equivalence
    res.push({ nId: '-', useId: 'normId', ok:
      S.normId('007') === '7' && S.normId('000007') === '7' &&
      S.normId('100041') === '100041' && S.normId('') === '' && S.normId('000') === '',
      read: 'leading zeros ignored' });
    return res;
  });

  let bad = 0;
  for (const r of out) {
    const label = r.nId === '-' ? r.useId
      : `${r.nId}-digit id "${r.useId}"` + (r.isKey ? ' (answer key)' : '');
    if (!r.ok) bad++;
    console.log((r.ok ? 'PASS  ' : 'FAIL  ') + label +
      '  — read ' + r.read + (r.code ? ', code ' + r.code + ', page ' + r.page : '') +
      (r.wrongAnswers != null ? ', ' + r.wrongAnswers + ' wrong answers' : '') +
      (r.why ? ' [' + r.why + ']' : ''));
  }
  console.log('\n' + (bad ? bad + ' FAILED' : 'all ' + out.length + ' passed'));
  if (errs.length) console.log('page errors:', errs.slice(0, 4));
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
