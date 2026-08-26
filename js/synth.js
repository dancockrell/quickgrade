/* QuickGrade — synth.js
 *
 * Renders an answer sheet straight from the shared geometry and simulates
 * photographing it — perspective, uneven light, grain. Two uses:
 *
 *  1. the sample class, so anyone can see the whole app working without
 *     owning a printer, and
 *  2. the automated suites, which photograph sheets in software and push them
 *     through the real decode path.
 *
 * It never fabricates results: everything it produces goes through the same
 * detection and scoring the camera does.
 */
(function (global) {
'use strict';
var S = global.QG.Sheet, V = global.QG.Vision, L = S.L;
var DPI = 150;
function inx(x) { return x * DPI; }
function uvToPx(pt) { return [inx(L.fid.x0 + pt.u * L.W), inx(L.fid.y0 + pt.v * L.H)]; }

/** alpha < 1 simulates a light pencil mark or an incomplete erasure. */
function drawBubble(ctx, pt, filled, letter, alpha) {
  var p = uvToPx(pt), r = inx(L.bubbleR);
  ctx.lineWidth = 1.4; ctx.strokeStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, 6.2832); ctx.stroke();
  if (filled) {
    ctx.fillStyle = alpha == null || alpha >= 1 ? '#000' : 'rgba(0,0,0,' + alpha + ')';
    ctx.beginPath(); ctx.arc(p[0], p[1], r * 0.86, 0, 6.2832); ctx.fill();
  } else if (letter) {
    ctx.fillStyle = '#c0c0c0';
    ctx.font = Math.round(r * 1.05) + 'px Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, p[0], p[1] + 0.5);
  }
}

/** renderSynthetic(test, pageIdx, {sid, name, answers}) -> canvas @150dpi */
function renderSynthetic(test, pageIdx, opts) {
  var pages = S.layoutTest(test);
  var pg = pages[pageIdx];
  var cv = document.createElement('canvas');
  cv.width = inx(L.page.w); cv.height = inx(L.page.h);
  var ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);

  ctx.fillStyle = '#000';
  /* The same brackets the printer draws, from the same function, because a
   * synthetic sheet that does not match the real one tests nothing. */
  [[L.fid.x0, L.fid.y0, false, false], [L.fid.x1, L.fid.y0, true, false],
   [L.fid.x0, L.fid.y1, false, true], [L.fid.x1, L.fid.y1, true, true]]
    .forEach(function (c) {
      S.cornerBars(c[0], c[1], c[2], c[3]).forEach(function (b) {
        ctx.fillRect(inx(b.x), inx(b.y), inx(b.w), inx(b.h));
      });
    });
  var ks = inx(L.keystone.size);
  ctx.fillRect(inx(L.keystone.x) - ks / 2, inx(L.keystone.y) - ks / 2, ks, ks);

  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#111'; ctx.font = 'bold ' + inx(0.17) + 'px Arial';
  ctx.fillText(test.title || 'Test', inx(0.60), inx(L.titleY + 0.15));
  ctx.font = inx(0.10) + 'px Arial'; ctx.fillStyle = '#444';
  ctx.fillText((test.className || '') + ' · ' + (test.date || '') + ' · use pencil, fill bubbles completely',
    inx(0.60), inx(L.subTitleY + 0.12));
  ctx.font = inx(0.09) + 'px Arial'; ctx.fillStyle = '#777';
  ctx.fillText('QuickGrade answer sheet · print at 100% · keep the four corner squares clean',
    inx(L.footerX), inx(L.footerY + 0.10));

  ctx.strokeStyle = '#444'; ctx.lineWidth = 1.4;
  ctx.strokeRect(inx(L.nameBox.x), inx(L.nameBox.y), inx(L.nameBox.w), inx(L.nameBox.h));
  ctx.strokeRect(inx(L.classBox.x), inx(L.classBox.y), inx(L.classBox.w), inx(L.classBox.h));
  ctx.fillStyle = '#101040'; ctx.font = inx(0.17) + 'px "Comic Sans MS", cursive';
  ctx.fillText(opts.name || 'Avery Nguyen', inx(L.nameBox.x + 0.12), inx(L.nameBox.y + 0.36));
  ctx.font = inx(0.12) + 'px "Comic Sans MS", cursive';
  ctx.fillText(test.className || '', inx(L.classBox.x + 0.12), inx(L.classBox.y + 0.28));

  /* Must mirror renderPage exactly, including the per-test ID width. */
  var nId = S.idDigitsOf(test);
  var sidD = S.digits(opts.sid, nId);
  S.idGrid(nId).forEach(function (row, r) {
    row.forEach(function (pt, d) { drawBubble(ctx, pt, opts.sid ? sidD[r] === d : false, String(d)); });
  });
  /* the code strip: a filled square where the bit is set, nothing where it
   * is not, drawn from the same bit order the printer uses */
  var cbits = S.codeToBits(test.code);
  S.codeBits(nId).forEach(function (pt, i) {
    if (!cbits[i]) return;
    var xy = uvToPx(pt), m = inx(0.085);
    ctx.fillStyle = '#111';
    ctx.fillRect(xy[0] - m / 2, xy[1] - m / 2, m, m);
  });
  S.pageRow(nId).forEach(function (pt, d) { drawBubble(ctx, pt, d === pageIdx, String(d + 1)); });

  pg.mc.forEach(function (item) {
    /* answers[q] may be: a choice index (clean mark), [a,b] (double-marked),
     * or {k, alpha} (faint / half-erased) — so the reader's uncertainty
     * handling can be exercised for real. */
    var pick = (opts.answers || {})[item.q];
    item.choices.forEach(function (pt, k) {
      var fill = false, alpha = 1;
      if (Array.isArray(pick)) fill = pick.indexOf(k) >= 0;
      else if (pick && typeof pick === 'object') { fill = pick.k === k; alpha = pick.alpha; }
      else fill = pick === k;
      drawBubble(ctx, pt, fill, S.LETTERS[k], alpha);
    });
    ctx.fillStyle = '#111'; ctx.font = 'bold ' + inx(0.10) + 'px Arial';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(String(item.q + 1), inx(item.x + L.labelW - 0.05), inx(item.y));
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  });

  pg.written.forEach(function (wb, wi) {
    ctx.strokeStyle = '#444'; ctx.lineWidth = 1.4;
    ctx.strokeRect(inx(wb.x), inx(wb.y), inx(wb.bw), inx(wb.bh));
    ctx.strokeStyle = '#101060'; ctx.lineWidth = 2;
    var seed = (opts.sid ? +opts.sid : 7) + wi * 13;
    ctx.beginPath();
    for (var i = 0; i < 120; i++) {
      var xx = inx(wb.x + 0.22) + i * 6.5;
      var yy = inx(wb.y + 0.4) + Math.sin((i + seed) / 3.1) * 10 + Math.floor(i / 40) * inx(0.34);
      if (i % 40 === 0) ctx.moveTo(xx - i * 6.5 + inx(wb.x + 0.22), yy); else ctx.lineTo(xx - Math.floor(i / 40) * 40 * 6.5, yy);
    }
    ctx.stroke();
  });
  return cv;
}

/* ------------------------------------------------------ camera simulation */
function invert(H) {
  var a = H.a, b = H.b, c = H.c, d = H.d, e = H.e, f = H.f, g = H.g, h = H.h;
  var det = a * (e - f * h) - b * (d - f * g) + c * (d * h - e * g);
  return [
    [(e - f * h) / det, (c * h - b) / det, (b * f - c * e) / det],
    [(f * g - d) / det, (a - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]
  ];
}
function applyInv(m, x, y) {
  var u = m[0][0] * x + m[0][1] * y + m[0][2];
  var v = m[1][0] * x + m[1][1] * y + m[1][2];
  var w = m[2][0] * x + m[2][1] * y + m[2][2];
  return [u / w, v / w];
}

/** simulateCamera(sheetCanvas, {w,h,corners,rot180,noise,vignette,bg}) -> canvas */
function simulateCamera(sheet, o) {
  o = o || {};
  var W = o.w || 1280, H2 = o.h || 1450;
  var dst = document.createElement('canvas');
  dst.width = W; dst.height = H2;
  var dctx = dst.getContext('2d');
  dctx.fillStyle = o.bg || '#6b6f76';
  dctx.fillRect(0, 0, W, H2);

  var srcQuad = [
    [inx(L.fid.x0), inx(L.fid.y0)], [inx(L.fid.x1), inx(L.fid.y0)],
    [inx(L.fid.x1), inx(L.fid.y1)], [inx(L.fid.x0), inx(L.fid.y1)]
  ];
  var q = o.corners;
  if (o.rot180) q = [q[2], q[3], q[0], q[1]];
  var Hsrc = V.homography(srcQuad[0], srcQuad[1], srcQuad[2], srcQuad[3]);
  var Hdst = V.homography(q[0], q[1], q[2], q[3]);
  var inv = invert(Hdst);

  var sImg = sheet.getContext('2d').getImageData(0, 0, sheet.width, sheet.height);
  var sd = sImg.data, sw = sheet.width, sh = sheet.height;
  var dImg = dctx.getImageData(0, 0, W, H2), dd = dImg.data;
  var padU = 0.55 / L.W, padV = 0.55 / L.H;
  var vig = o.vignette == null ? 0.34 : o.vignette;

  for (var y = 0; y < H2; y++) {
    for (var x = 0; x < W; x++) {
      var uvp = applyInv(inv, x + 0.5, y + 0.5);
      var u = uvp[0], v = uvp[1];
      if (u < -padU || u > 1 + padU || v < -padV || v > 1 + padV) continue;
      var sp = V.project(Hsrc, u, v);
      var sx = sp[0], sy = sp[1];
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) continue;
      var xi = sx | 0, yi = sy | 0, fx = sx - xi, fy = sy - yi;
      var i00 = (yi * sw + xi) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      var o4 = (y * W + x) * 4;
      var light = 1 - vig * ((x / W) * 0.55 + (y / H2) * 0.75);
      for (var k = 0; k < 3; k++) {
        var A = sd[i00 + k], B = sd[i10 + k], C = sd[i01 + k], D = sd[i11 + k];
        var val = (A + (B - A) * fx + (C - A) * fy + (A - B - C + D) * fx * fy) * light;
        if (o.noise) val += (Math.random() - 0.5) * o.noise;
        dd[o4 + k] = val < 0 ? 0 : val > 255 ? 255 : val;
      }
      dd[o4 + 3] = 255;
    }
  }
  dctx.putImageData(dImg, 0, 0);
  return dst;
}

function canvasToFile(cv, name) {
  return new Promise(function (res) {
    cv.toBlob(function (b) { res(new File([b], name, { type: 'image/jpeg' })); }, 'image/jpeg', 0.85);
  });
}

global.QG.Synth = {
  DPI: DPI, inx: inx, renderSynthetic: renderSynthetic,
  simulateCamera: simulateCamera, canvasToFile: canvasToFile
};
})(window);
