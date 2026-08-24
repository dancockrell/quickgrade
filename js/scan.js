/* QuickGrade — scan.js
 * Camera capture loop, decode pipeline, accept/reject feedback, photo import.
 * Hooks into app.js for the current test, roster lookup and persistence.
 */
(function (global) {
'use strict';

var Q = global.QG, V = Q.Vision, S = Q.Sheet;
var $ = Q.$, el = Q.el;

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
    Q.toast('This browser cannot open a camera here. Use "Import photos", or open the app over https:// (see README).', 'err', 8000);
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
    setStatus('Looking for a sheet…');
    var caps = Scanner.track.getCapabilities ? Scanner.track.getCapabilities() : {};
    $('#btnTorch').hidden = !(caps && caps.torch);
    loop();
    return Scanner.listCameras().then(fillCameraSelect);
  }).catch(function (e) {
    Q.toast('Camera error: ' + (e && e.message ? e.message : e), 'err', 7000);
    setStatus('Camera unavailable');
    throw e;
  });
};

Scanner.stop = function () {
  Scanner.running = false;
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
    .catch(function () { Q.toast('This camera has no controllable light.', 'err'); });
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
  if (!test) { setStatus('Pick a test first', 'bad'); return; }
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
  if (!found) {
    Scanner.pending = null;
    drawOverlay(null);
    setStatus('Looking for a sheet…');
    return;
  }
  drawOverlay(found.quad, detW, true);

  /* Re-sample identity + answers at the higher capture resolution. */
  var Hcap = V.scaleH(found.H, capW / detW);
  var capImg = Scanner.capCtx.getImageData(0, 0, capW, capH);
  var capGray = V.toGray(capImg);
  var white = V.whiteLevel(capGray.g, capW, capH, Hcap);
  var ident = V.decodeIdentity(capGray.g, capW, capH, Hcap, white, S.idDigitsOf(test));

  if (ident.page == null) { setStatus('Hold steadier — page marker unclear'); Scanner.pending = null; return; }

  var pages = Scanner.hooks.getPages();
  if (ident.page > pages.length) { setStatus('Page ' + ident.page + ' is not part of this test', 'bad'); return; }
  /* The printed code identifies which version of the test this is, so a
   * mixed pile of version A and version B sheets can be fed through in any
   * order without anyone choosing anything. */
  var form = Q.Scoring.formByCode(test, ident.code);
  if (!form) {
    setStatus('Not this test — sheet is code ' + (ident.code || '?'), 'bad');
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
  if (Scanner.recent[key] && now - Scanner.recent[key] < RESCAN_MS) { setStatus('Ready for the next sheet', 'ok'); return; }

  if (!Scanner.pending || Scanner.pending.key !== key) {
    Scanner.pending = { key: key, n: 1 };
    setStatus('Reading…');
    return;
  }
  Scanner.pending.n++;
  if (Scanner.pending.n < STABLE_FRAMES) { setStatus('Reading…'); return; }

  Scanner.pending = null;
  Scanner.recent[key] = now;
  Scanner.busy = true;
  accept({
    test: test, pages: pages, pageDesc: pageDesc, ident: ident, ans: ans,
    form: form, capImg: capImg, H: Hcap, capW: capW, capH: capH
  }).catch(function (e) {
    console.error(e); Q.toast('Could not save that scan: ' + e.message, 'err');
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
  add(true, false, 'Sheet found', 'all four corner squares detected');
  add(ident.code === expectCode, false, 'Test code',
    ident.code === expectCode ? 'read ' + ident.code + ' as printed'
      : 'read ' + (ident.code || 'nothing') + ', expected ' + expectCode);
  add(ident.page != null, false, 'Page number',
    ident.page != null ? 'read page ' + ident.page : 'could not be read');
  add(marked.length === 0, marked.length > 0 && marked.length <= 2, 'Answer bubbles read empty',
    marked.length === 0 ? pageDesc.mc.length + ' bubbles, none read as filled'
      : marked.length + ' read as filled (Q' + marked.slice(0, 6).join(', Q') + ')');
  add(aspectErr < 0.06, aspectErr < 0.12, 'Print proportions',
    aspectErr < 0.06 ? 'within ' + Math.round(aspectErr * 100) + '% of expected'
      : Math.round(aspectErr * 100) + '% off — hold the sheet flat and square, then retry');
  add(fill > 0.45, fill > 0.3, 'Sheet fills the frame',
    Math.round(fill * 100) + '% of frame width');
  add(skew < 0.12, skew < 0.25, 'Held square to the camera',
    Math.round(skew * 100) + '% tilt');

  var bad = rows.filter(function (r) { return !r.ok && !r.warn; });
  var warn = rows.filter(function (r) { return !r.ok && r.warn; });

  if (!bad.length) { flash('ok'); Q.Audio2.done(); } else { flash('bad'); Q.Audio2.bad(); }
  setStatus(bad.length ? 'Printing check found problems' : 'Printing check passed',
    bad.length ? 'bad' : 'ok');

  var body = Q.el('div', {}, [
    Q.el('h3', { text: bad.length ? 'Printing check — needs attention'
                    : warn.length ? 'Printing check — good, with notes' : 'Printing check passed' })
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
    advice.push('The test code did not read back. Make sure you printed this sheet from THIS test, ' +
      'and that the printer is not scaling unevenly.');
  }
  if (marked.length) {
    advice.push('Blank bubbles are reading as filled. Usually the copier is set too dark, ' +
      'or you are photocopying a copy of a copy — go back to the original master.');
  }
  if (aspectErr >= 0.06) {
    advice.push('Hold the sheet flat, square to the camera, and fill more of the frame, then run the check again.');
  }
  if (!advice.length) {
    advice.push('Your printer, paper and lighting all check out. Photocopy this master for the class.');
  }
  advice.forEach(function (a) { body.appendChild(Q.el('p', { class: 'hint', text: a })); });
  body.appendChild(Q.el('div', { class: 'row gap end' }, [
    Q.el('button', { class: 'btn', text: 'Check another sheet',
      onclick: function () { h.close(); Scanner.startCalibration(); } }),
    Q.el('button', { class: 'btn go', text: 'Done', onclick: function () { h.close(); } })
  ]));
  var h = Q.modal(body);
}

Scanner.startCalibration = function () {
  Scanner.calibrating = true;
  Scanner.pending = null;
  setStatus('Hold up one freshly printed BLANK sheet…');
  Q.toast('Print one blank sheet, then hold it up. Nothing will be recorded.', 'good', 6000);
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
    if (pill) pill.textContent = Scanner.sessionCount + ' sheet' + (Scanner.sessionCount === 1 ? '' : 's');
    report(res, record, test);
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
  var pageTag = 'page ' + record.page;
  var speak = $('#optSpeak') && $('#optSpeak').checked;

  if (res.status === 'key') {
    flash('ok'); Q.Audio2.done();
    bigMessage('ANSWER KEY', 'key captured from ' + pageTag, 1600);
    setStatus('Answer key updated', 'ok');
    announce('Answer key captured.');
    addThumb(record.thumb, 'KEY');
    return;
  }
  if (res.status === 'no-id') {
    flash('bad'); Q.Audio2.bad();
    bigMessage('NAME NOT FOUND', 'Sheet saved — tag it in Review', 2400);
    setStatus('NO NAME on this sheet — fix it in Review', 'bad');
    announce('Problem. No name on this sheet. Saved for review.');
    addThumb(record.thumb, 'UNKNOWN', true);
    if (speak) Q.speak('Name missing');
    return;
  }
  if (res.status === 'unknown-id') {
    flash('bad'); Q.Audio2.bad();
    bigMessage('ID ' + record.sid, 'not on this roster — tag it in Review', 2400);
    setStatus('ID ' + record.sid + ' is not on the roster', 'bad');
    announce('Problem. ID ' + record.sid + ' is not on the roster.');
    addThumb(record.thumb, record.sid, true);
    if (speak) Q.speak('Unknown student');
    return;
  }
  if (res.status === 'replaced') {
    flash('dup'); Q.Audio2.dup();
    bigMessage(res.name, 'rescanned ' + pageTag, 1400);
    setStatus('Replaced ' + pageTag + ' for ' + res.name, 'ok');
    announce('Rescanned ' + pageTag + ' for ' + res.name + '.');
    addThumb(record.thumb, res.name.split(' ')[0]);
    return;
  }

  flash('ok');
  if (res.complete) Q.Audio2.done(); else if (record.page > 1) Q.Audio2.tick(); else Q.Audio2.ok();
  var sub = res.complete ? 'complete — all pages in'
          : (res.missingPages && res.missingPages.length
              ? 'still need page ' + res.missingPages.join(', ')
              : pageTag + ' accepted');
  bigMessage(res.name, sub, 1300);
  setStatus(res.name + ' — ' + sub, 'ok');
  announce(res.name + ', ' + sub + '.');
  addThumb(record.thumb, res.name.split(' ')[0]);
  if (speak) Q.speak(res.name);
}

/* ------------------------------------------------------ photo import */
Scanner.importFiles = function (files, opts) {
  var quiet = !!(opts && opts.quiet);
  ensureCanvases();
  var test = Scanner.hooks.getTest && Scanner.hooks.getTest();
  if (!test) { Q.toast('Pick a test first.', 'err'); return Promise.resolve(); }
  var pages = Scanner.hooks.getPages();
  var list = Array.prototype.slice.call(files);
  var okCount = 0, failCount = 0;
  setStatus('Importing ' + list.length + ' image' + (list.length === 1 ? '' : 's') + '…');

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
        if (!found) { failCount++; Q.toast('No sheet found in ' + file.name, 'err'); return; }

        var H = V.scaleH(found.H, capW / detW);
        var capImg = Scanner.capCtx.getImageData(0, 0, capW, capH);
        var capGray = V.toGray(capImg);
        var white = V.whiteLevel(capGray.g, capW, capH, H);
        var ident = V.decodeIdentity(capGray.g, capW, capH, H, white, S.idDigitsOf(test));
        if (ident.page == null || ident.page > pages.length) {
          failCount++; Q.toast('Page number unreadable in ' + file.name, 'err'); return;
        }
        var form = Q.Scoring.formByCode(test, ident.code);
        if (!form) {
          failCount++;
          Q.toast(file.name + ' is code ' + (ident.code || '?') + ', not part of this test', 'err');
          return;
        }
        var pageDesc = pages[ident.page - 1];
        var ans = V.decodeAnswers(capGray.g, capW, capH, H, white, pageDesc);
        return accept({ test: test, pages: pages, pageDesc: pageDesc, ident: ident, ans: ans,
                        form: form, capImg: capImg, H: H, capW: capW, capH: capH })
          .then(function () { okCount++; });
      }).catch(function (e) { failCount++; console.error(e); });
    });
  }, Promise.resolve()).then(function () {
    setStatus('Imported ' + okCount + ' of ' + list.length, failCount ? 'bad' : 'ok');
    if (!quiet) {
      Q.toast('Imported ' + okCount + ' sheet' + (okCount === 1 ? '' : 's') +
              (failCount ? ' — ' + failCount + ' could not be read' : ''),
              failCount ? 'err' : 'good', 5000);
    }
    if (Scanner.hooks.refresh) Scanner.hooks.refresh();
  });
};

Scanner.resetSession = function () {
  Scanner.sessionCount = 0;
  Scanner.recent = {};
  Scanner.pending = null;
  var strip = $('#scanStrip'); if (strip) strip.innerHTML = '';
  var pill = $('#pillCount'); if (pill) pill.textContent = '0 sheets';
};

global.QG.Scanner = Scanner;
})(window);
