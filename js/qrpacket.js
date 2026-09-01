/* QuickGrade — qrpacket.js
 * QG3: one bottom-left QR carries document identity and anchors geometry.
 * The QR gives a local pose; the natural paper edges refine the full-page
 * homography. Legacy border/ID sheets remain readable through vision.js.
 */
(function (global) {
'use strict';
var Q=global.QG,S=Q&&Q.Sheet,V=Q&&Q.Vision,Sy=Q&&Q.Synth;
if(!Q||!S||!V||!global.qrcode||!global.jsQR)return;

var GEOMETRY_VERSION=3,PREFIX='QG'+GEOMETRY_VERSION;
var QR_SIZE=0.64,QR_INSET=0.20,QR_QUIET=0.08,MIN_QR_PX=34;
var lastDecoded=null,lastHint=null,anonCounter=0;

function hex4(n){var s=(n&0xffff).toString(16).toUpperCase();while(s.length<4)s='0'+s;return s;}
function crc16(text){var crc=0xffff;for(var i=0;i<text.length;i++){crc^=text.charCodeAt(i)<<8;for(var b=0;b<8;b++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;}return crc;}
function paperCode(){return S.L.paper==='a4'?'A':S.L.paper==='legal'?'G':'L';}
function qrRect(){return{x:QR_INSET,y:S.L.page.h-QR_INSET-QR_SIZE,size:QR_SIZE};}
function makePayload(code,page,total,paper,kind){
  var c=String(code==null?'':code).replace(/\D/g,'');while(c.length<S.L.codeDigits)c='0'+c;c=c.slice(-S.L.codeDigits);
  kind=kind==='K'?'K':'N';var base=[PREFIX,c,String(page),String(total),paper||paperCode(),kind].join('|');
  return base+'|'+hex4(crc16(base));
}
function parsePayload(data){
  var m=/^(QG\d+)\|(\d{3})\|(\d{1,2})\|(\d{1,2})\|([LAG])\|([NK])\|([0-9A-Fa-f]{4})$/.exec(String(data||''));
  if(!m||m[1]!==PREFIX)return null;var base=[m[1],m[2],m[3],m[4],m[5],m[6]].join('|');
  if(hex4(crc16(base))!==m[7].toUpperCase())return null;
  var page=parseInt(m[3],10),total=parseInt(m[4],10);if(!page||!total||page>total||total>99)return null;
  return{geometry:GEOMETRY_VERSION,code:m[2],page:page,total:total,paper:m[5],kind:m[6],keyMode:m[6]==='K',raw:String(data)};
}
function makeQr(code,pageIdx,total,kind){var q=global.qrcode(0,'M');q.addData(makePayload(code,pageIdx+1,total,null,kind));q.make();return q;}
function qrModulesHtml(code,pageIdx,total,kind){
  var qb=qrRect(),qr=makeQr(code,pageIdx,total,kind),mod=qr.getModuleCount(),cell=(qb.size-QR_QUIET*2)/mod;
  var h='<div class="qgqrbox" style="left:'+qb.x+'in;top:'+qb.y+'in;width:'+qb.size+'in;height:'+qb.size+'in"></div>';
  for(var y=0;y<mod;y++)for(var x=0;x<mod;x++)if(qr.isDark(y,x))h+='<div class="qgqrmod" style="left:'+(qb.x+QR_QUIET+x*cell)+'in;top:'+(qb.y+QR_QUIET+y*cell)+'in;width:'+cell+'in;height:'+cell+'in"></div>';
  return h;
}
function cleanupRect(test){var x=S.L.idLabelX-0.08,y=0.68,bottom=S.laterTop(S.idDigitsOf(test))-0.02;return{x:x,y:y,w:S.L.page.w-0.20-x,h:Math.max(0.2,bottom-y)};}
function cleanupHtml(test){var r=cleanupRect(test);return'<div class="qgclean" style="left:'+r.x+'in;top:'+r.y+'in;width:'+r.w+'in;height:'+r.h+'in"></div>';}

var legacyRenderSheets=S.renderSheets;
S.renderSheets=function(test,people,opts){
  var html=legacyRenderSheets.apply(S,arguments),pages=S.layoutTest(test),total=pages.length;
  var code=opts&&opts.form?opts.form.code:test.code,kind=opts&&opts.keyMode?'K':'N',i=0;
  html=html.replace(/<div class="edge"[^>]*><\/div>/g,'').replace(/<div class="qrmod"[^>]*><\/div>/g,'');
  html=html.replace('</style>','.qgclean,.qgqrbox,.qgqrmod{position:absolute}.qgclean{background:#fff;z-index:2}.qgqrbox{background:#fff;z-index:3}.qgqrmod{background:#000;z-index:4}\n</style>');
  return html.replace(/<div class="page">/g,function(m){var pageIdx=i++%total;return m+cleanupHtml(test)+qrModulesHtml(code,pageIdx,total,kind);});
};

function grayRgba(gray,w,h,x0,y0,ww,hh,scale){
  x0=x0||0;y0=y0||0;ww=ww||w;hh=hh||h;scale=scale||1;
  var ow=ww*scale,oh=hh*scale,rgba=new Uint8ClampedArray(ow*oh*4),j=0;
  for(var y=0;y<oh;y++)for(var x=0;x<ow;x++){
    var sx=Math.min(ww-1,Math.floor(x/scale)),sy=Math.min(hh-1,Math.floor(y/scale));
    var v=gray[(y0+sy)*w+x0+sx];rgba[j++]=v;rgba[j++]=v;rgba[j++]=v;rgba[j++]=255;
  }
  return{data:rgba,w:ow,h:oh};
}
function shifted(result,x0,y0,scale){
  scale=scale||1;var out={data:result.data,binaryData:result.binaryData,chunks:result.chunks,version:result.version,location:{}};
  Object.keys(result.location||{}).forEach(function(k){var p=result.location[k];out.location[k]=p&&typeof p.x==='number'?{x:p.x/scale+x0,y:p.y/scale+y0}:p;});return out;
}
function decodeRegion(gray,w,h,x0,y0,ww,hh,scale){
  var im=grayRgba(gray,w,h,x0,y0,ww,hh,scale),r=null;
  try{r=global.jsQR(im.data,im.w,im.h,{inversionAttempts:'attemptBoth'});}catch(e){r=null;}
  return r&&parsePayload(r.data)?shifted(r,x0||0,y0||0,scale||1):null;
}
function tryDecode(gray,w,h){
  var r=decodeRegion(gray,w,h,0,0,w,h,1);if(r)return r;
  var tw=Math.ceil(w*0.62),th=Math.ceil(h*0.62),xs=[0,Math.max(0,w-tw)],ys=[0,Math.max(0,h-th)];
  for(var yi=0;yi<ys.length;yi++)for(var xi=0;xi<xs.length;xi++){r=decodeRegion(gray,w,h,xs[xi],ys[yi],tw,th,1);if(r)return r;}
  /* Upscaling does not invent detail, but it stops a barely-resolved module
   * from being lost to integer sampling inside the QR locator. */
  for(var yi2=0;yi2<ys.length;yi2++)for(var xi2=0;xi2<xs.length;xi2++){r=decodeRegion(gray,w,h,xs[xi2],ys[yi2],tw,th,2);if(r)return r;}
  return null;
}
function mul(A,B){var C=[[0,0,0],[0,0,0],[0,0,0]];for(var r=0;r<3;r++)for(var c=0;c<3;c++)for(var k=0;k<3;k++)C[r][c]+=A[r][k]*B[k][c];return C;}
function obj(H){return[[H.a,H.b,H.c],[H.d,H.e,H.f],[H.g,H.h,1]];}
function hom(M){var z=M[2][2];if(!isFinite(z)||Math.abs(z)<1e-12)return null;return{a:M[0][0]/z,b:M[0][1]/z,c:M[0][2]/z,d:M[1][0]/z,e:M[1][1]/z,f:M[1][2]/z,g:M[2][0]/z,h:M[2][1]/z};}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function pdist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function quadArea(q){var a=0;for(var i=0;i<q.length;i++){var j=(i+1)%q.length;a+=q[i][0]*q[j][1]-q[j][0]*q[i][1];}return Math.abs(a)/2;}
function qualityHint(m){
  if(!m||!m.decoded)return'showQr';
  if(m.pixels<MIN_QR_PX)return'closer';
  if(m.sideRatio>2.35)return'straight';
  if(m.pageOutside)return'wholePage';
  if(m.refined===false)return'flat';
  return null;
}
function sheetHFromQr(loc){
  if(!loc||!loc.topLeftCorner||!loc.topRightCorner||!loc.bottomRightCorner||!loc.bottomLeftCorner)return null;
  var Hq=V.homography([loc.topLeftCorner.x,loc.topLeftCorner.y],[loc.topRightCorner.x,loc.topRightCorner.y],[loc.bottomRightCorner.x,loc.bottomRightCorner.y],[loc.bottomLeftCorner.x,loc.bottomLeftCorner.y]);if(!Hq)return null;
  var qb=qrRect(),inner={x:qb.x+QR_QUIET,y:qb.y+QR_QUIET,size:qb.size-QR_QUIET*2};
  var rr=S.rect(inner.x,inner.y,inner.size,inner.size),du=rr.u1-rr.u0,dv=rr.v1-rr.v0;if(Math.abs(du)<1e-9||Math.abs(dv)<1e-9)return null;
  return hom(mul(obj(Hq),[[1/du,0,-rr.u0/du],[0,1/dv,-rr.v0/dv],[0,0,1]]));
}
function sample(gray,w,h,x,y){
  if(x<0||y<0||x>w-1||y>h-1)return 0;
  var xi=Math.min(w-2,Math.max(0,Math.floor(x))),yi=Math.min(h-2,Math.max(0,Math.floor(y))),fx=x-xi,fy=y-yi,o=yi*w+xi;
  var a=gray[o],b=gray[o+1],c=gray[o+w],d=gray[o+w+1];return a+(b-a)*fx+(c-a)*fy+(a-b-c+d)*fx*fy;
}
function edgePoints(gray,w,h,a,b,range){
  var dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);if(len<40)return[];
  var tx=dx/len,ty=dy/len,nx=-ty,ny=tx,pts=[];
  var fractions=[0.16,0.24,0.32,0.40,0.50,0.60,0.68,0.76,0.84];
  fractions.forEach(function(f){
    var cx=a[0]+dx*f,cy=a[1]+dy*f,best=null,bestScore=0;
    for(var s=-range;s<=range;s+=1){
      var x1=cx+nx*(s-3),y1=cy+ny*(s-3),x2=cx+nx*(s+3),y2=cy+ny*(s+3);
      if(x1<1||y1<1||x1>w-2||y1>h-2||x2<1||y2<1||x2>w-2||y2>h-2)continue;
      var score=Math.abs(sample(gray,w,h,x2,y2)-sample(gray,w,h,x1,y1));
      if(score>bestScore){bestScore=score;best=[cx+nx*s,cy+ny*s];}
    }
    if(best&&bestScore>=20)pts.push(best);
  });
  return pts;
}
function fitLine(pts){
  if(pts.length<5)return null;var mx=0,my=0;pts.forEach(function(p){mx+=p[0];my+=p[1];});mx/=pts.length;my/=pts.length;
  var xx=0,yy=0,xy=0;pts.forEach(function(p){var x=p[0]-mx,y=p[1]-my;xx+=x*x;yy+=y*y;xy+=x*y;});
  var ang=0.5*Math.atan2(2*xy,xx-yy),dx=Math.cos(ang),dy=Math.sin(ang),nx=-dy,ny=dx;
  return{a:nx,b:ny,c:-(nx*mx+ny*my),points:pts};
}
function intersect(l1,l2){var d=l1.a*l2.b-l2.a*l1.b;if(Math.abs(d)<1e-7)return null;return[(l1.b*l2.c-l2.b*l1.c)/d,(l1.c*l2.a-l2.c*l1.a)/d];}
function qrResidual(H,loc){
  var qb=qrRect(),inner=S.rect(qb.x+QR_QUIET,qb.y+QR_QUIET,qb.size-2*QR_QUIET,qb.size-2*QR_QUIET);
  var want=[V.project(H,inner.u0,inner.v0),V.project(H,inner.u1,inner.v0),V.project(H,inner.u1,inner.v1),V.project(H,inner.u0,inner.v1)];
  var got=[[loc.topLeftCorner.x,loc.topLeftCorner.y],[loc.topRightCorner.x,loc.topRightCorner.y],[loc.bottomRightCorner.x,loc.bottomRightCorner.y],[loc.bottomLeftCorner.x,loc.bottomLeftCorner.y]];
  var sum=0;for(var i=0;i<4;i++)sum+=pdist(want[i],got[i]);return sum/4;
}
function refineFromPaperEdges(gray,w,h,H0,loc,qrPx){
  var pr=S.rect(0,0,S.L.page.w,S.L.page.h);
  var q0=[V.project(H0,pr.u0,pr.v0),V.project(H0,pr.u1,pr.v0),V.project(H0,pr.u1,pr.v1),V.project(H0,pr.u0,pr.v1)];
  var range=Math.min(100,Math.max(28,qrPx*1.9));
  var top=fitLine(edgePoints(gray,w,h,q0[0],q0[1],range)),right=fitLine(edgePoints(gray,w,h,q0[1],q0[2],range));
  var bottom=fitLine(edgePoints(gray,w,h,q0[3],q0[2],range)),left=fitLine(edgePoints(gray,w,h,q0[0],q0[3],range));
  if(!top||!right||!bottom||!left)return null;
  var tl=intersect(top,left),tr=intersect(top,right),br=intersect(bottom,right),bl=intersect(bottom,left);if(!tl||!tr||!br||!bl)return null;
  var corners=[tl,tr,br,bl],margin=3;if(corners.some(function(p){return p[0]<margin||p[1]<margin||p[0]>w-margin||p[1]>h-margin;}))return null;
  if(quadArea(corners)<w*h*0.10)return null;
  var hp=V.homography(tl,tr,br,bl);if(!hp)return null;
  var fx0=S.L.fid.x0/S.L.page.w,fx1=S.L.fid.x1/S.L.page.w,fy0=S.L.fid.y0/S.L.page.h,fy1=S.L.fid.y1/S.L.page.h;
  var ftl=V.project(hp,fx0,fy0),ftr=V.project(hp,fx1,fy0),fbr=V.project(hp,fx1,fy1),fbl=V.project(hp,fx0,fy1);
  var H=V.homography(ftl,ftr,fbr,fbl);if(!H)return null;
  var residual=qrResidual(H,loc);if(residual>Math.max(7,qrPx*0.22))return null;
  return{H:H,pageQuad:corners,residual:residual};
}
function findPacketQr(gray,w,h){
  lastHint=qualityHint(null);
  var result=tryDecode(gray,w,h);if(!result)return null;var packet=parsePayload(result.data);if(!packet)return null;
  var loc=result.location||{},sides=loc.topLeftCorner&&loc.topRightCorner&&loc.bottomRightCorner&&loc.bottomLeftCorner?[dist(loc.topLeftCorner,loc.topRightCorner),dist(loc.topRightCorner,loc.bottomRightCorner),dist(loc.bottomRightCorner,loc.bottomLeftCorner),dist(loc.bottomLeftCorner,loc.topLeftCorner)]:[];
  var qrPx=sides.length?sides.reduce(function(a,b){return a+b;},0)/sides.length:0;
  if(qrPx<MIN_QR_PX){lastHint=qualityHint({decoded:true,pixels:qrPx,sideRatio:1});return null;}
  var sideMin=Math.min.apply(Math,sides),sideMax=Math.max.apply(Math,sides);
  if(sideMin&&sideMax/sideMin>2.35){lastHint=qualityHint({decoded:true,pixels:qrPx,sideRatio:sideMax/sideMin});return null;}
  var H0=sheetHFromQr(loc);if(!H0){lastHint='steady';return null;}
  var refined=refineFromPaperEdges(gray,w,h,H0,loc,qrPx);
  if(!refined){
    var pq=S.rect(0,0,S.L.page.w,S.L.page.h),rough=[V.project(H0,pq.u0,pq.v0),V.project(H0,pq.u1,pq.v0),V.project(H0,pq.u1,pq.v1),V.project(H0,pq.u0,pq.v1)];
    var outside=rough.some(function(p){return p[0]<-4||p[1]<-4||p[0]>w+4||p[1]>h+4;});
    lastHint=qualityHint({decoded:true,pixels:qrPx,sideRatio:sideMax/sideMin,pageOutside:outside,refined:false});
    return null;
  }
  var H=refined.H,quad=[V.project(H,0,0),V.project(H,1,0),V.project(H,1,1),V.project(H,0,1)];
  lastHint=null;
  return{H:H,quad:quad,pageQuad:refined.pageQuad,white:V.whiteLevel(gray,w,h,H),markers:1,qrPacket:packet,
    qrQuality:{pixels:Math.round(qrPx),area:quadArea(refined.pageQuad)/(w*h),edgeResidual:+refined.residual.toFixed(2)}};
}
var legacyFindSheet=V.findSheet;
V.findSheet=function(gray,w,h,opts){return findPacketQr(gray,w,h)||legacyFindSheet(gray,w,h,opts);};

function decodePacketFromWarp(gray,w,h,H){
  var qb=qrRect(),im=grayRgba(gray,w,h),cv=V.warpRegion({data:im.data,width:w,height:h},H,S.rect(qb.x,qb.y,qb.size,qb.size),360);
  var pix=cv.getContext('2d').getImageData(0,0,cv.width,cv.height),r=null;try{r=global.jsQR(pix.data,pix.width,pix.height,{inversionAttempts:'attemptBoth'});}catch(e){r=null;}return r?parsePayload(r.data):null;
}
var legacyDecodeIdentity=V.decodeIdentity;
V.decodeIdentity=function(gray,w,h,H,white,idDigits){
  var packet=decodePacketFromWarp(gray,w,h,H);if(!packet){lastDecoded=null;return legacyDecodeIdentity(gray,w,h,H,white,idDigits);}lastDecoded={packet:packet,at:Date.now()};
  if(packet.keyMode)return{sid:S.keySid(idDigits),code:packet.code,page:packet.page,continuation:false,idConf:1,flags:[],qrPacket:packet};
  return{sid:null,code:packet.code,page:packet.page,continuation:packet.page>1,idConf:1,flags:[],qrPacket:packet};
};

if(Sy&&Sy.renderSynthetic){
  var legacySynthetic=Sy.renderSynthetic;
  Sy.renderSynthetic=function(test,pageIdx,opts){
    S.usePaper(test);var cv=legacySynthetic.apply(Sy,arguments),ctx=cv.getContext('2d'),dpi=Sy.DPI;
    function wipe(x,y,ww,hh){ctx.fillStyle='#fff';ctx.fillRect(Math.round(x*dpi),Math.round(y*dpi),Math.ceil(ww*dpi),Math.ceil(hh*dpi));}
    wipe(S.L.fid.x0-0.075,S.L.fid.y0-0.075,0.15,S.L.H+0.15);wipe(S.L.fid.x1-0.075,S.L.fid.y0-0.075,0.15,S.L.H+0.15);wipe(S.L.fid.x0-0.075,S.L.fid.y0-0.075,S.L.W+0.15,0.15);wipe(S.L.fid.x0-0.075,S.L.fid.y1-0.13,S.L.W+0.15,0.22);
    var clean=cleanupRect(test);wipe(clean.x,clean.y,clean.w,clean.h);var oldQr=S.qrRect(S.idDigitsOf(test));wipe(oldQr.x-0.02,oldQr.y-0.02,oldQr.size+0.04,oldQr.size+0.04);
    var pages=S.layoutTest(test),qb=qrRect(),kind=opts&&S.isKeySid(opts.sid,S.idDigitsOf(test))?'K':'N',qr=makeQr(test.code,pageIdx,pages.length,kind),mod=qr.getModuleCount(),cell=(qb.size-QR_QUIET*2)/mod;
    ctx.fillStyle='#fff';ctx.fillRect(qb.x*dpi,qb.y*dpi,qb.size*dpi,qb.size*dpi);ctx.fillStyle='#000';for(var y=0;y<mod;y++)for(var x=0;x<mod;x++)if(qr.isDark(y,x))ctx.fillRect((qb.x+QR_QUIET+x*cell)*dpi,(qb.y+QR_QUIET+y*cell)*dpi,cell*dpi+0.25,cell*dpi+0.25);return cv;
  };
}

function decodedFor(record){if(!lastDecoded||Date.now()-lastDecoded.at>5000||!record)return null;var p=lastDecoded.packet;return p.code===record.code&&p.page===+record.page?p:null;}
function newAnonSid(){anonCounter=(anonCounter+1)%100;return'9700'+String(Date.now()%100000000)+('0'+anonCounter).slice(-2);}
Q.QRPacket={version:GEOMETRY_VERSION,prefix:PREFIX,size:QR_SIZE,inset:QR_INSET,quiet:QR_QUIET,rect:qrRect,payload:makePayload,parse:parsePayload,crc16:crc16,find:findPacketQr,tryDecode:tryDecode,classifyHint:qualityHint,setHint:function(h){lastHint=h;},getHint:function(){return lastHint;}};

function installPacketFlow(){
  var Scanner=Q.Scanner;if(!Scanner||!Scanner.hooks||!Scanner.hooks.saveScan||Q.PacketFlow)return;var active=null,T=Q.T;
  function normSid(s){return S.normId?S.normId(s):String(s||'');}
  function sameStudent(a,b){var aa=normSid(a),bb=normSid(b);return!!aa&&!!bb&&aa===bb;}
  function packetTotal(record){var p=record&&record.packet;if(p&&p.total)return+p.total;var pages=Scanner.hooks.getPages&&Scanner.hooks.getPages();return pages?pages.length:1;}
  function defaultMissing(record){var out=[],n=packetTotal(record);for(var i=1;i<=n;i++)if(i!==+record.page)out.push(i);return out;}
  function cloneMissing(a){return(a||[]).map(Number).filter(function(n){return n>0;});}
  function wouldAdvance(record){if(!active||+record.page!==1||active.testId!==record.testId||!active.missing.length)return null;if(sameStudent(active.sid,record.sid)&&!active.unassigned)return null;return{name:active.name,missingPages:active.missing.slice(),sid:active.sid};}
  function packetConflict(record){if(!active||+record.page===1||active.testId!==record.testId)return null;var form=record.form||null;if(active.code===record.code&&active.form===form)return null;return{expectedCode:active.code,gotCode:record.code,expectedForm:active.form,gotForm:form};}
  function ensurePill(){var row=document.querySelector('#scanHud .hudrow:nth-child(2)');if(!row||document.getElementById('pillPacket'))return;var p=document.createElement('span');p.className='pill';p.id='pillPacket';p.hidden=true;var status=document.getElementById('pillStatus');row.insertBefore(p,status||null);}
  function label(){if(!active)return'';var who=active.name||T('names.unassigned');return active.missing.length?who+' · '+T('scan.stillNeed',{pages:active.missing.join(', ')}):who+' · '+T('scan.complete');}
  function render(warn){ensurePill();var p=document.getElementById('pillPacket');if(!p)return;p.hidden=!active;p.textContent=label();p.className='pill'+(warn?' bad':active?' ok':'');}
  function warnAdvance(info){if(!info)return;var who=info.name||T('names.unassigned');Q.toast(who+' · '+T('scan.stillNeed',{pages:info.missingPages.join(', ')}),'err',7500);render(true);}
  function warnConflict(info){if(!info)return;Q.toast(T('scan.clashBig')+' · '+String(info.gotCode||'?')+' ≠ '+String(info.expectedCode||'?'),'err',8000);render(true);}
  function start(record,res){active={testId:record.testId,code:record.code,form:record.form||null,sid:normSid(record.sid)||null,name:res&&res.name||null,total:packetTotal(record),seen:{},missing:[],unassigned:!!record.packetUnassigned};active.seen[+record.page]=true;active.missing=res&&res.missingPages?cloneMissing(res.missingPages):defaultMissing(record);}
  function observe(record,res){if(!record||!res||res.status==='key'||record.packetVersionMismatch)return;var p=+record.page;if(p===1)start(record,res);else if(active&&active.testId===record.testId){active.seen[p]=true;if(!active.sid&&record.sid)active.sid=normSid(record.sid)||null;if(!active.name&&res.name)active.name=res.name;if(res.missingPages)active.missing=cloneMissing(res.missingPages);else active.missing=active.missing.filter(function(n){return n!==p;});}if(res.complete||(active&&active.missing.length===0))active=null;render(false);}
  function reset(){active=null;render(false);}
  function anonymousResult(record,res){if(!record.packetUnassigned)return res;var St=Q.App&&Q.App.State,have={},total=packetTotal(record);if(St)St.scans.forEach(function(sc){if(normSid(sc.sid)===normSid(record.sid))have[sc.page]=1;});var missing=[];for(var p=1;p<=total;p++)if(!have[p])missing.push(p);return{status:res&&res.status==='replaced'?'replaced':'ok',name:T('names.unassigned'),complete:missing.length===0,missingPages:missing,unassigned:true};}

  var legacySave=Scanner.hooks.saveScan;
  Scanner.hooks.saveScan=function(record,blobs){
    var packet=decodedFor(record),warning=wouldAdvance(record),conflict=packetConflict(record);if(warning)warnAdvance(warning);
    if(conflict){warnConflict(conflict);record.packetVersionMismatch=true;record.flags=(record.flags||[]).concat(['packet-version-mismatch']);var St=Q.App&&Q.App.State;if(St){St.openSid=null;St.openFor=null;}}
    if(packet){record.packet={geometry:packet.geometry,total:packet.total,page:packet.page,paper:packet.paper,kind:packet.kind};if(!packet.keyMode){if(packet.page===1&&!record.sid){record.sid=newAnonSid();record.packetUnassigned=true;record.continuation=false;}else if(packet.page>1&&!conflict&&active&&active.unassigned&&active.sid){record.sid=active.sid;record.packetUnassigned=true;record.continuation=false;}}}
    return legacySave.call(Scanner.hooks,record,blobs).then(function(res){res=anonymousResult(record,res);observe(record,res);return res;});
  };
  var legacyReset=Scanner.resetSession;Scanner.resetSession=function(){reset();return legacyReset.apply(Scanner,arguments);};ensurePill();

  ['f_idDigits','f_idLabel','f_prefillId'].forEach(function(id){var n=document.getElementById(id);if(n&&n.closest('label'))n.closest('label').hidden=true;});
  var dh=document.querySelector('[data-i18n-html="tests.sheet.digitsHint"]');if(dh)dh.hidden=true;var personal=document.getElementById('btnPrintPersonal');if(personal)personal.hidden=true;

  function groupedUnresolved(){var St=Q.App&&Q.App.State,r=St&&St.results,groups={};if(!r)return groups;(r.unresolved||[]).forEach(function(sc){if(!sc.packetUnassigned||!sc.sid)return;var k=normSid(sc.sid);(groups[k]||(groups[k]=[])).push(sc);});Object.keys(groups).forEach(function(k){groups[k].sort(function(a,b){return a.page-b.page;});});return groups;}
  function assignPacket(group,target){
    var St=Q.App.State,targetId=normSid(target),packetId=normSid(group[0].sid),pageSet={};group.forEach(function(sc){pageSet[sc.page]=1;});
    var dup=St.scans.filter(function(sc){return normSid(sc.sid)===targetId&&pageSet[sc.page]&&normSid(sc.sid)!==packetId;}),now=Date.now();dup.forEach(function(sc){sc.deleted=now;});
    group.forEach(function(sc){sc.sid=targetId;sc.packetUnassigned=false;sc.packetResolvedAt=now;sc.flags=(sc.flags||[]).filter(function(f){return f!=='no-id'&&f!=='partial-id'&&f!=='no-owner'&&f!=='owner-clash';});});
    var jobs=[Q.DB.putMany('scans',group)];if(dup.length)jobs.push(Q.DB.putMany('scans',dup));return Promise.all(jobs).then(function(){if(dup.length){St.scans=St.scans.filter(function(sc){return dup.indexOf(sc)<0;});dup.forEach(function(sc){if(St.trash.indexOf(sc)<0)St.trash.push(sc);});}if(active&&normSid(active.sid)===packetId){active.sid=targetId;active.unassigned=false;var stu=St.byId[targetId];active.name=stu&&stu.name||null;}if(St.openSid&&normSid(St.openSid)===packetId){St.openSid=targetId;St.openFor=St.test&&St.test.id;}Q.App.recompute();Q.App.route('review');var stu2=St.byId[targetId];Q.toast(T('toast.assignedTo',{name:stu2&&stu2.name||targetId}),'good');});
  }
  function collapseReview(){
    var St=Q.App&&Q.App.State,r=St&&St.results,host=document.getElementById('unresolvedBox');if(!r||!host)return;var rows=[].slice.call(host.querySelectorAll('.unrow')),un=r.unresolved||[];if(rows.length!==un.length)return;
    var groups=groupedUnresolved(),indexByScan={};un.forEach(function(sc,i){indexByScan[sc.id]=i;});Object.keys(groups).forEach(function(k){var group=groups[k],first=rows[indexByScan[group[0].id]];if(!first)return;group.slice(1).forEach(function(sc){var row=rows[indexByScan[sc.id]];if(row)row.hidden=true;});if(first.dataset.qgPacket==='1')return;first.dataset.qgPacket='1';var dim=first.querySelector('.dim');if(dim)dim.textContent=T('names.unassigned')+' · '+group.map(function(sc){return T('scan.pageTag',{n:sc.page});}).join(', ');var sel=first.querySelector('select'),assign=first.querySelector('button.go');if(assign&&sel)assign.addEventListener('click',function(e){e.preventDefault();e.stopImmediatePropagation();if(!sel.value){Q.toast(T('toast.pickStudent'),'err');return;}assignPacket(group,sel.value);},true);});
    var normal=0,seen={};un.forEach(function(sc){if(sc.packetUnassigned&&sc.sid)seen[normSid(sc.sid)]=1;else normal++;});var badge=document.getElementById('badgeUnres'),count=normal+Object.keys(seen).length;if(badge){badge.hidden=!count;badge.textContent=count;}
  }
  var review=document.getElementById('unresolvedBox');if(review&&global.MutationObserver){var mo=new MutationObserver(function(){setTimeout(collapseReview,0);});mo.observe(review,{childList:true,subtree:true});}collapseReview();
  Q.PacketFlow={get active(){return active;},wouldAdvance:wouldAdvance,packetConflict:packetConflict,observe:observe,reset:reset,label:label,assignPacket:assignPacket,groupedUnresolved:groupedUnresolved};
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installPacketFlow);else setTimeout(installPacketFlow,0);

})(window);
