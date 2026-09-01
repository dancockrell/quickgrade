/* QuickGrade — scan.js
 * Camera capture loop, decode pipeline, accept/reject feedback, photo import.
 * Hooks into app.js for the current test, roster lookup and persistence.
 */
(function (global) {
'use strict';

var Q = global.QG, V = Q.Vision, S = Q.Sheet;
var $ = Q.$, el = Q.el, T = Q.T;

var DET_W = 480;         // detection resolution (fast)
var CAP_W = 1400;        // sampling / crop resolution (accurate)
var STABLE_FRAMES = 2;   // identical reads required before accepting
var RESCAN_MS = 2200;    // ignore an identical sheet for this long

var ctxForm = null;          // version resolved by the current frame

var Scanner = {
  hooks: {},             // { getTest, getPages, findStudent, saveScan, refresh }
  running: false,
  stream: null,
  track: null,
  video: null,
  cap: null, capCtx: null,
  det: null, detCtx: null,
  pending: null,
  recent: {},            // key -> timestamp
  sessionCount: 0,
  busy: false,
  lastQuad: null,
  rafId: 0,
  timer: 0
};

/* ------------------------------------------------------------- setup */
function ensureCanvases() {
  if (!Scanner.cap) {
    Scanner.cap = document.createElement('canvas');
    Scanner.capCtx = Scanner.cap.getContext('2d', { willReadFrequently: true });
    Scanner.det = document.createElement('canvas');
    Scanner.detCtx = Scanner.det.getContext('2d', { willReadFrequently: true });
  }
}

Scanner.listCameras = function () {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve([]);
  return navigator.mediaDevices.enumerateDevices().then(function (list) {
    return list.filter(function (d) { return d.kind === 'videoinput'; });
  });
};

Scanner.start = function (deviceId) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    Q.toast(T('scan.noCamera'), 'err', 8000);
    return Promise.reject(new Error('no getUserMedia'));
  }
  ensureCanvases();
  Scanner.stop();
  var constraints = {
    audio: false,
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
  };
  return navigator.mediaDevices.getUserMedia(constraints).then(function (stream) {
    Scanner.stream = stream;
    Scanner.track = stream.getVideoTracks()[0];
    var v = $('#cam');
    Scanner.video = v;
    v.srcObject = stream;
    v.play().catch(function () {});
    Scanner.running = true;
    Q.Prefs.set('camId', deviceId || '');
    setStatus(T('scan.looking'));
    var caps = Scanner.track.getCapabilities ? Scanner.track.getCapabilities() : {};
    $('#btnTorch').hidden = !(caps && caps.torch);
    loop();
    showIdle(false);
    return Scanner.listCameras().then(fillCameraSelect);
  }).catch(function (e) {
    Q.toast(T('scan.cameraError', { msg: e && e.message ? e.message : e }), 'err', 7000);
    setStatus(T('scan.cameraUnavailable'));
    throw e;
  });
};

/* The idle panel and the live picture are mutually exclusive; keeping that
 * in one place means they cannot both be visible or both be missing. */
function showIdle(on) {
  var n = $('#scanIdle');
  if (n) n.hidden = !on;
}
Scanner.showIdle = showIdle;

Scanner.stop = function () {
  Scanner.running = false;
  showIdle(true);
  if (Scanner.rafId) cancelAnimationFrame(Scanner.rafId), Scanner.rafId = 0;
  if (Scanner.timer) clearTimeout(Scanner.timer), Scanner.timer = 0;
  if (Scanner.stream) {
    Scanner.stream.getTracks().forEach(function (t) { t.stop(); });
    Scanner.stream = null; Scanner.track = null;
  }
  Scanner.pending = null;
  clearOverlay();
};

Scanner.toggleTorch = function () {
  if (!Scanner.track || !Scanner.track.applyConstraints) return;
  Scanner._torch = !Scanner._torch;
  Scanner.track.applyConstraints({ advanced: [{ torch: Scanner._torch }] })
    .catch(function () { Q.toast(T('scan.noTorch'), 'err'); });
};

function fillCameraSelect(devs) {
  var sel = $('#camSelect');
  if (!sel) return;
  var cur = Scanner.track && Scanner.track.getSettings ? Scanner.track.getSettings().deviceId : '';
  sel.innerHTML = '';
  devs.forEach(function (d, i) {
    sel.appendChild(el('option', { value: d.deviceId }, d.label || ('Camera ' + (i + 1))));
  });
  if (cur) sel.value = cur;
}

/* ----------------------------------------------------------- feedback */
function setStatus(t, kind) {
  var p = $('#pillStatus');
  if (!p) return;
  p.textContent = t;
  p.className = 'pill' + (kind ? ' ' + kind : '');
}

function scanQualityText(hint) {
  if (hint === 'showQr') return T('scan.quality.showQr');
  if (hint === 'closer') return T('scan.quality.closer');
  if (hint === 'wholePage') return T('scan.quality.wholePage');
  if (hint === 'straight') return T('scan.quality.straight');
  if (hint === 'steady') return T('scan.quality.steady');
  if (hint === 'flat') return T('scan.quality.flat');
  return null;
}
/* Which student file the next page will join.
 *
 * Pages after the first carry no class number, so they are filed by whichever
 * class number was read last. That rule is easy to follow and impossible to
 * see: without this pill the teacher learns where the pages went only after
 * they have gone. It reads the state rather than being told about it, so it
 * cannot drift out of step with what the router will actually do. */
function setOpen() {
  var p = $('#pillOpen');
  if (!p) return;
  var St = global.QG.App && global.QG.App.State;
  var sid = St && St.openSid;
  var stale = St && St.test && St.openFor !== St.test.id;
  if (!sid || stale) {
    p.textContent = T('scan.pill.openNone');
    p.className = 'pill';
    return;
  }
  var stu = St.byId && St.byId[sid];
  p.textContent = T('scan.pill.open', { name: (stu && stu.name) || sid });
  p.className = 'pill ok';
}
Scanner.setOpen = setOpen;
function flash(kind) {
  var f = $('#flash');
  if (!f) return;
  f.className = kind;
  setTimeout(function () { f.className = ''; }, 190);
}
function bigMessage(name, sub, ms) {
  var b = $('#bigResult');
  if (!b) return;
  $('#bigName').textContent = name;
  $('#bigSub').textContent = sub || '';
  b.classList.add('show');
  clearTimeout(bigMessage._t);
  bigMessage._t = setTimeout(function () { b.classList.remove('show'); }, ms || 1500);
}
function addThumb(dataUrl, label, bad) {
  var strip = $('#scanStrip');
  if (!strip) return;
  var t = el('div', { class: 'thumb' + (bad ? ' bad' : '') }, [
    el('img', { src: dataUrl, alt: label }),
    el('span', { class: 'tn', text: label })
  ]);
  strip.insertBefore(t, strip.firstChild);
  while (strip.children.length > 40) strip.removeChild(strip.lastChild);
}
function clearOverlay() {
  var c = $('#overlay');
  if (!c) return;
  var ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
}
function drawOverlay(quad, detW, ok) {
  var c = $('#overlay'), v = Scanner.video;
  if (!c || !v || !v.videoWidth) return;
  var rect = c.getBoundingClientRect();
  if (c.width !== Math.round(rect.width) || c.height !== Math.round(rect.height)) {
    c.width = Math.round(rect.width); c.height = Math.round(rect.height);
  }
  var ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  if (!quad) return;
  var vw = v.videoWidth, vh = v.videoHeight;
  var sc = Math.min(c.width / vw, c.height / vh);
  var ox = (c.width - vw * sc) / 2, oy = (c.height - vh * sc) / 2;
  var k = (vw / detW) * sc;
  ctx.lineWidth = 3;
  ctx.strokeStyle = ok ? 'rgba(34,192,122,.95)' : 'rgba(255,255,255,.7)';
  ctx.beginPath();
  quad.forEach(function (p, i) {
    var x = ox + p[0] * k, y = oy + p[1] * k;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath(); ctx.stroke();
}

/* --------------------------------------------------------- main loop */
function loop() {
  if (!Scanner.running) return;
  Scanner.rafId = requestAnimationFrame(function () {
    try { tick(); } catch (e) { console.error(e); }
    Scanner.timer = setTimeout(loop, Scanner.busy ? 220 : 55);
  });
}

function tick() {
  var v = Scanner.video;
  if (!v || !v.videoWidth || Scanner.busy) return;
  var test = Scanner.hooks.getTest && Scanner.hooks.getTest();
  if (!test) { setStatus(T('scan.pickTestStatus'), 'bad'); return; }
  S.usePaper(test);   // aspect check + identity grids depend on the paper

  var vw = v.videoWidth, vh = v.videoHeight;
  var capW = Math.min(CAP_W, vw), capH = Math.round(vh * capW / vw);
  if (Scanner.cap.width !== capW) { Scanner.cap.width = capW; Scanner.cap.height = capH; }
  Scanner.capCtx.drawImage(v, 0, 0, capW, capH);

  var detW = Math.min(DET_W, capW), detH = Math.round(capH * detW / capW);
  if (Scanner.det.width !== detW) { Scanner.det.width = detW; Scanner.det.height = detH; }
  Scanner.detCtx.drawImage(Scanner.cap, 0, 0, detW, detH);

  var detImg = Scanner.detCtx.getImageData(0, 0, detW, detH);
  var gray = V.toGray(detImg);
  var found = V.findSheet(gray.g, detW, detH);
  if (!found && capW > detW) {
    /* Look again with more of the picture.
     *
     * 480 across is plenty when the sheet fills the frame, and not nearly
     * enough when it does not. A page held far back can occupy a seventh of
     * the width, which puts the registration border below one pixel here and
     * it simply is not in the image to be found. Solid corner marks used to
     * survive that; a ruled line does not, and this is the price of taking
     * them off the page.
     *
     * The retry is on the miss rather than always, because every frame that
     * finds the sheet immediately should stay cheap: this runs at camera rate
     * on a phone. */
    var bigW = Math.min(capW, detW * 2), bigH = Math.round(capH * bigW / capW);
    Scanner.det.width = bigW; Scanner.det.height = bigH;
    Scanner.detCtx.drawImage(Scanner.cap, 0, 0, bigW, bigH);
    var gray2 = V.toGray(Scanner.detCtx.getImageData(0, 0, bigW, bigH));
    var found2 = V.findSheet(gray2.g, bigW, bigH);
    if (found2) { found = found2; detW = bigW; detH = bigH; gray = gray2; }
  }
  if (!found) {
    Scanner.pending = null;
    drawOverlay(null);
    var qrHint = Q.QRPacket && Q.QRPacket.getHint && Q.QRPacket.getHint();
    setStatus(scanQualityText(qrHint) || T('scan.looking'));
    return;
  }
  drawOverlay(found.quad, detW, true);

  /* Re-sample identity + answers at the higher capture resolution. */
  var Hcap = V.scaleH(found.H, capW / detW);
  var capImg = Scanner.capCtx.getImageData(0, 0, capW, capH);
  var capGray = V.toGray(capImg);
  var white = V.whiteLevel(capGray.g, capW, capH, Hcap);
  var ident = V.decodeIdentity(capGray.g, capW, capH, Hcap, white, S.idDigitsOf(test));

  if (ident.page == null) { setStatus(T('scan.pageUnclear')); Scanner.pending = null; return; }

  var pages = Scanner.hooks.getPages();
  if (ident.page > pages.length) { setStatus(T('scan.pageNotInTest', { n: ident.page }), 'bad'); return; }
  /* The printed code identifies which version of the test this is, so a
   * mixed pile of version A and version B sheets can be fed through in any
   * order without anyone choosing anything. */
  var form = Q.Scoring.formByCode(test, ident.code);
  if (!form) {
    setStatus(T('scan.wrongTest', { code: ident.code || '?' }), 'bad');
    Scanner.pending = null;
    return;
  }

  var pageDesc = pages[ident.page - 1];
  var ans = V.decodeAnswers(capGray.g, capW, capH, Hcap, white, pageDesc);

  if (Scanner.calibrating) {
    Scanner.calibrating = false;
    Scanner.busy = true;
    reportCalibration(test, ident, ans, pageDesc, found, detW, detH);
    setTimeout(function () { Scanner.busy = false; }, 800);
    return;
  }

  var key = (ident.sid || 'ANON') + '|' + ident.page + '|' + hashAnswers(ans.answers);
  ctxForm = form;
  var now = Date.now();
  if (Scanner.recent[key] && now - Scanner.recent[key] < RESCAN_MS) { setStatus(T('scan.readyNext'), 'ok'); return; }

  if (!Scanner.pending || Scanner.pending.key !== key) {
    Scanner.pending = { key: key, n: 1 };
    setStatus(T('scan.reading'));
    return;
  }
  Scanner.pending.n++;
  if (Scanner.pending.n < STABLE_FRAMES) { setStatus(T('scan.reading')); return; }

  Scanner.pending = null;
  Scanner.recent[key] = now;
  Scanner.busy = true;
  accept({
    test: test, pages: pages, pageDesc: pageDesc, ident: ident, ans: ans,
    form: form, capImg: capImg, H: Hcap, capW: capW, capH: capH
  }).catch(function (e) {
    console.error(e); Q.toast(T('scan.saveFailed', { msg: e.message }), 'err');
  }).then(function () { Scanner.busy = false; });
}

/**
 * Verifies the whole print -> photograph -> decode chain against a freshly
 * printed BLANK sheet, whose correct reading is known in advance: the test
 * code is pre-printed, the page number is pre-printed, and every answer
 * bubble must come back empty. If those three hold, the teacher's printer,
 * paper and lighting are good.
 */
function reportCalibration(test, ident, ans, pageDesc, found, detW, detH) {
  var expectCode = S.digits(test.code, 3).join('');
  var marked = [];
  pageDesc.mc.forEach(function (item) {
    if (ans.states[item.q] !== 'blank') marked.push(item.q + 1);
  });

  var q = found.quad;
  function d(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
  var top = d(q[0], q[1]), bot = d(q[3], q[2]);
  var lef = d(q[0], q[3]), rig = d(q[1], q[2]);
  var aspect = ((top + bot) / 2) / ((lef + rig) / 2);
  var aspectErr = Math.abs(aspect - S.L.aspect) / S.L.aspect;
  var fill = (top + bot) / 2 / detW;          // how much of the frame the sheet spans
  var skew = Math.abs(top - bot) / Math.max(top, bot);

  var rows = [];
  function add(ok, warn, label, detail) {
    rows.push({ ok: ok, warn: warn, label: label, detail: detail });
  }
  add(true, false, T('cal.found'), T('cal.found.d'));
  add(ident.code === expectCode, false, T('cal.code'),
    ident.code === expectCode ? T('cal.code.ok', { code: ident.code })
      : T('cal.code.bad', { got: ident.code || T('cal.nothing'), want: expectCode }));
  add(ident.page != null, false, T('cal.page'),
    ident.page != null ? T('cal.page.ok', { n: ident.page }) : T('cal.page.bad'));
  add(marked.length === 0, marked.length > 0 && marked.length <= 2, T('cal.bubbles'),
    marked.length === 0 ? T('cal.bubbles.ok', { n: pageDesc.mc.length })
      : T('cal.bubbles.bad', { n: marked.length, list: marked.slice(0, 6).join(', Q') }));
  add(aspectErr < 0.06, aspectErr < 0.12, T('cal.proportions'),
    aspectErr < 0.06 ? T('cal.proportions.ok', { pct: Math.round(aspectErr * 100) })
      : T('cal.proportions.bad', { pct: Math.round(aspectErr * 100) }));
  add(fill > 0.45, fill > 0.3, T('cal.fill'),
    T('cal.fill.d', { pct: Math.round(fill * 100) }));
  add(skew < 0.12, skew < 0.25, T('cal.square'),
    T('cal.square.d', { pct: Math.round(skew * 100) }));

  var bad = rows.filter(function (r) { return !r.ok && !r.warn; });
  var warn = rows.filter(function (r) { return !r.ok && r.warn; });

  if (!bad.length) { flash('ok'); Q.Audio2.done(); } else { flash('bad'); Q.Audio2.bad(); }
  setStatus(bad.length ? T('cal.statusBad') : T('cal.statusOk'),
    bad.length ? 'bad' : 'ok');

  var body = Q.el('div', {}, [
    Q.el('h3', { text: bad.length ? T('cal.h3.bad')
                    : warn.length ? T('cal.h3.warn') : T('cal.h3.ok') })
  ]);
  var list = Q.el('div', { class: 'calilist' });
  rows.forEach(function (r) {
    list.appendChild(Q.el('div', { class: 'calirow ' + (r.ok ? 'good' : r.warn ? 'warn' : 'bad') }, [
      Q.el('span', { class: 'cmark', text: r.ok ? '✓' : r.warn ? '!' : '✗' }),
      Q.el('div', {}, [Q.el('b', { text: r.label }), Q.el('span', { text: r.detail })])
    ]));
  });
  body.appendChild(list);

  var advice = [];
  if (ident.code !== expectCode) {
    advice.push(T('cal.advice.code'));
  }
  if (marked.length) {
    advice.push(T('cal.advice.dark'));
  }
  if (aspectErr >= 0.06) {
    advice.push(T('cal.advice.hold'));
  }
  if (!advice.length) {
    advice.push(T('cal.advice.allGood'));
  }
  advice.forEach(function (a) { body.appendChild(Q.el('p', { class: 'hint', text: a })); });
  body.appendChild(Q.el('div', { class: 'row gap end' }, [
    Q.el('button', { class: 'btn', text: T('cal.another'),
      onclick: function () { h.close(); Scanner.startCalibration(); } }),
    Q.el('button', { class: 'btn go', text: T('common.done'), onclick: function () { h.close(); } })
  ]));
  var h = Q.modal(body);
}

Scanner.startCalibration = function () {
  Scanner.calibrating = true;
  Scanner.pending = null;
  setStatus(T('cal.holdUp'));
  Q.toast(T('scan.calibHint'), 'good', 6000);
};

function hashAnswers(a) {
  var s = '';
  Object.keys(a).sort(function (x, y) { return x - y; }).forEach(function (k) { s += a[k] + ','; });
  return s;
}

/* ------------------------------------------------------------ accept */
function accept(ctx) {
  var test = ctx.test, ident = ctx.ident, pageDesc = ctx.pageDesc;
  var L = S.L;

  /* thumbnail of the whole corrected sheet */
  var thumbCv = V.warpRegion(ctx.capImg, ctx.H, { u0: 0, v0: 0, u1: 1, v1: 1 }, 150);
  var thumb = thumbCv.toDataURL('image/jpeg', 0.55);

  var blobs = [], record = {
    id: Q.uid('sc'), testId: test.id,
    /* store the canonical id so a 3-digit "011" and a roster entry of
     * "11" are the same student everywhere downstream */
    sid: S.normId(ident.sid) || null, page: ident.page,
    /* A page that never carried a class number. It is routed to whichever
     * student's file is open rather than treated as unidentified. */
    continuation: !!ident.continuation,
    answers: ctx.ans.answers, states: ctx.ans.states, confs: ctx.ans.confs,
    flags: ident.flags.slice(), checks: {}, overrides: {},
    code: ident.code,
    form: ctx.form && !ctx.form.primary ? ctx.form.id : null,
    ts: Date.now(), thumb: thumb, written: {}, nameCrop: null, classCrop: null, pageImg: null
  };

  /* Anything the reader was not confident about gets its own cropped strip so
   * the teacher can look at the actual paper instead of taking our word. */
  pageDesc.mc.forEach(function (item) {
    var st = ctx.ans.states[item.q], cf = ctx.ans.confs[item.q];
    var why = st === 'multi' ? 'more than one bubble filled'
            : (st === 'ok' && cf < 0.18) ? 'faint or partly erased mark'
            : (st === 'blank' && cf > 0.08) ? 'looks like a faint mark, scored blank'
            : null;
    if (!why || !item.rect) return;
    var cv = V.enhanceCanvas(V.warpRegion(ctx.capImg, ctx.H, item.rect, 620));
    var id = Q.uid('bl');
    blobs.push({ id: id, data: cv.toDataURL('image/jpeg', 0.78) });
    record.checks[item.q] = { blob: id, why: why, read: ctx.ans.answers[item.q], state: st };
  });

  /* name + class handwriting crops — the teacher's fallback identification */
  if (ident.page === 1 || !ident.sid) {
    var nc = V.enhanceCanvas(V.warpRegion(ctx.capImg, ctx.H,
      S.rect(L.nameBox.x, L.nameBox.y, L.nameBox.w, L.nameBox.h), 760));
    var cc = V.enhanceCanvas(V.warpRegion(ctx.capImg, ctx.H,
      S.rect(L.classBox.x, L.classBox.y, L.classBox.w, L.classBox.h), 620));
    record.nameCrop = Q.uid('bl');
    record.classCrop = Q.uid('bl');
    blobs.push({ id: record.nameCrop, data: nc.toDataURL('image/jpeg', 0.72) });
    blobs.push({ id: record.classCrop, data: cc.toDataURL('image/jpeg', 0.7) });
  }

  /* written-response crops */
  pageDesc.written.forEach(function (wb) {
    var cv = V.enhanceCanvas(V.warpRegion(ctx.capImg, ctx.H, wb.rect, 1100));
    var id = Q.uid('bl');
    blobs.push({ id: id, data: cv.toDataURL('image/jpeg', 0.72) });
    record.written[wb.w] = id;
  });
  if (pageDesc.written.length) {
    var full = V.enhanceCanvas(V.warpRegion(ctx.capImg, ctx.H, { u0: 0, v0: 0, u1: 1, v1: 1 }, 850));
    record.pageImg = Q.uid('bl');
    blobs.push({ id: record.pageImg, data: full.toDataURL('image/jpeg', 0.6) });
  }

  return Scanner.hooks.saveScan(record, blobs).then(function (res) {
    Scanner.sessionCount++;
    var pill = $('#pillCount');
    /* Was building "3 sheets" in English by hand, so the count reverted to
     * English after every scan while the rest of the screen stayed translated.
     * resetSession already had this right. */
    if (pill) pill.textContent = T('scan.sheetCount', { n: Scanner.sessionCount });
    setOpen();
    report(res, record, test);
    return res;
  });
}

/**
 * res from app.saveScan:
 *   { status:'ok'|'unknown-id'|'no-id'|'replaced'|'key', name, complete, missingPages }
 */
function announce(msg) {
  var n = $('#srAnnounce');
  if (n) n.textContent = msg;
}

function report(res, record, test) {
  var pageTag = T('scan.pageTag', { n: record.page });
  var speak = $('#optSpeak') && $('#optSpeak').checked;

  if (res.status === 'key') {
    flash('ok'); Q.Audio2.done();
    bigMessage(T('scan.keyBig'), T('scan.keyFrom', { page: pageTag }), 1600);
    setStatus(T('scan.keyUpdated'), 'ok');
    announce(T('scan.keyAnnounce'));
    addThumb(record.thumb, T('scan.keyTag'));
    return;
  }
  if (res.status === 'no-owner') {
    /* A continuation page arrived with no file open. Almost always the first
     * page of the stack was skipped or missed, so say that rather than
     * "no name", which sends the teacher looking at the wrong thing. */
    flash('bad'); Q.Audio2.bad();
    bigMessage(T('scan.noOwnerBig'), T('scan.noOwnerSub', { n: record.page }), 2600);
    setStatus(T('scan.noOwnerStatus'), 'bad');
    announce(T('scan.noOwnerStatus'));
    addThumb(record.thumb, T('scan.unknownTag'), true);
    if (speak) Q.speak(T('scan.noOwnerBig'));
    return;
  }
  if (res.status === 'owner-clash') {
    /* The open student already has this page. The stack has changed without a
     * class number being read, so filing it would be a guess about whose
     * answers these are. Refuse and let the teacher say. */
    flash('bad'); Q.Audio2.bad();
    bigMessage(T('scan.clashBig'), T('scan.clashSub', { n: record.page }), 2800);
    setStatus(T('scan.clashStatus'), 'bad');
    announce(T('scan.clashStatus'));
    addThumb(record.thumb, T('scan.unknownTag'), true);
    if (speak) Q.speak(T('scan.clashBig'));
    return;
  }
  if (res.status === 'no-id') {
    flash('bad'); Q.Audio2.bad();
    bigMessage(T('scan.noNameBig'), T('scan.noNameSub'), 2400);
    setStatus(T('scan.noNameStatus'), 'bad');
    announce(T('scan.noNameAnnounce'));
    addThumb(record.thumb, T('scan.unknownTag'), true);
    if (speak) Q.speak(T('scan.speakNoName'));
    return;
  }
  if (res.status === 'unknown-id') {
    flash('bad'); Q.Audio2.bad();
    bigMessage(T('scan.idBig', { sid: record.sid }), T('scan.idSub'), 2400);
    setStatus(T('scan.idStatus', { sid: record.sid }), 'bad');
    announce(T('scan.idAnnounce', { sid: record.sid }));
    addThumb(record.thumb, record.sid, true);
    if (speak) Q.speak(T('scan.speakUnknown'));
    return;
  }
  if (res.status === 'replaced') {
    flash('dup'); Q.Audio2.dup();
    bigMessage(res.name, T('scan.rescanned', { page: pageTag }), 1400);
    setStatus(T('scan.replacedStatus', { page: pageTag, name: res.name }), 'ok');
    announce(T('scan.replacedAnnounce', { page: pageTag, name: res.name }));
    addThumb(record.thumb, res.name.split(' ')[0]);
    return;
  }

  flash('ok');
  if (res.complete) Q.Audio2.done(); else if (record.page > 1) Q.Audio2.tick(); else Q.Audio2.ok();
  var sub = res.complete ? T('scan.complete')
          : (res.missingPages && res.missingPages.length
              ? T('scan.stillNeed', { pages: res.missingPages.join(', ') })
              : T('scan.accepted', { page: pageTag }));
  /* A page with no class number of its own was filed by which student is open,
   * so say whose file it went into. A stack fed in the wrong order then shows
   * up on the very next sheet, while the papers are still in the teacher's
   * hand, instead of at the end when nobody can reconstruct it. */
  if (record.routedTo) {
    sub = T('scan.filedInto', { name: res.name, n: record.page }) + '  ·  ' + sub;
  }
  bigMessage(res.name, sub, 1300);
  setStatus(T('scan.okStatus', { name: res.name, sub: sub }), 'ok');
  announce(T('scan.okAnnounce', { name: res.name, sub: sub }));
  addThumb(record.thumb, res.name.split(' ')[0]);
  if (speak) Q.speak(res.name);
}

/* ------------------------------------------------------ photo import */
Scanner.importFiles = function (files, opts) {
  var quiet = !!(opts && opts.quiet);
  ensureCanvases();
  var test = Scanner.hooks.getTest && Scanner.hooks.getTest();
  if (!test) { Q.toast(T('toast.pickTest'), 'err'); return Promise.resolve(); }
  var pages = Scanner.hooks.getPages();
  var list = Array.prototype.slice.call(files);
  var okCount = 0, failCount = 0, needy = 0;
  /* Statuses that mean the sheet was read but is not filed to a student. They
   * are the ones the teacher still has to do something about. */
  var NEEDS_A_STUDENT = { 'no-id': 1, 'unknown-id': 1, 'no-owner': 1, 'owner-clash': 1 };
  setStatus(T('scan.importing', { n: list.length }));

  return list.reduce(function (chain, file) {
    return chain.then(function () {
      return Q.loadImageFile(file).then(function (img) {
        var capW = Math.min(1700, img.naturalWidth);
        var capH = Math.round(img.naturalHeight * capW / img.naturalWidth);
        Scanner.cap.width = capW; Scanner.cap.height = capH;
        Scanner.capCtx.drawImage(img, 0, 0, capW, capH);
        var detW = Math.min(620, capW), detH = Math.round(capH * detW / capW);
        Scanner.det.width = detW; Scanner.det.height = detH;
        Scanner.detCtx.drawImage(Scanner.cap, 0, 0, detW, detH);

        S.usePaper(test);
        var gray = V.toGray(Scanner.detCtx.getImageData(0, 0, detW, detH));
        var found = V.findSheet(gray.g, detW, detH, { minAreaFrac: 0.10 });
        if (!found && capW > detW) {
          detW = capW; detH = capH;
          Scanner.det.width = detW; Scanner.det.height = detH;
          Scanner.detCtx.drawImage(Scanner.cap, 0, 0, detW, detH);
          gray = V.toGray(Scanner.detCtx.getImageData(0, 0, detW, detH));
          found = V.findSheet(gray.g, detW, detH, { minAreaFrac: 0.10 });
        }
        if (!found) { failCount++; Q.toast(T('scan.noSheetIn', { file: file.name }), 'err'); return; }

        var H = V.scaleH(found.H, capW / detW);
        var capImg = Scanner.capCtx.getImageData(0, 0, capW, capH);
        var capGray = V.toGray(capImg);
        var white = V.whiteLevel(capGray.g, capW, capH, H);
        var ident = V.decodeIdentity(capGray.g, capW, capH, H, white, S.idDigitsOf(test));
        if (ident.page == null || ident.page > pages.length) {
          failCount++; Q.toast(T('scan.pageUnreadableIn', { file: file.name }), 'err'); return;
        }
        var form = Q.Scoring.formByCode(test, ident.code);
        if (!form) {
          failCount++;
          Q.toast(T('scan.wrongCodeIn', { file: file.name, code: ident.code || '?' }), 'err');
          return;
        }
        var pageDesc = pages[ident.page - 1];
        var ans = V.decodeAnswers(capGray.g, capW, capH, H, white, pageDesc);
        return accept({ test: test, pages: pages, pageDesc: pageDesc, ident: ident, ans: ans,
                        form: form, capImg: capImg, H: H, capW: capW, capH: capH })
          .then(function (res) {
            okCount++;
            if (res && NEEDS_A_STUDENT[res.status]) needy++;
          });
      }).catch(function (e) { failCount++; console.error(e); });
    });
  }, Promise.resolve()).then(function () {
    /* "Imported 15 of 15", in green, while two of the fifteen are filed to
     * nobody. That counted sheets the reader managed to read, which is a fact
     * about the reader, not about the job being done - and it is the number a
     * teacher takes as permission to stop looking. Say how many still need a
     * student, and do not colour it as success while any do. */
    setStatus(needy
        ? T('scan.importedNeedy', { n: okCount, total: list.length, needy: needy })
        : T('scan.importedStatus', { n: okCount, total: list.length }),
      (failCount || needy) ? 'bad' : 'ok');
    if (!quiet) {
      Q.toast(T('scan.imported', { n: okCount }) +
              (failCount ? T('scan.importedFailed', { n: failCount }) : '') +
              (needy ? T('scan.importedNeedyToast', { n: needy }) : ''),
              (failCount || needy) ? 'err' : 'good', 5000);
    }
    if (Scanner.hooks.refresh) Scanner.hooks.refresh();
  });
};

Scanner.resetSession = function () {
  Scanner.sessionCount = 0;
  Scanner.recent = {};
  Scanner.pending = null;
  var strip = $('#scanStrip'); if (strip) strip.innerHTML = '';
  var pill = $('#pillCount'); if (pill) pill.textContent = T('scan.sheetCount', { n: 0 });
  setOpen();
};

global.QG.Scanner = Scanner;
})(window);
