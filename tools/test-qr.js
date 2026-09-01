/* The QG3 packet QR is now the single machine mark on new paper. It carries
 * document identity and page geometry; student ownership is deliberately not
 * encoded in the photocopied sheet. This suite sabotages the actual bottom-left
 * QR and proves failure is closed, not guessed. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  const out = await page.evaluate(async () => {
    const res = {}; const ok = (n, c, d) => res[n] = { pass: !!c, d };
    const St = QG.App.State, S = QG.Sheet, P = QG.QRPacket;

    const T = { id: 'qr', title: 'QR test', className: 'M1/1', date: '2026-08-27', code: '229',
      mc: { count: 10, choices: 4, key: Array.from({ length: 10 }, (_, i) => i % 4),
            points: 1, text: [], topic: [], rules: {} },
      written: [], curve: { kind: 'none', value: 0 },
      options: { prefillId: false, idDigits: 2, paper: 'letter', wPerPage: 2, instructions: '',
        scale: [[0, 'F']], footer: '', topsheet: {} }, createdAt: 6 };
    await QG.DB.put('tests', T);
    await QG.App.selectTest(T);
    await QG.DB.put('students', { sid: '55', name: 'Reads Fine', cls: 'M1/1' });
    await new Promise(r => {
      const s = document.createElement('script'); s.src = 'js/synth.js'; s.onload = r;
      document.head.appendChild(s);
    });
    const Sy = QG.Synth;
    const CAM = { w: 980, h: 1110, noise: 8, vignette: 0.2,
                  corners: [[150, 96], [880, 88], [905, 1010], [128, 1022]] };
    const pages = S.layoutTest(T);
    const answers = {}; pages[0].mc.forEach(it => { answers[it.q] = T.mc.key[it.q]; });

    /* ---- 1. baseline: intact QR gives code/page, not a student ---- */
    const good = Sy.renderSynthetic(T, 0, { sid: '55', name: 'Reads Fine', answers });
    const goodPhoto = Sy.simulateCamera(good, CAM);
    await QG.Scanner.importFiles([await Sy.canvasToFile(goodPhoto, 'good.jpg')], { quiet: true });
    QG.App.recompute();
    const goodScan = St.scans[St.scans.length - 1];
    ok('an intact packet QR reads test/page without inventing student ownership',
      !!goodScan && !!goodScan.code && goodScan.page === 1 && goodScan.packetUnassigned === true,
      goodScan ? 'sid=' + goodScan.sid + ' code=' + goodScan.code + ' page=' + goodScan.page : 'no scan');
    St.scans.length = 0;
    QG.PacketFlow.reset();

    /* ---- 2. blank the REAL QG3 bottom-left QR. ---- */
    const qb = P.rect();
    const blankSheet = Sy.renderSynthetic(T, 0, { sid: '55', name: 'Reads Fine', answers });
    const bctx = blankSheet.getContext('2d');
    const px = qb.x / S.L.page.w * blankSheet.width;
    const py = qb.y / S.L.page.h * blankSheet.height;
    const psize = qb.size / S.L.page.w * blankSheet.width;
    bctx.fillStyle = '#fff';
    bctx.fillRect(px - 6, py - 6, psize + 12, psize + 12);
    const blankPhoto = Sy.simulateCamera(blankSheet, CAM);
    const beforeBlank = St.scans.length;
    await QG.Scanner.importFiles([await Sy.canvasToFile(blankPhoto, 'blank.jpg')], { quiet: true });
    QG.App.recompute();
    ok('a blanked packet QR is rejected outright, not filed as an unknown page',
      St.scans.length === beforeBlank, 'before=' + beforeBlank + ' after=' + St.scans.length);

    /* ---- 3. replace the REAL QR with non-QR ink. ---- */
    const noiseSheet = Sy.renderSynthetic(T, 0, { sid: '55', name: 'Reads Fine', answers });
    const nctx = noiseSheet.getContext('2d');
    nctx.fillStyle = '#fff'; nctx.fillRect(px - 6, py - 6, psize + 12, psize + 12);
    nctx.fillStyle = '#000';
    var step = psize / 12;
    for (var gy = 0; gy < 12; gy++) for (var gx = 0; gx < 12; gx++) {
      if ((gx + gy) % 2 === 0) nctx.fillRect(px + gx * step, py + gy * step, step, step);
    }
    const noisePhoto = Sy.simulateCamera(noiseSheet, CAM);
    const beforeNoise = St.scans.length;
    await QG.Scanner.importFiles([await Sy.canvasToFile(noisePhoto, 'noise.jpg')], { quiet: true });
    QG.App.recompute();
    ok('a checkerboard at the packet-QR location is rejected, not parsed as a page',
      St.scans.length === beforeNoise, 'before=' + beforeNoise + ' after=' + St.scans.length);

    return res;
  });

  let failed = 0;
  for (const [name, r] of Object.entries(out)) {
    if (!r.pass) failed++;
    console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + name + (r.d ? '  — ' + r.d : ''));
  }
  if (errs.length) {
    console.log('\n  page errors:');
    errs.forEach(e => console.log('   ' + e));
    failed += errs.length;
  }
  console.log('\n' + (failed ? failed + ' problem(s)' : 'all clear'));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
