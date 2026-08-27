/* QuickGrade — vision.js
 * Pure-JS sheet detection: adaptive threshold -> connected components ->
 * four corner fiducials -> homography -> bubble sampling.
 * No libraries; runs comfortably at 15-30 fps on a phone.
 */
(function (global) {
'use strict';

var S = global.QG.Sheet;

/* --------------------------------------------------------- grayscale */
function toGray(img) {                       // img: ImageData
  var d = img.data, n = img.width * img.height, g = new Uint8Array(n);
  for (var i = 0, j = 0; i < n; i++, j += 4) {
    g[i] = (d[j] * 77 + d[j + 1] * 151 + d[j + 2] * 28) >> 8;
  }
  return { g: g, w: img.width, h: img.height };
}

/* Adaptive mean threshold via integral image. Returns Uint8Array, 1 = ink. */
function threshold(gray, w, h, winFrac, C) {
  var win = Math.max(7, Math.round(w * (winFrac || 0.09)));
  if (!(win & 1)) win++;
  var r = win >> 1;
  var W = w + 1;
  var ii = new Float64Array(W * (h + 1));
  for (var y = 0; y < h; y++) {
    var rowsum = 0, off = y * w, o1 = (y + 1) * W, o0 = y * W;
    for (var x = 0; x < w; x++) {
      rowsum += gray[off + x];
      ii[o1 + x + 1] = ii[o0 + x + 1] + rowsum;
    }
  }
  var out = new Uint8Array(w * h);
  var c = C == null ? 11 : C;
  for (var yy = 0; yy < h; yy++) {
    var y0 = yy - r < 0 ? 0 : yy - r, y1 = yy + r >= h ? h - 1 : yy + r;
    var ro = yy * w;
    for (var xx = 0; xx < w; xx++) {
      var x0 = xx - r < 0 ? 0 : xx - r, x1 = xx + r >= w ? w - 1 : xx + r;
      var area = (x1 - x0 + 1) * (y1 - y0 + 1);
      var sum = ii[(y1 + 1) * W + x1 + 1] - ii[y0 * W + x1 + 1] - ii[(y1 + 1) * W + x0] + ii[y0 * W + x0];
      out[ro + xx] = (gray[ro + xx] * area < sum - c * area) ? 1 : 0;
    }
  }
  return out;
}

/* Connected components over ink pixels (4-connected, iterative flood fill). */
function components(bin, w, h, minArea, maxArea) {
  var seen = new Uint8Array(w * h);
  var stack = new Int32Array(w * h);
  var out = [];
  for (var i = 0; i < w * h; i++) {
    if (!bin[i] || seen[i]) continue;
    var sp = 0; stack[sp++] = i; seen[i] = 1;
    var area = 0, minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, sx = 0, sy = 0;
    /* The four points furthest along each diagonal. For a rectangle these are
     * its corners however it is rotated or tilted, which a bounding box is
     * not. Tracked here because the flood fill is already touching every
     * pixel and a second pass over the component would cost more. */
    var sMin = 1e9, sMax = -1e9, dMin = 1e9, dMax = -1e9;
    var pTL = null, pBR = null, pTR = null, pBL = null;
    while (sp) {
      var p = stack[--sp];
      var px = p % w, py = (p - px) / w;
      area++; sx += px; sy += py;
      var sum = px + py, dif = px - py;
      if (sum < sMin) { sMin = sum; pTL = [px, py]; }
      if (sum > sMax) { sMax = sum; pBR = [px, py]; }
      if (dif > dMax) { dMax = dif; pTR = [px, py]; }
      if (dif < dMin) { dMin = dif; pBL = [px, py]; }
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
      if (area > maxArea + 1) { /* keep draining but stop tracking */ }
      if (px > 0     && bin[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
      if (px < w - 1 && bin[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
      if (py > 0     && bin[p - w] && !seen[p - w]) { seen[p - w] = 1; stack[sp++] = p - w; }
      if (py < h - 1 && bin[p + w] && !seen[p + w]) { seen[p + w] = 1; stack[sp++] = p + w; }
    }
    if (area < minArea || area > maxArea) continue;
    var bw = maxX - minX + 1, bh = maxY - minY + 1;
    out.push({ area: area, x: minX, y: minY, w: bw, h: bh, cx: sx / area, cy: sy / area,
               fill: area / (bw * bh), aspect: bw / bh,
               corners: [pTL, pTR, pBR, pBL] });
  }
  return out;
}

/* ------------------------------------------------------- homography */
/** Maps the unit square (0,0),(1,0),(1,1),(0,1) onto quad p0..p3. */
function homography(p0, p1, p2, p3) {
  var x0 = p0[0], y0 = p0[1], x1 = p1[0], y1 = p1[1],
      x2 = p2[0], y2 = p2[1], x3 = p3[0], y3 = p3[1];
  var sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  var a, b, c, d, e, f, g, hh;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0;
    d = y1 - y0; e = y2 - y1; f = y0;
    g = 0; hh = 0;
  } else {
    var dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2;
    var den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) < 1e-12) return null;
    g = (sx * dy2 - dx2 * sy) / den;
    hh = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + hh * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + hh * y3; f = y0;
  }
  return { a: a, b: b, c: c, d: d, e: e, f: f, g: g, h: hh };
}
function project(H, u, v) {
  var den = H.g * u + H.h * v + 1;
  if (Math.abs(den) < 1e-9) den = 1e-9;
  return [(H.a * u + H.b * v + H.c) / den, (H.d * u + H.e * v + H.f) / den];
}
function scaleH(H, k) {   // same mapping onto an image scaled by k
  return { a: H.a * k, b: H.b * k, c: H.c * k, d: H.d * k, e: H.e * k, f: H.f * k, g: H.g, h: H.h };
}

/* --------------------------------------------------------- sampling */
function bilinear(gray, w, h, x, y) {
  if (x < 0) x = 0; if (y < 0) y = 0;
  if (x > w - 1.001) x = w - 1.001; if (y > h - 1.001) y = h - 1.001;
  var xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi, o = yi * w + xi;
  var a = gray[o], b = gray[o + 1], c = gray[o + w], d = gray[o + w + 1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
/** Mean gray inside a disc of radius rpx centred on (cx,cy). */
function discMean(gray, w, h, cx, cy, rpx) {
  var r = Math.max(1, rpx), sum = 0, n = 0, r2 = r * r;
  var step = r > 6 ? 2 : 1;
  for (var dy = -r; dy <= r; dy += step) {
    for (var dx = -r; dx <= r; dx += step) {
      if (dx * dx + dy * dy > r2) continue;
      sum += bilinear(gray, w, h, cx + dx, cy + dy); n++;
    }
  }
  return n ? sum / n : 255;
}
/** Radius, in pixels, of `inches` measured on the sheet near (u,v). */
function pxPerInch(H, u, v) {
  var L = S.L;
  var p = project(H, u, v);
  var pu = project(H, u + 0.02, v), pv = project(H, u, v + 0.02);
  var su = Math.hypot(pu[0] - p[0], pu[1] - p[1]) / (0.02 * L.W);
  var sv = Math.hypot(pv[0] - p[0], pv[1] - p[1]) / (0.02 * L.H);
  return Math.min(su, sv);
}

/** Robust "paper white" level: high percentile of a coarse grid inside the sheet. */
function whiteLevel(gray, w, h, H) {
  var vals = [];
  for (var i = 1; i < 20; i++) {
    for (var j = 1; j < 26; j++) {
      var p = project(H, i / 20, j / 26);
      vals.push(bilinear(gray, w, h, p[0], p[1]));
    }
  }
  vals.sort(function (a, b) { return a - b; });
  return Math.max(40, vals[Math.floor(vals.length * 0.82)]);
}

function darkness(gray, w, h, H, pt, white, rIn) {
  var L = S.L;
  var p = project(H, pt.u, pt.v);
  if (p[0] < 0 || p[1] < 0 || p[0] >= w || p[1] >= h) return 0;
  var rpx = pxPerInch(H, pt.u, pt.v) * (rIn || L.sampleR);
  var m = discMean(gray, w, h, p[0], p[1], Math.max(1.1, rpx));
  var d = (white - m) / white;
  return d < 0 ? 0 : d > 1 ? 1 : d;
}

/**
 * Interpret one group of mutually-exclusive bubbles.
 * Uses the minimum of the group as the printed-ink baseline, so the light grey
 * letters printed inside each bubble cancel out.
 */
function readGroup(dark, absMin, relMin) {
  absMin = absMin == null ? 0.20 : absMin;
  relMin = relMin == null ? 0.15 : relMin;
  var base = Math.min.apply(null, dark);
  var best = -1, bestV = -1, second = -1, secondV = -1;
  for (var i = 0; i < dark.length; i++) {
    var rel = dark[i] - base;
    if (rel > bestV) { secondV = bestV; second = best; bestV = rel; best = i; }
    else if (rel > secondV) { secondV = rel; second = i; }
  }
  if (bestV < relMin || dark[best] < absMin) return { index: -1, state: 'blank', conf: bestV };
  var multi = (second >= 0 && secondV >= 0.62 * bestV && dark[second] >= absMin && secondV >= relMin * 0.9);
  return { index: multi ? -1 : best, state: multi ? 'multi' : 'ok', conf: bestV - secondV, second: second };
}

/* --------------------------------------------------- sheet detection */
function orderQuad(pts) {                 // convex order around centroid
  var cx = 0, cy = 0;
  pts.forEach(function (p) { cx += p[0]; cy += p[1]; });
  cx /= pts.length; cy /= pts.length;
  return pts.slice().sort(function (a, b) {
    return Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx);
  });
}
function quadArea(q) {
  var a = 0;
  for (var i = 0; i < q.length; i++) {
    var j = (i + 1) % q.length;
    a += q[i][0] * q[j][1] - q[j][0] * q[i][1];
  }
  return Math.abs(a) / 2;
}

/**
 * findSheet(gray, w, h) -> { H, quad, white, markers } | null
 * H maps sheet-normalised (u,v) to detection-image pixels.
 */
/* Find the page by its printed border.
 *
 * This used to hunt for four solid corner marks and a fifth for orientation.
 * They worked, and they made the page look like a machine artefact, which is
 * fatal for a document that has to be approved before it can be sat.
 *
 * A ruled border is a single connected rectangle of ink, and that is a much
 * more distinctive thing to look for than four squares: it encloses almost the
 * whole image, and it fills only a few per cent of its own bounding box,
 * because it is a line rather than a blob. Nothing else on a page looks like
 * that. Its four extreme points, taken along the diagonals, are its corners
 * even under perspective.
 *
 * Orientation no longer comes from a marker. The top of a sheet carries the
 * heading, the identity block and the name box; the bottom carries a footer
 * and white space. Comparing ink above and below the middle tells us which way
 * up the page is, and it does so from the design rather than from a mark added
 * to serve the machine.
 */
function findSheet(gray, w, h, opts) {
  opts = opts || {};
  var L = S.L;

  /* Thicken by one pixel.
   *
   * A ruled border is the thinnest thing on the page that has to be found, and
   * a page held far back can put it below one pixel in the downscaled copy the
   * detector works on. It then breaks into fragments, none of which encloses
   * anything, and the sheet is simply not there. One pass of dilation
   * reconnects a line that is dashed by sampling without meaningfully changing
   * a line that is solid. Only used as a fallback, because it also fattens
   * everything else on the page. */
  function dilate(bin) {
    var out = new Uint8Array(bin.length);
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = y * w + x;
        if (bin[i] ||
            (x > 0 && bin[i - 1]) || (x < w - 1 && bin[i + 1]) ||
            (y > 0 && bin[i - w]) || (y < h - 1 && bin[i + w])) out[i] = 1;
      }
    }
    return out;
  }

  function frameAt(C, thicken) {
    var bin = threshold(gray, w, h, 0.10, C);
    if (thicken) bin = dilate(bin);
    /* A border encloses most of the frame, so only very large components are
     * worth considering, and there will be few of them. */
    var comps = components(bin, w, h, w * h * 0.0004, w * h);
    var best = null;
    comps.forEach(function (c) {
      var boxArea = c.w * c.h;
      if (boxArea < w * h * (opts.minAreaFrac || 0.10)) return;
      /* Not something that runs off the edge of the picture.
       *
       * A photograph darkens at its edges and that dark rim is itself a large
       * hollow rectangle, which was being picked ahead of the page every time.
       * An area cap was tried first and is the wrong test: it depends on how
       * much of the frame the page happens to fill. What is actually true is
       * that the page is inside the photograph, so anything touching the
       * picture's own edge is not it. */
      if (c.x <= 1 || c.y <= 1 || c.x + c.w >= w - 1 || c.y + c.h >= h - 1) return;
      /* The giveaway is how little ink there is. A ruled border measured 0.009
       * of its own bounding box; the vignette rim measured 0.088. Anything
       * that is actually a shape rather than a line is far above both. */
      if (c.fill > 0.05) return;
      var asp = c.w / c.h;
      var target = L.aspect;
      var upright = asp > target * 0.62 && asp < target * 1.45;
      var sideways = asp > (1 / target) * 0.62 && asp < (1 / target) * 1.45;
      if (!upright && !sideways) return;
      /* The largest qualifying rectangle, now that the picture's own rim is
       * excluded by touching the frame edge rather than by an area cap.
       *
       * Taking the smallest was tried and is wrong, expensively so. A writing
       * page carries one large ruled answer box, which is also a hollow
       * rectangle, also low-fill, and with one question to a page its aspect
       * lands inside the tolerance. The detector locked onto the answer box
       * instead of the page border and every writing page in the sample class
       * failed to read: eight scans where there should have been fifteen, at
       * every CPU speed, which is what gave it away as geometry rather than
       * timing.
       *
       * The border encloses everything else printed on the page, so among
       * candidates that are wholly inside the photograph it is the biggest by
       * construction. */
      if (!best || boxArea > best.w * best.h) best = c;
    });
    return best;
  }

  /* Three thresholds first, then the same three with the ink thickened. The
   * plain passes carry the common case; thickening is what rescues a sheet
   * held far enough back that the border is thinner than a pixel. */
  var frame = frameAt(10) || frameAt(20) || frameAt(4) ||
              frameAt(10, true) || frameAt(20, true) || frameAt(4, true);
  if (!frame || !frame.corners || frame.corners.indexOf(null) >= 0) return null;

  /* The corners of a rectangle, however it is turned or tilted: the points
   * furthest along each diagonal. */
  var quad = frame.corners.slice();
  for (var i2 = 0; i2 < 4; i2++)
    for (var j = i2 + 1; j < 4; j++)
      if (quad[i2] === quad[j]) return null;

  var q = orderQuad(quad.map(function (pt) { return [pt[0], pt[1]]; }));
  if (quadArea(q) < w * h * (opts.minAreaFrac || 0.10)) return null;

  var target2 = L.aspect;
  var best2 = null, scores = [];
  for (var r = 0; r < 4; r++) {
    var p0 = q[r], p1 = q[(r + 1) % 4], p2 = q[(r + 2) % 4], p3 = q[(r + 3) % 4];
    var H = homography(p0, p1, p2, p3);
    if (!H) continue;
    var top = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    var bot = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]);
    var lef = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    var rig = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    if (top < 30 || lef < 30) continue;
    if (Math.max(top, bot) > 2.4 * Math.min(top, bot)) continue;
    if (Math.max(lef, rig) > 2.4 * Math.min(lef, rig)) continue;
    var asp2 = ((top + bot) / 2) / ((lef + rig) / 2);
    if (asp2 < target2 * 0.62 || asp2 > target2 * 1.45) continue;

    var white = whiteLevel(gray, w, h, H);
    var score = uprightScore(gray, w, h, H, white);
    scores.push(+score.toFixed(4));
    if (!best2 || score > best2.score) best2 = { score: score, H: H, quad: [p0, p1, p2, p3], white: white };
  }
  if (!best2) return null;
  /* scores is kept for diagnosis: four numbers, one per rotation. */
  return { H: best2.H, quad: best2.quad, white: best2.white, markers: 4, scores: scores };
}

/* Which way up is the page?
 *
 * There used to be a mark for this. Without one it has to come from something
 * the page carries anyway, and the identity block is the best candidate: two
 * rows of ten bubble outlines with labels beside them, in the same corner of
 * every page including the writing pages, and nothing like it anywhere else on
 * the sheet. Twenty printed rings put a lot of edge ink into a small area.
 *
 * Top-versus-bottom ink was tried first and is not good enough. It works on a
 * sheet that is mostly white below the fold and fails on one where questions
 * run to the bottom of the page, which is now most of them.
 */
function blockInk(gray, w, h, H, white, u0, u1, v0, v1) {
  var total = 0, n = 0;
  for (var vi = 0; vi < 8; vi++) {
    var v = v0 + (v1 - v0) * (vi + 0.5) / 8;
    for (var ui = 0; ui < 16; ui++) {
      var u = u0 + (u1 - u0) * (ui + 0.5) / 16;
      total += darkness(gray, w, h, H, { u: u, v: v }, white, 0.022);
      n++;
    }
  }
  return n ? total / n : 0;
}

/** Which end of the page is the bottom.
 *
 * The border is not a plain rectangle: its foot is drawn heavier, the way a
 * form rules off its footer. That is a fact about the page rather than a guess
 * about where the ink sits, and it is present on every sheet including the
 * writing pages, so it works when a page is nearly blank.
 *
 * Inferring this from ink distribution was tried twice and failed twice: top
 * against bottom fails once questions run to the foot of the page, and the
 * identity block against its mirror fails because the mirror is the heading
 * and the name box, which carry more ink than twenty bubble outlines.
 */
function edgeInk(gray, w, h, H, white, v) {
  var total = 0, n = 0;
  for (var i = 0; i < 24; i++) {
    var u = 0.12 + (0.76 * (i + 0.5) / 24);
    total += darkness(gray, w, h, H, { u: u, v: v }, white, 0.012);
    n++;
  }
  return total / n;
}
function uprightScore(gray, w, h, H, white) {
  /* Just inside each long edge: only the heavier rule reaches this far in. */
  return edgeInk(gray, w, h, H, white, 0.9955) -
         edgeInk(gray, w, h, H, white, 0.0045);
}
function decodeIdentity(gray, w, h, H, white, idDigits) {
  var L = S.L, flags = [];
  var nId = idDigits || L.idDigits;
  function readRows(rows) {
    var digitsOut = [], conf = 1, blanks = 0;
    rows.forEach(function (row) {
      var dk = row.map(function (pt) { return darkness(gray, w, h, H, pt, white); });
      var res = readGroup(dk, 0.22, 0.16);
      if (res.state === 'ok') { digitsOut.push(res.index); conf = Math.min(conf, res.conf); }
      else { digitsOut.push(null); blanks++; }
    });
    return { d: digitsOut, conf: conf, blanks: blanks };
  }
  /* The strip is read first, because it says which page this is, and that
   * decides whether there is a class-number grid to read at all. */
  var codeDk = S.codeBits(nId).map(function (pt) {
    return darkness(gray, w, h, H, pt, white, 0.030);
  });
  var codeBitsRead = codeDk.map(function (d) { return d > 0.30 ? 1 : 0; });
  var codeVal = S.bitsToCode(codeBitsRead);
  /* All ten clear means no strip was found at all, which is different from a
   * strip that reads zero: a real code is never zero. */
  var codeSeen = codeDk.some(function (d) { return d > 0.30; });

  /* The page number is four marks on the end of the code strip now, not a row
   * of ten bubbles of its own. Read from the same strip in the same pass. */
  var pageNo = S.bitsToPage(codeBitsRead);

  /* Only page one carries the class number.
   *
   * A student writes their number once, at the start, on the sheet in front of
   * them. The grid is printed on page one only for that reason, so on any
   * later page there is nothing there to read and an empty result is the
   * expected answer rather than a fault. Reading it anyway and flagging the
   * blanks would put every later page into the review queue, which is the
   * problem this is here to avoid. */
  var isFirstPage = pageNo === 1 || pageNo === null;
  var idr = isFirstPage ? readRows(S.idGrid(nId))
                        : { d: [], conf: 1, blanks: 0, notAsked: true };

  var sid = (idr.notAsked || idr.blanks) ? null : idr.d.join('');
  /* Padded to the printed width. A code of 042 decodes to the number 42, and
   * every comparison downstream is a string comparison, so an unpadded value
   * makes a correctly read sheet look like it belongs to a different test.
   * padStart is avoided deliberately: this file runs on old classroom
   * browsers. */
  var codeStr = String(codeVal);
  while (codeStr.length < S.L.codeDigits) codeStr = '0' + codeStr;
  var code = codeSeen ? codeStr : null;
  if (!idr.notAsked && idr.blanks) {
    flags.push(idr.blanks === nId ? 'no-id' : 'partial-id');
  }
  if (!code) flags.push('no-code');
  if (pageNo === null) flags.push('no-page');

  return {
    sid: sid, code: code, page: pageNo,
    /* True when this page never had a class number to give: the caller has to
     * route it by which student's file is open, not treat it as unidentified. */
    continuation: !!idr.notAsked,
    idConf: idr.conf, flags: flags
  };
}

/** decodeAnswers(...) -> { answers:{qIndex: choice|-1}, states:{}, } for one page. */
function decodeAnswers(gray, w, h, H, white, pageDesc) {
  var answers = {}, states = {}, confs = {};
  pageDesc.mc.forEach(function (item) {
    var dk = item.choices.map(function (pt) { return darkness(gray, w, h, H, pt, white); });
    var res = readGroup(dk);
    answers[item.q] = res.state === 'ok' ? res.index : -1;
    states[item.q] = res.state;
    confs[item.q] = res.conf;
  });
  return { answers: answers, states: states, confs: confs };
}

/* ------------------------------------------------------------- warp */
/**
 * warpRegion(srcImageData, H, r, outW) -> canvas
 * r = {u0,v0,u1,v1} in sheet-normalised coords. H maps (u,v) -> srcImageData px.
 */
function warpRegion(src, H, r, outW) {
  var L = S.L;
  var wIn = (r.u1 - r.u0) * L.W, hIn = (r.v1 - r.v0) * L.H;
  outW = Math.max(32, Math.round(outW || 900));
  var outH = Math.max(16, Math.round(outW * hIn / Math.max(0.05, wIn)));
  var cv = document.createElement('canvas');
  cv.width = outW; cv.height = outH;
  var ctx = cv.getContext('2d');
  var dst = ctx.createImageData(outW, outH);
  var sd = src.data, sw = src.width, sh = src.height, dd = dst.data;
  for (var j = 0; j < outH; j++) {
    var v = r.v0 + (j + 0.5) / outH * (r.v1 - r.v0);
    for (var i = 0; i < outW; i++) {
      var uu = r.u0 + (i + 0.5) / outW * (r.u1 - r.u0);
      var p = project(H, uu, v);
      var x = p[0], y = p[1];
      var o = (j * outW + i) * 4;
      if (x < 0 || y < 0 || x >= sw - 1 || y >= sh - 1) { dd[o] = dd[o + 1] = dd[o + 2] = 255; dd[o + 3] = 255; continue; }
      var xi = x | 0, yi = y | 0, fx = x - xi, fy = y - yi;
      var i00 = (yi * sw + xi) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (var k = 0; k < 3; k++) {
        var a = sd[i00 + k], b = sd[i10 + k], c = sd[i01 + k], d2 = sd[i11 + k];
        dd[o + k] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d2) * fx * fy;
      }
      dd[o + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
  return cv;
}

/** Lightly clean a warped crop: white-balance + contrast so ink reads black. */
function enhanceCanvas(cv) {
  var ctx = cv.getContext('2d');
  var img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
  var hist = new Uint32Array(256), n = cv.width * cv.height;
  for (var i = 0, j = 0; i < n; i++, j += 4) hist[(d[j] * 77 + d[j + 1] * 151 + d[j + 2] * 28) >> 8]++;
  var acc = 0, lo = 0, hi = 255;
  for (var k = 0; k < 256; k++) { acc += hist[k]; if (acc > n * 0.06) { lo = k; break; } }
  acc = 0;
  for (var k2 = 255; k2 >= 0; k2--) { acc += hist[k2]; if (acc > n * 0.14) { hi = k2; break; } }
  if (hi - lo < 25) return cv;
  var scale = 255 / (hi - lo);
  for (var i2 = 0, j2 = 0; i2 < n; i2++, j2 += 4) {
    for (var c = 0; c < 3; c++) {
      var vv = (d[j2 + c] - lo) * scale;
      d[j2 + c] = vv < 0 ? 0 : vv > 255 ? 255 : vv;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

global.QG = global.QG || {};
global.QG.Vision = {
  toGray: toGray, threshold: threshold, components: components,
  homography: homography, project: project, scaleH: scaleH,
  discMean: discMean, darkness: darkness, whiteLevel: whiteLevel, readGroup: readGroup,
  findSheet: findSheet, decodeIdentity: decodeIdentity, decodeAnswers: decodeAnswers,
  warpRegion: warpRegion, enhanceCanvas: enhanceCanvas, pxPerInch: pxPerInch
};
})(window);
