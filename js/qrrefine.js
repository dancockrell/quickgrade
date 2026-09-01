/* QuickGrade — qrrefine.js
 *
 * QG3 uses one QR, not a page border. A small QR gives an excellent local
 * coordinate anchor, but tiny corner errors become large when extrapolated to
 * the opposite end of an 11-inch page. This layer makes the contract practical:
 * - try the whole frame, then overlapping tiles, so a noisy QR is easier to find
 * - derive the sheet transform from the decoded black symbol, not its quiet zone
 * - validate that the region we actually grade is inside the photograph rather
 *   than insisting that obsolete registration-border corners are in frame
 *
 * Legacy sheets still fall through to vision.js's border detector.
 */
(function (global) {
'use strict';
var Q=global.QG, S=Q&&Q.Sheet, V=Q&&Q.Vision, P=Q&&Q.QRPacket;
if(!Q||!S||!V||!P||!global.jsQR)return;

var legacyFind=V.findSheet;
var QUIET=P.size/8; // QG3 printer uses 0.08in inside a 0.64in QR box.
var MIN_QR_PX=34;

function rgba(gray,w,h,x0,y0,ww,hh){
  x0=x0||0;y0=y0||0;ww=ww||w;hh=hh||h;
  var d=new Uint8ClampedArray(ww*hh*4),j=0;
  for(var y=0;y<hh;y++)for(var x=0;x<ww;x++){
    var v=gray[(y0+y)*w+x0+x];d[j++]=v;d[j++]=v;d[j++]=v;d[j++]=255;
  }
  return d;
}
function shifted(result,x0,y0){
  if(!result||!result.location)return result;
  var loc={},src=result.location;
  Object.keys(src).forEach(function(k){
    var p=src[k];loc[k]=p&&typeof p.x==='number'?{x:p.x+x0,y:p.y+y0}:p;
  });
  return {data:result.data,binaryData:result.binaryData,chunks:result.chunks,version:result.version,location:loc};
}
function tryDecode(gray,w,h){
  var r=null;
  try{r=global.jsQR(rgba(gray,w,h),w,h,{inversionAttempts:'attemptBoth'});}catch(e){r=null;}
  if(r&&P.parse(r.data))return r;

  /* Full-frame QR search sometimes loses a small symbol among hundreds of
   * answer-bubble edges. Overlapping half-frame tiles make the exact same QR
   * several times larger relative to the search image without inventing data. */
  var tw=Math.ceil(w*0.62),th=Math.ceil(h*0.62);
  var xs=[0,Math.max(0,w-tw)],ys=[0,Math.max(0,h-th)];
  for(var yi=0;yi<ys.length;yi++)for(var xi=0;xi<xs.length;xi++){
    var x0=xs[xi],y0=ys[yi],rr=null;
    try{rr=global.jsQR(rgba(gray,w,h,x0,y0,tw,th),tw,th,{inversionAttempts:'attemptBoth'});}catch(e2){rr=null;}
    if(rr&&P.parse(rr.data))return shifted(rr,x0,y0);
  }
  return null;
}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function mul(A,B){var C=[[0,0,0],[0,0,0],[0,0,0]];for(var r=0;r<3;r++)for(var c=0;c<3;c++)for(var k=0;k<3;k++)C[r][c]+=A[r][k]*B[k][c];return C;}
function obj(H){return[[H.a,H.b,H.c],[H.d,H.e,H.f],[H.g,H.h,1]];}
function hom(M){var z=M[2][2];if(!isFinite(z)||Math.abs(z)<1e-12)return null;return{a:M[0][0]/z,b:M[0][1]/z,c:M[0][2]/z,d:M[1][0]/z,e:M[1][1]/z,f:M[1][2]/z,g:M[2][0]/z,h:M[2][1]/z};}
function area(q){var a=0;for(var i=0;i<q.length;i++){var j=(i+1)%q.length;a+=q[i][0]*q[j][1]-q[j][0]*q[i][1];}return Math.abs(a)/2;}

function sheetH(loc){
  if(!loc||!loc.topLeftCorner||!loc.topRightCorner||!loc.bottomRightCorner||!loc.bottomLeftCorner)return null;
  var Hq=V.homography([loc.topLeftCorner.x,loc.topLeftCorner.y],
                      [loc.topRightCorner.x,loc.topRightCorner.y],
                      [loc.bottomRightCorner.x,loc.bottomRightCorner.y],
                      [loc.bottomLeftCorner.x,loc.bottomLeftCorner.y]);
  if(!Hq)return null;
  var box=P.rect(),inner={x:box.x+QUIET,y:box.y+QUIET,size:box.size-QUIET*2};
  var rr=S.rect(inner.x,inner.y,inner.size,inner.size),du=rr.u1-rr.u0,dv=rr.v1-rr.v0;
  if(Math.abs(du)<1e-9||Math.abs(dv)<1e-9)return null;
  return hom(mul(obj(Hq),[[1/du,0,-rr.u0/du],[0,1/dv,-rr.v0/dv],[0,0,1]]));
}
function inside(p,w,h,margin){return p[0]>=margin&&p[1]>=margin&&p[0]<=w-margin&&p[1]<=h-margin;}

function find(gray,w,h){
  var r=tryDecode(gray,w,h);if(!r)return null;
  var packet=P.parse(r.data);if(!packet)return null;
  var loc=r.location||{},sides=[loc.topLeftCorner&&dist(loc.topLeftCorner,loc.topRightCorner),
    loc.topRightCorner&&dist(loc.topRightCorner,loc.bottomRightCorner),
    loc.bottomRightCorner&&dist(loc.bottomRightCorner,loc.bottomLeftCorner),
    loc.bottomLeftCorner&&dist(loc.bottomLeftCorner,loc.topLeftCorner)].filter(Boolean);
  var qrPx=sides.length?sides.reduce(function(a,b){return a+b;},0)/sides.length:0;
  if(qrPx<MIN_QR_PX)return null;
  var H=sheetH(loc);if(!H)return null;
  var quad=[V.project(H,0,0),V.project(H,1,0),V.project(H,1,1),V.project(H,0,1)];
  if(area(quad)<w*h*0.07)return null;

  /* What must be visible is the grading surface, not the now-nonexistent
   * registration border. This covers every MC row and the written-answer area.
   * Header/name crops are useful recovery evidence but not permission to turn
   * a readable answer sheet into an unreadable one. */
  var x0=Math.min(S.L.colLeft,S.L.wLeft)-0.04;
  var x1=Math.max(S.L.wRight,S.L.fid.x1-0.35)+0.04;
  var y0=Math.min(S.L.contentTopBase,3.30)-0.08;
  var y1=S.L.contentBottom+0.06;
  var core=S.rect(x0,y0,x1-x0,y1-y0);
  var corePts=[V.project(H,core.u0,core.v0),V.project(H,core.u1,core.v0),
               V.project(H,core.u1,core.v1),V.project(H,core.u0,core.v1)];
  var m=Math.max(3,Math.min(w,h)*0.006);
  if(corePts.some(function(p){return !inside(p,w,h,m);} ))return null;

  return{H:H,quad:quad,white:V.whiteLevel(gray,w,h,H),markers:1,qrPacket:packet,
    qrQuality:{pixels:Math.round(qrPx),area:area(quad)/(w*h),tiled:!!r._tiled}};
}

P.find=find;
V.findSheet=function(gray,w,h,opts){return find(gray,w,h)||legacyFind(gray,w,h,opts);};
P.tryDecode=tryDecode;

})(window);
