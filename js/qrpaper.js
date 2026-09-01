/* QuickGrade — qrpaper.js
 *
 * The QR tells us what sheet this is and which way the local print axes run.
 * It does NOT get extrapolated across eleven inches: a one-pixel QR-corner
 * error becomes a large answer-grid error at the far end of the page.
 *
 * Instead, QG3 finds the physical paper boundary itself. The QR is then used
 * as an independent cross-check on that full-page fit. Nothing extra needs to
 * be printed on the sheet.
 */
(function (global) {
'use strict';
var Q=global.QG,S=Q&&Q.Sheet,V=Q&&Q.Vision,P=Q&&Q.QRPacket;
if(!Q||!S||!V||!P)return;

var previousFind=V.findSheet;
var paperHint='showQr';

function median(a){if(!a.length)return 0;a=a.slice().sort(function(x,y){return x-y;});var n=a.length;return n&1?a[n>>1]:(a[n/2-1]+a[n/2])/2;}
function sample(gray,w,h,x,y){x=Math.max(0,Math.min(w-1,Math.round(x)));y=Math.max(0,Math.min(h-1,Math.round(y)));return gray[y*w+x];}
function borderBackground(gray,w,h){
  var out=[],bx=Math.max(3,Math.round(w*0.035)),by=Math.max(3,Math.round(h*0.035));
  for(var x=0;x<w;x+=3){for(var y=0;y<by;y+=3)out.push(gray[y*w+x]);for(var y2=h-by;y2<h;y2+=3)out.push(gray[y2*w+x]);}
  for(var y3=by;y3<h-by;y3+=3){for(var x2=0;x2<bx;x2+=3)out.push(gray[y3*w+x2]);for(var x3=w-bx;x3<w;x3+=3)out.push(gray[y3*w+x3]);}
  return median(out);
}
function qrPaperLevel(gray,w,h,loc){
  if(!loc||!loc.topLeftCorner)return 0;
  var pts=[loc.topLeftCorner,loc.topRightCorner,loc.bottomRightCorner,loc.bottomLeftCorner],xs=pts.map(function(p){return p.x;}),ys=pts.map(function(p){return p.y;});
  var x0=Math.max(0,Math.floor(Math.min.apply(null,xs)-18)),x1=Math.min(w-1,Math.ceil(Math.max.apply(null,xs)+18));
  var y0=Math.max(0,Math.floor(Math.min.apply(null,ys)-18)),y1=Math.min(h-1,Math.ceil(Math.max.apply(null,ys)+18));
  var bx0=Math.min.apply(null,xs),bx1=Math.max.apply(null,xs),by0=Math.min.apply(null,ys),by1=Math.max.apply(null,ys),a=[];
  for(var y=y0;y<=y1;y+=2)for(var x=x0;x<=x1;x+=2){if(x>bx0-3&&x<bx1+3&&y>by0-3&&y<by1+3)continue;a.push(gray[y*w+x]);}
  return median(a);
}
function brightRun(gray,w,h,x,y,dx,dy,threshold){
  var good=0;for(var i=0;i<7;i++){var xx=x+dx*i,yy=y+dy*i;if(xx<0||yy<0||xx>=w||yy>=h)return false;if(sample(gray,w,h,xx,yy)>=threshold)good++;}return good>=6;
}
function verticalEdges(gray,w,h,threshold){
  var top=[],bottom=[],step=Math.max(5,Math.round(w/120));
  for(var x=2;x<w-2;x+=step){
    for(var y=2;y<h-8;y++){if(sample(gray,w,h,x,y)<threshold&&sample(gray,w,h,x,y+2)>=threshold&&brightRun(gray,w,h,x,y+2,0,1,threshold)){top.push([x,y+1]);break;}}
    for(var y2=h-3;y2>8;y2--){if(sample(gray,w,h,x,y2)<threshold&&sample(gray,w,h,x,y2-2)>=threshold&&brightRun(gray,w,h,x,y2-2,0,-1,threshold)){bottom.push([x,y2-1]);break;}}
  }
  return{top:top,bottom:bottom};
}
function horizontalEdges(gray,w,h,threshold){
  var left=[],right=[],step=Math.max(5,Math.round(h/150));
  for(var y=2;y<h-2;y+=step){
    for(var x=2;x<w-8;x++){if(sample(gray,w,h,x,y)<threshold&&sample(gray,w,h,x+2,y)>=threshold&&brightRun(gray,w,h,x+2,y,1,0,threshold)){left.push([x+1,y]);break;}}
    for(var x2=w-3;x2>8;x2--){if(sample(gray,w,h,x2,y)<threshold&&sample(gray,w,h,x2-2,y)>=threshold&&brightRun(gray,w,h,x2-2,y,-1,0,threshold)){right.push([x2-1,y]);break;}}
  }
  return{left:left,right:right};
}
function fitYX(points){
  if(points.length<18)return null;
  /* Bin first: one accidental bright object in the background must not get 80
   * votes just because it is vertical. The paper edge contributes across the
   * entire span, so medians by horizontal position retain it. */
  points=points.slice().sort(function(a,b){return a[0]-b[0];});var bins=[],n=12;
  for(var i=0;i<n;i++){var lo=Math.floor(points.length*i/n),hi=Math.floor(points.length*(i+1)/n),part=points.slice(lo,hi);if(part.length)bins.push([median(part.map(function(p){return p[0];})),median(part.map(function(p){return p[1];}))]);}
  if(bins.length<7)return null;var mx=0,my=0;bins.forEach(function(p){mx+=p[0];my+=p[1];});mx/=bins.length;my/=bins.length;
  var xx=0,xy=0;bins.forEach(function(p){var dx=p[0]-mx;xx+=dx*dx;xy+=dx*(p[1]-my);});if(xx<1)return null;var m=xy/xx,b=my-m*mx;
  var residuals=bins.map(function(p){return Math.abs(p[1]-(m*p[0]+b));}),med=median(residuals),keep=bins.filter(function(p){return Math.abs(p[1]-(m*p[0]+b))<=Math.max(4,med*2.5);});
  if(keep.length>=5){mx=0;my=0;keep.forEach(function(p){mx+=p[0];my+=p[1];});mx/=keep.length;my/=keep.length;xx=0;xy=0;keep.forEach(function(p){var dx=p[0]-mx;xx+=dx*dx;xy+=dx*(p[1]-my);});m=xy/xx;b=my-m*mx;}
  return{kind:'yx',m:m,b:b,n:keep.length||bins.length};
}
function fitXY(points){var swapped=points.map(function(p){return[p[1],p[0]];}),l=fitYX(swapped);return l?{kind:'xy',m:l.m,b:l.b,n:l.n}:null;}
function intersect(a,b){
  if(a.kind==='yx'&&b.kind==='xy'){var d=1-a.m*b.m;if(Math.abs(d)<1e-6)return null;var x=(b.m*a.b+b.b)/d;return[x,a.m*x+a.b];}
  if(a.kind==='xy'&&b.kind==='yx')return intersect(b,a);return null;
}
function area(q){var a=0;for(var i=0;i<q.length;i++){var j=(i+1)%q.length;a+=q[i][0]*q[j][1]-q[j][0]*q[i][1];}return Math.abs(a)/2;}
function dist(a,b){return Math.hypot(a[0]-b[0],a[1]-b[1]);}
function pageToFidH(pageQuad){
  var hp=V.homography(pageQuad[0],pageQuad[1],pageQuad[2],pageQuad[3]);if(!hp)return null;
  var fx0=S.L.fid.x0/S.L.page.w,fx1=S.L.fid.x1/S.L.page.w,fy0=S.L.fid.y0/S.L.page.h,fy1=S.L.fid.y1/S.L.page.h;
  return V.homography(V.project(hp,fx0,fy0),V.project(hp,fx1,fy0),V.project(hp,fx1,fy1),V.project(hp,fx0,fy1));
}
function qrResidual(H,loc){
  var qb=P.rect(),q=P.quiet,inner=S.rect(qb.x+q,qb.y+q,qb.size-2*q,qb.size-2*q);
  var want=[V.project(H,inner.u0,inner.v0),V.project(H,inner.u1,inner.v0),V.project(H,inner.u1,inner.v1),V.project(H,inner.u0,inner.v1)];
  var got=[[loc.topLeftCorner.x,loc.topLeftCorner.y],[loc.topRightCorner.x,loc.topRightCorner.y],[loc.bottomRightCorner.x,loc.bottomRightCorner.y],[loc.bottomLeftCorner.x,loc.bottomLeftCorner.y]];
  return(want.reduce(function(s,p,i){return s+dist(p,got[i]);},0)/4);
}
function findPaper(gray,w,h,result){
  paperHint='flat';
  var lp=result.location||{},ls=lp.topLeftCorner&&lp.topRightCorner&&lp.bottomRightCorner&&lp.bottomLeftCorner?
    [dist([lp.topLeftCorner.x,lp.topLeftCorner.y],[lp.topRightCorner.x,lp.topRightCorner.y]),dist([lp.topRightCorner.x,lp.topRightCorner.y],[lp.bottomRightCorner.x,lp.bottomRightCorner.y]),dist([lp.bottomRightCorner.x,lp.bottomRightCorner.y],[lp.bottomLeftCorner.x,lp.bottomLeftCorner.y]),dist([lp.bottomLeftCorner.x,lp.bottomLeftCorner.y],[lp.topLeftCorner.x,lp.topLeftCorner.y])]:[];
  var qrSize=ls.length?ls.reduce(function(a,b){return a+b;},0)/ls.length:0;
  if(qrSize<34){paperHint='closer';return null;}
  if(Math.max.apply(Math,ls)/Math.max(1,Math.min.apply(Math,ls))>2.35){paperHint='straight';return null;}
  var bg=borderBackground(gray,w,h),paper=qrPaperLevel(gray,w,h,result.location);
  if(paper<bg) { var tmp=paper;paper=bg;bg=tmp; }
  var contrast=paper-bg;if(contrast<24){paperHint='steady';return null;}
  var threshold=bg+contrast*0.38;
  var ve=verticalEdges(gray,w,h,threshold),he=horizontalEdges(gray,w,h,threshold);
  var top=fitYX(ve.top),bottom=fitYX(ve.bottom),left=fitXY(he.left),right=fitXY(he.right);
  if(!top||!bottom||!left||!right)return null;
  var tl=intersect(top,left),tr=intersect(top,right),br=intersect(bottom,right),bl=intersect(bottom,left);if(!tl||!tr||!br||!bl)return null;
  var q=[tl,tr,br,bl],m=2;if(q.some(function(p){return p[0]<m||p[1]<m||p[0]>w-m||p[1]>h-m;})){paperHint='wholePage';return null;}
  var ar=area(q)/(w*h);if(ar<0.12||ar>0.94)return null;
  var ratio=(dist(tl,tr)+dist(bl,br))/(dist(tl,bl)+dist(tr,br));
  var wantRatio=S.L.page.w/S.L.page.h;if(Math.abs(ratio-wantRatio)>0.17){paperHint='straight';return null;}
  var H=pageToFidH(q);if(!H)return null;
  var qrPts=[result.location.topLeftCorner,result.location.topRightCorner,result.location.bottomRightCorner,result.location.bottomLeftCorner],qrPx=(dist([qrPts[0].x,qrPts[0].y],[qrPts[1].x,qrPts[1].y])+dist([qrPts[1].x,qrPts[1].y],[qrPts[2].x,qrPts[2].y]))/2;
  var residual=qrResidual(H,result.location);if(residual>Math.max(12,qrPx*0.48))return null;
  return{H:H,pageQuad:q,qrQuality:{pixels:Math.round(qrPx),area:ar,edgeResidual:+residual.toFixed(2),paperContrast:Math.round(contrast)}};
}

V.findSheet=function(gray,w,h,opts){
  var qr=P.tryDecode(gray,w,h);
  if(qr){
    var packet=P.parse(qr.data);if(!packet)return null;
    var paper=findPaper(gray,w,h,qr);if(!paper){P.setHint(paperHint);return null;}P.setHint(null);
    return{H:paper.H,quad:[V.project(paper.H,0,0),V.project(paper.H,1,0),V.project(paper.H,1,1),V.project(paper.H,0,1)],pageQuad:paper.pageQuad,
      white:V.whiteLevel(gray,w,h,paper.H),markers:1,qrPacket:packet,qrQuality:paper.qrQuality};
  }
  P.setHint('showQr');return previousFind(gray,w,h,opts);
};
P.find=function(gray,w,h){var qr=P.tryDecode(gray,w,h);if(!qr){P.setHint('showQr');return null;}var packet=P.parse(qr.data),paper=findPaper(gray,w,h,qr);if(!packet||!paper){P.setHint(paperHint);return null;}P.setHint(null);return{H:paper.H,pageQuad:paper.pageQuad,qrPacket:packet,qrQuality:paper.qrQuality,markers:1};};

})(window);
