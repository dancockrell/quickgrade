/* QuickGrade — qrpacket.js
 * One bottom-left QR carries geometry version, test/version code and page data.
 * New sheets use it as their primary geometry anchor; old border sheets remain
 * readable through the legacy detector/decoder fallbacks.
 */
(function (global) {
'use strict';
var Q = global.QG, S = Q && Q.Sheet, V = Q && Q.Vision, Sy = Q && Q.Synth;
if (!Q || !S || !V || !global.qrcode || !global.jsQR) return;

var GEOMETRY_VERSION = 3, PREFIX = 'QG' + GEOMETRY_VERSION;
var QR_SIZE = 0.56, QR_INSET = 0.30, QR_QUIET = 0.045, MIN_QR_PX = 34;

function hex4(n) { var s = (n & 0xffff).toString(16).toUpperCase(); while (s.length < 4) s = '0' + s; return s; }
function crc16(text) {
  var crc = 0xffff;
  for (var i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8;
    for (var b = 0; b < 8; b++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
function paperCode() { return S.L.paper === 'a4' ? 'A' : S.L.paper === 'legal' ? 'G' : 'L'; }
function qrRect() { return { x: QR_INSET, y: S.L.page.h - QR_INSET - QR_SIZE, size: QR_SIZE }; }
function makePayload(code, page, total, paper) {
  var c = String(code == null ? '' : code).replace(/\D/g, '');
  while (c.length < S.L.codeDigits) c = '0' + c;
  c = c.slice(-S.L.codeDigits);
  var base = [PREFIX, c, String(page), String(total), paper || paperCode()].join('|');
  return base + '|' + hex4(crc16(base));
}
function parsePayload(data) {
  var m = /^(QG\d+)\|(\d{3})\|(\d{1,2})\|(\d{1,2})\|([LAG])\|([0-9A-Fa-f]{4})$/.exec(String(data || ''));
  if (!m || m[1] !== PREFIX) return null;
  var base = [m[1], m[2], m[3], m[4], m[5]].join('|');
  if (hex4(crc16(base)) !== m[6].toUpperCase()) return null;
  var page = parseInt(m[3], 10), total = parseInt(m[4], 10);
  if (!page || !total || page > total || total > 99) return null;
  return { geometry: GEOMETRY_VERSION, code: m[2], page: page, total: total, paper: m[5], raw: String(data) };
}
function makeQr(code, pageIdx, total) { var q = global.qrcode(0, 'M'); q.addData(makePayload(code, pageIdx + 1, total)); q.make(); return q; }
function qrModulesHtml(code, pageIdx, total) {
  var qb = qrRect(), qr = makeQr(code, pageIdx, total), mod = qr.getModuleCount();
  var cell = (qb.size - QR_QUIET * 2) / mod;
  var h = '<div class="qgqrbox" style="left:' + qb.x + 'in;top:' + qb.y + 'in;width:' + qb.size + 'in;height:' + qb.size + 'in"></div>';
  for (var y = 0; y < mod; y++) for (var x = 0; x < mod; x++) if (qr.isDark(y, x))
    h += '<div class="qgqrmod" style="left:' + (qb.x + QR_QUIET + x * cell) + 'in;top:' + (qb.y + QR_QUIET + y * cell) + 'in;width:' + cell + 'in;height:' + cell + 'in"></div>';
  return h;
}

var legacyRenderSheets = S.renderSheets;
S.renderSheets = function (test, people, opts) {
  var html = legacyRenderSheets.apply(S, arguments), pages = S.layoutTest(test), total = pages.length;
  var code = opts && opts.form ? opts.form.code : test.code, i = 0;
  html = html.replace(/<div class="edge"[^>]*><\/div>/g, '').replace(/<div class="qrmod"[^>]*><\/div>/g, '');
  html = html.replace('</style>', '.qgqrbox,.qgqrmod{position:absolute}.qgqrbox{background:#fff;z-index:3}.qgqrmod{background:#000;z-index:4}\n</style>');
  return html.replace(/<div class="page">/g, function (m) { var pageIdx = i++ % total; return m + qrModulesHtml(code, pageIdx, total); });
};

function grayRgba(gray) {
  var rgba = new Uint8ClampedArray(gray.length * 4);
  for (var i = 0, j = 0; i < gray.length; i++, j += 4) { var v = gray[i]; rgba[j] = v; rgba[j+1] = v; rgba[j+2] = v; rgba[j+3] = 255; }
  return rgba;
}
function mul(A, B) { var C=[[0,0,0],[0,0,0],[0,0,0]]; for(var r=0;r<3;r++)for(var c=0;c<3;c++)for(var k=0;k<3;k++)C[r][c]+=A[r][k]*B[k][c]; return C; }
function objMatrix(H) { return [[H.a,H.b,H.c],[H.d,H.e,H.f],[H.g,H.h,1]]; }
function matrixObj(M) {
  var z=M[2][2]; if(!isFinite(z)||Math.abs(z)<1e-12)return null;
  return {a:M[0][0]/z,b:M[0][1]/z,c:M[0][2]/z,d:M[1][0]/z,e:M[1][1]/z,f:M[1][2]/z,g:M[2][0]/z,h:M[2][1]/z};
}
function sheetHFromQr(location) {
  if (!location) return null;
  var p0=location.topLeftCorner,p1=location.topRightCorner,p2=location.bottomRightCorner,p3=location.bottomLeftCorner;
  if(!p0||!p1||!p2||!p3)return null;
  var Hq=V.homography([p0.x,p0.y],[p1.x,p1.y],[p2.x,p2.y],[p3.x,p3.y]); if(!Hq)return null;
  var qb=qrRect(), rr=S.rect(qb.x,qb.y,qb.size,qb.size), du=rr.u1-rr.u0,dv=rr.v1-rr.v0;
  if(Math.abs(du)<1e-9||Math.abs(dv)<1e-9)return null;
  return matrixObj(mul(objMatrix(Hq),[[1/du,0,-rr.u0/du],[0,1/dv,-rr.v0/dv],[0,0,1]]));
}
function quadArea(q){var a=0;for(var i=0;i<q.length;i++){var j=(i+1)%q.length;a+=q[i][0]*q[j][1]-q[j][0]*q[i][1];}return Math.abs(a)/2;}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function findPacketQr(gray,w,h){
  var result=null; try{result=global.jsQR(grayRgba(gray),w,h,{inversionAttempts:'attemptBoth'});}catch(e){result=null;}
  if(!result)return null; var packet=parsePayload(result.data); if(!packet)return null;
  var loc=result.location||{}, sides=loc.topLeftCorner&&loc.topRightCorner&&loc.bottomRightCorner&&loc.bottomLeftCorner?
    [dist(loc.topLeftCorner,loc.topRightCorner),dist(loc.topRightCorner,loc.bottomRightCorner),dist(loc.bottomRightCorner,loc.bottomLeftCorner),dist(loc.bottomLeftCorner,loc.topLeftCorner)]:[];
  var qrPx=sides.length?sides.reduce(function(a,b){return a+b;},0)/sides.length:0; if(qrPx<MIN_QR_PX)return null;
  var H=sheetHFromQr(loc); if(!H)return null;
  var quad=[V.project(H,0,0),V.project(H,1,0),V.project(H,1,1),V.project(H,0,1)];
  if(quadArea(quad)<w*h*0.08)return null;
  var mx=w*0.025,my=h*0.025; if(quad.some(function(p){return p[0]<-mx||p[1]<-my||p[0]>w+mx||p[1]>h+my;}))return null;
  return {H:H,quad:quad,white:V.whiteLevel(gray,w,h,H),markers:1,qrPacket:packet,qrQuality:{pixels:Math.round(qrPx),area:quadArea(quad)/(w*h)}};
}
var legacyFindSheet=V.findSheet;
V.findSheet=function(gray,w,h,opts){return findPacketQr(gray,w,h)||legacyFindSheet(gray,w,h,opts);};

function decodePacketFromWarp(gray,w,h,H){
  var qb=qrRect(), data=grayRgba(gray);
  var cv=V.warpRegion({data:data,width:w,height:h},H,S.rect(qb.x,qb.y,qb.size,qb.size),320);
  var im=cv.getContext('2d').getImageData(0,0,cv.width,cv.height),r=null;
  try{r=global.jsQR(im.data,im.width,im.height,{inversionAttempts:'attemptBoth'});}catch(e){r=null;}
  return r?parsePayload(r.data):null;
}
var legacyDecodeIdentity=V.decodeIdentity;
V.decodeIdentity=function(gray,w,h,H,white,idDigits){
  var packet=decodePacketFromWarp(gray,w,h,H); if(!packet)return legacyDecodeIdentity(gray,w,h,H,white,idDigits);
  var old=legacyDecodeIdentity(gray,w,h,H,white,idDigits),first=packet.page===1,flags=[];
  if(first&&!old.sid)flags.push((old.flags||[]).indexOf('partial-id')>=0?'partial-id':'no-id');
  return {sid:first?old.sid:null,code:packet.code,page:packet.page,continuation:!first,idConf:first?old.idConf:1,flags:flags,qrPacket:packet};
};

if(Sy&&Sy.renderSynthetic){
  var legacySynthetic=Sy.renderSynthetic;
  Sy.renderSynthetic=function(test,pageIdx,opts){
    S.usePaper(test); var cv=legacySynthetic.apply(Sy,arguments),ctx=cv.getContext('2d'),dpi=Sy.DPI;
    function wipe(x,y,ww,hh){ctx.fillStyle='#fff';ctx.fillRect(Math.round(x*dpi),Math.round(y*dpi),Math.ceil(ww*dpi),Math.ceil(hh*dpi));}
    wipe(S.L.fid.x0-0.075,S.L.fid.y0-0.075,0.15,S.L.H+0.15); wipe(S.L.fid.x1-0.075,S.L.fid.y0-0.075,0.15,S.L.H+0.15);
    wipe(S.L.fid.x0-0.075,S.L.fid.y0-0.075,S.L.W+0.15,0.15); wipe(S.L.fid.x0-0.075,S.L.fid.y1-0.13,S.L.W+0.15,0.22);
    var oldQr=S.qrRect(S.idDigitsOf(test)); wipe(oldQr.x-0.02,oldQr.y-0.02,oldQr.size+0.04,oldQr.size+0.04);
    var pages=S.layoutTest(test),qb=qrRect(),qr=makeQr(test.code,pageIdx,pages.length),mod=qr.getModuleCount(),cell=(qb.size-QR_QUIET*2)/mod;
    ctx.fillStyle='#fff';ctx.fillRect(qb.x*dpi,qb.y*dpi,qb.size*dpi,qb.size*dpi);ctx.fillStyle='#000';
    for(var y=0;y<mod;y++)for(var x=0;x<mod;x++)if(qr.isDark(y,x))ctx.fillRect((qb.x+QR_QUIET+x*cell)*dpi,(qb.y+QR_QUIET+y*cell)*dpi,cell*dpi+0.25,cell*dpi+0.25);
    return cv;
  };
}

Q.QRPacket={version:GEOMETRY_VERSION,prefix:PREFIX,size:QR_SIZE,inset:QR_INSET,rect:qrRect,payload:makePayload,parse:parsePayload,crc16:crc16,find:findPacketQr};
})(window);
