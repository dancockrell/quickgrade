/* Every supported paper size must print and scan correctly. New sheets use the
 * bottom-left QR for document identity and geometry; student identity is a
 * packet-level workflow concern, not a printed machine field. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  const out = await page.evaluate(async () => {
    const S = QG.Sheet, V = QG.Vision, L = S.L;
    await new Promise(r => { const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r; document.head.appendChild(s); });
    const Sy = QG.Synth;
    const res = [];
    const ok = (n, c, d) => res.push({ n, pass: !!c, d });

    /* The underlying answer-grid geometry remains fixed. The QR layer changes
     * how the page transform is established without moving the answer rows. */
    S.setPaper('letter');
    ok('Letter answer geometry unchanged',
      L.fid.x1 === 8.08 && L.fid.y1 === 10.58 &&
      Math.abs(L.W - 7.66) < 1e-9 && Math.abs(L.H - 10.16) < 1e-9 &&
      Math.abs(L.idX0 - 5.69) < 1e-9 && Math.abs(L.idLabelX - 5.05) < 1e-9 &&
      Math.abs(L.contentBottom - 10.15) < 1e-9 &&
      Math.abs(L.footerY - 10.30) < 1e-9 && Math.abs(L.wRight - 7.73) < 1e-9 &&
      Math.abs(L.nameBox.w - 4.23) < 1e-9,
      'fid ' + L.fid.x1 + '/' + L.fid.y1 + ', idX0 ' + L.idX0 + ', bottom ' + L.contentBottom.toFixed(2));

    function mk(paper, nMc) {
      const T = { id: 'p_' + paper, title: 'Paper ' + paper, className: 'C',
        date: '2026-08-23', code: '813',
        mc: { count: nMc, choices: 5, key: [], points: 1, text: [], topic: [] },
        written: [{ label: 'Explain.', max: 5, kind: 'essay', expected: '' }],
        options: { prefillId: false, idDigits: 3, paper, wPerPage: 2, instructions: '',
          scale: [[0, 'F']], footer: '', topsheet: {} }, createdAt: 1 };
      for (let i = 0; i < nMc; i++) T.mc.key[i] = i % 5;
      return T;
    }

    for (const paper of Object.keys(S.PAPERS)) {
      const T = mk(paper, 30);
      const pages = S.layoutTest(T);
      const dims = S.PAPERS[paper];

      const html = S.renderSheets(T, [{ sid: '007', name: 'Ana Ruiz', cls: 'C' }], { prefill: false });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const cssText = doc.querySelector('style').textContent;
      const m = cssText.match(/\.page\{[^}]*width:([\d.]+)in;height:([\d.]+)in/);
      const wIn = m ? parseFloat(m[1]) : NaN, hIn = m ? parseFloat(m[2]) : NaN;
      const pageRule = cssText.match(/@page\{size:([\d.]+)in ([\d.]+)in/);
      ok(paper + ': page is the right physical size',
        Math.abs(wIn - dims.w) < 0.01 && Math.abs(hIn - dims.h) < 0.01 &&
        pageRule && Math.abs(parseFloat(pageRule[1]) - dims.w) < 0.01 &&
        Math.abs(parseFloat(pageRule[2]) - dims.h) < 0.01,
        wIn + ' x ' + hIn + ' in, @page ' + (pageRule ? pageRule[1] + 'x' + pageRule[2] : 'missing'));

      const capW = 1280;
      const answers = {};
      for (let q = 0; q < T.mc.count; q++) answers[q] = T.mc.key[q];
      const sheet = Sy.renderSynthetic(T, 0, { sid: '007', name: 'Ana Ruiz', answers });
      const ar = dims.w / dims.h;
      const capH = Math.round(capW / ar * 1.12);
      const inset = 90;
      const photo = Sy.simulateCamera(sheet, {
        w: capW, h: capH, noise: 12, vignette: 0.42,
        corners: [[inset + 40, inset + 60], [capW - inset - 10, inset],
                  [capW - inset + 30, capH - inset], [inset, capH - inset - 50]]
      });

      const detW = 480, detH = Math.round(photo.height * detW / photo.width);
      const dc = document.createElement('canvas'); dc.width = detW; dc.height = detH;
      dc.getContext('2d').drawImage(photo, 0, 0, detW, detH);
      S.setPaper(paper);
      const g = V.toGray(dc.getContext('2d').getImageData(0, 0, detW, detH));
      const found = V.findSheet(g.g, detW, detH);
      if (!found) { ok(paper + ': sheet detected', false, 'not found'); continue; }
      ok(paper + ': sheet detected from QR', found.markers === 1 && found.qrPacket,
        'markers ' + found.markers + ', aspect ' + L.aspect.toFixed(4));

      const H = V.scaleH(found.H, photo.width / detW);
      const cap = photo.getContext('2d').getImageData(0, 0, photo.width, photo.height);
      const cg = V.toGray(cap);
      const white = V.whiteLevel(cg.g, photo.width, photo.height, H);
      const ident = V.decodeIdentity(cg.g, photo.width, photo.height, H, white, 3);
      const ans = V.decodeAnswers(cg.g, photo.width, photo.height, H, white, pages[0]);
      let wrong = 0;
      pages[0].mc.forEach(it => { if (ans.answers[it.q] !== T.mc.key[it.q]) wrong++; });

      ok(paper + ': QR document identity reads back',
        ident.sid == null && ident.code === '813' && ident.page === 1 &&
        ident.qrPacket && ident.qrPacket.geometry === 3,
        'id ' + ident.sid + ', code ' + ident.code + ', page ' + ident.page);
      ok(paper + ': student machine identity is deliberately absent', ident.sid == null,
        'sid ' + ident.sid);
      ok(paper + ': all ' + pages[0].mc.length + ' answers correct', wrong === 0, wrong + ' wrong');
    }

    S.setPaper('letter'); const perLetter = S.mcPerPage(5);
    S.setPaper('a4');     const perA4 = S.mcPerPage(5);
    S.setPaper('legal');  const perLegal = S.mcPerPage(5);
    ok('taller paper holds more questions', perLegal > perLetter && perA4 > 0,
      'letter ' + perLetter + ', a4 ' + perA4 + ', legal ' + perLegal);
    S.setPaper('letter');
    return res;
  });

  let bad = 0;
  for (const r of out) { if (!r.pass) bad++; console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.n + (r.d ? '  — ' + r.d : '')); }
  console.log('\n' + (bad ? bad + ' FAILED' : 'all ' + out.length + ' passed'));
  if (errs.length) console.log('page errors:', errs.slice(0, 4));
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
