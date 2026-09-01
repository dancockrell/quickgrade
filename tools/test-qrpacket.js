/* New sheets use one bottom-left QR for geometry + document identity. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(BASE+'/index.html',{waitUntil:'networkidle'}); await page.waitForTimeout(300);
  const out=await page.evaluate(async()=>{
    const res={}; const ok=(n,c,d)=>res[n]={pass:!!c,d}; const S=QG.Sheet,V=QG.Vision,Sy=QG.Synth,P=QG.QRPacket;
    ok('QR packet module loaded by the app',!!P&&P.version===3,P&&P.prefix);
    const key=Array.from({length:180},(_,i)=>i%5);
    const test={id:'qrpacket',title:'Geometry Test',className:'Biology P3',classes:['Biology P3'],date:'2026-09-01',code:'042',mc:{count:180,choices:5,key:key,points:1,text:[],options:[],topic:[],rules:{}},written:[],curve:{kind:'none',value:0},options:{prefillId:false,idDigits:3,paper:'letter',wPerPage:2,instructions:'',scale:[[90,'A'],[80,'B'],[70,'C'],[0,'F']],footer:'',topsheet:{}}};
    S.usePaper(test); const pages=S.layoutTest(test); ok('fixture spans more than one page',pages.length>1,pages.length+' pages');
    const payload=P.payload('042',2,pages.length),parsed=P.parse(payload); ok('payload round-trips code/page/geometry',parsed&&parsed.code==='042'&&parsed.page===2&&parsed.total===pages.length&&parsed.geometry===3,payload);
    const damaged=payload.slice(0,-1)+(payload.slice(-1)==='0'?'1':'0'); ok('checksum rejects a damaged payload',P.parse(damaged)===null,damaged); ok('somebody else\'s QR is ignored',P.parse('https://example.org')===null);
    const html=S.renderSheets(test,[{}]); ok('new printout has no registration-border element',html.indexOf('<div class="edge"')<0); ok('legacy identity QR modules are removed',html.indexOf('<div class="qrmod"')<0);
    const boxes=(html.match(/class="qgqrbox"/g)||[]).length,clean=(html.match(/class="qgclean"/g)||[]).length; ok('there is exactly one packet QR per page',boxes===pages.length,boxes+' QR boxes for '+pages.length+' pages'); ok('legacy machine-identity area is visually cleared on every page',clean===pages.length,clean+' clean panels for '+pages.length+' pages');

    function answersFor(pg){const a={};pg.mc.forEach(it=>a[it.q]=key[it.q]);return a;}
    function grayAt(photo,maxW=960){const w=Math.min(maxW,photo.width),h=Math.round(photo.height*w/photo.width),c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(photo,0,0,w,h);const g=V.toGray(c.getContext('2d').getImageData(0,0,w,h));return{g:g.g,w,h};}
    function rawQr(gray,w,h){const rgba=new Uint8ClampedArray(gray.length*4);for(let i=0,j=0;i<gray.length;i++,j+=4){rgba[j]=rgba[j+1]=rgba[j+2]=gray[i];rgba[j+3]=255;}try{return jsQR(rgba,w,h,{inversionAttempts:'attemptBoth'});}catch(e){return null;}}
    function mul(A,B){const C=[[0,0,0],[0,0,0],[0,0,0]];for(let r=0;r<3;r++)for(let c=0;c<3;c++)for(let k=0;k<3;k++)C[r][c]+=A[r][k]*B[k][c];return C;}
    function obj(H){return[[H.a,H.b,H.c],[H.d,H.e,H.f],[H.g,H.h,1]];} function hom(M){const z=M[2][2];return{a:M[0][0]/z,b:M[0][1]/z,c:M[0][2]/z,d:M[1][0]/z,e:M[1][1]/z,f:M[1][2]/z,g:M[2][0]/z,h:M[2][1]/z};}
    function initialH(raw){const l=raw.location,qb=P.rect(),q=P.quiet,inner=S.rect(qb.x+q,qb.y+q,qb.size-2*q,qb.size-2*q),Hq=V.homography([l.topLeftCorner.x,l.topLeftCorner.y],[l.topRightCorner.x,l.topRightCorner.y],[l.bottomRightCorner.x,l.bottomRightCorner.y],[l.bottomLeftCorner.x,l.bottomLeftCorner.y]);return hom(mul(obj(Hq),[[1/(inner.u1-inner.u0),0,-inner.u0/(inner.u1-inner.u0)],[0,1/(inner.v1-inner.v0),-inner.v0/(inner.v1-inner.v0)],[0,0,1]]));}
    function sample(g,w,h,x,y){x=Math.max(0,Math.min(w-1,Math.round(x)));y=Math.max(0,Math.min(h-1,Math.round(y)));return g[y*w+x];}
    function edgeProbe(g,w,h,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),nx=-dy/len,ny=dx/len,cx=(a[0]+b[0])/2,cy=(a[1]+b[1])/2;let best={score:0,offset:0};for(let s=-260;s<=260;s++){const x1=cx+nx*(s-3),y1=cy+ny*(s-3),x2=cx+nx*(s+3),y2=cy+ny*(s+3);if(x1<1||y1<1||x1>w-2||y1>h-2||x2<1||y2>h-2||x2>w-2)continue;const score=Math.abs(sample(g,w,h,x2,y2)-sample(g,w,h,x1,y1));if(score>best.score)best={score:Math.round(score),offset:s};}return best;}
    function edgeDiag(raw,low){if(!raw)return null;const H=initialH(raw),pr=S.rect(0,0,S.L.page.w,S.L.page.h),q=[[pr.u0,pr.v0],[pr.u1,pr.v0],[pr.u1,pr.v1],[pr.u0,pr.v1]].map(p=>V.project(H,p[0],p[1]));return{corners:q.map(p=>p.map(x=>Math.round(x))),top:edgeProbe(low.g,low.w,low.h,q[0],q[1]),right:edgeProbe(low.g,low.w,low.h,q[1],q[2]),bottom:edgeProbe(low.g,low.w,low.h,q[3],q[2]),left:edgeProbe(low.g,low.w,low.h,q[0],q[3])};}
    function detect(photo){const low=grayAt(photo),found=V.findSheet(low.g,low.w,low.h);if(!found)return null;const H=V.scaleH(found.H,photo.width/low.w),cap=V.toGray(photo.getContext('2d').getImageData(0,0,photo.width,photo.height)),white=V.whiteLevel(cap.g,photo.width,photo.height,H),ident=V.decodeIdentity(cap.g,photo.width,photo.height,H,white,S.idDigitsOf(test));return{found,H,cap,white,ident};}
    function fidError(H,want){const got=[[0,0],[1,0],[1,1],[0,1]].map(p=>V.project(H,p[0],p[1]));let e=0;for(let i=0;i<4;i++)e+=Math.hypot(got[i][0]-want[i][0],got[i][1]-want[i][1]);return{avg:e/4,got:got.map(p=>p.map(x=>Math.round(x))),want};}

    const cam1=[[190,120],[1080,94],[1110,1330],[160,1350]],sheet1=Sy.renderSynthetic(test,0,{sid:'027',name:'Avery Nguyen',answers:answersFor(pages[0])}),photo1=Sy.simulateCamera(sheet1,{w:1280,h:1450,corners:cam1,noise:8,vignette:0.18}),low1=grayAt(photo1),raw1=rawQr(low1.g,low1.w,low1.h);
    ok('raw jsQR can decode the photographed packet symbol',!!raw1&&!!P.parse(raw1.data),raw1?raw1.data:'raw decode failed'); const packetFind1=P.find(low1.g,low1.w,low1.h),diag1=edgeDiag(raw1,low1); ok('decoded QR also passes QuickGrade page validation',!!packetFind1,packetFind1?JSON.stringify(packetFind1.qrQuality):JSON.stringify(diag1));
    const d1=detect(photo1); ok('the single QR locates a photographed page',!!d1,d1&&d1.found.qrQuality?JSON.stringify(d1.found.qrQuality):JSON.stringify(diag1));
    if(d1){const ge=fidError(d1.H,cam1);ok('refined homography recovers the known synthetic page geometry',ge.avg<4,JSON.stringify(ge));ok('QR geometry path was used instead of legacy border detection',d1.found.markers===1&&d1.found.qrPacket&&d1.found.qrPacket.geometry===3,'markers='+d1.found.markers);ok('accepted scan records useful QR/page quality measurements',d1.found.qrQuality&&d1.found.qrQuality.pixels>=34&&d1.found.qrQuality.area>=0.08,JSON.stringify(d1.found.qrQuality));ok('page one needs no machine student identity',d1.ident.code==='042'&&d1.ident.page===1&&d1.ident.sid===null&&d1.ident.flags.length===0,JSON.stringify({code:d1.ident.code,page:d1.ident.page,sid:d1.ident.sid,flags:d1.ident.flags}));const ans=V.decodeAnswers(d1.cap.g,photo1.width,photo1.height,d1.H,d1.white,pages[0]);let wrong=0;pages[0].mc.forEach(it=>{if(ans.answers[it.q]!==key[it.q])wrong++;});ok('QR-derived geometry still reads the answer grid',wrong===0,JSON.stringify({wrong,quality:d1.found.qrQuality,geometry:ge}));}

    const cropped=Sy.simulateCamera(sheet1,{w:1280,h:1450,corners:[[-150,-90],[1040,30],[1150,1290],[120,1390]],noise:4,vignette:0.08}),cg=grayAt(cropped);ok('readable QR does not accept a page whose projected corners leave the frame',P.find(cg.g,cg.w,cg.h)===null);
    const tiny=Sy.simulateCamera(sheet1,{w:1280,h:1450,corners:[[520,500],[760,505],[765,845],[515,840]],noise:2,vignette:0}),tg=grayAt(tiny);ok('too-small QR/page is rejected rather than sampled optimistically',P.find(tg.g,tg.w,tg.h)===null);
    ok('quality classifier distinguishes move closer',P.classifyHint({decoded:true,pixels:20,sideRatio:1})==='closer');
    ok('quality classifier distinguishes missing page edges',P.classifyHint({decoded:true,pixels:50,sideRatio:1,pageOutside:true,refined:false})==='wholePage');
    ok('quality classifier distinguishes excessive perspective',P.classifyHint({decoded:true,pixels:50,sideRatio:3})==='straight');
    ok('quality classifier distinguishes an unrefined bent page',P.classifyHint({decoded:true,pixels:50,sideRatio:1,pageOutside:false,refined:false})==='flat');

    const cam2=[[155,105],[1100,135],[1060,1340],[185,1310]],sheet2=Sy.renderSynthetic(test,1,{sid:'',name:'',answers:answersFor(pages[1])}),photo2=Sy.simulateCamera(sheet2,{w:1280,h:1450,corners:cam2,noise:10,vignette:0.23}),low2=grayAt(photo2),raw2=rawQr(low2.g,low2.w,low2.h),smart2=P.tryDecode(low2.g,low2.w,low2.h);ok('QR search decodes continuation packet symbol',!!smart2&&!!P.parse(smart2.data),'raw='+(raw2?'yes':'no')+', retry='+(smart2?'yes':'no'));
    const d2=detect(photo2);ok('a continuation page is independently identified by its QR',d2&&d2.ident.code==='042'&&d2.ident.page===2&&d2.ident.continuation===true,d2?JSON.stringify({code:d2.ident.code,page:d2.ident.page,continuation:d2.ident.continuation,geometry:fidError(d2.H,cam2)}):JSON.stringify(edgeDiag(smart2,low2)));
    return res;
  });
  let bad=0;for(const[k,v]of Object.entries(out)){if(!v.pass)bad++;console.log((v.pass?'PASS  ':'FAIL  ')+k+(v.d!=null?' — '+v.d:''));}console.log('\n'+(bad?bad+' FAILED':'all '+Object.keys(out).length+' passed'));if(errs.length)console.log('page errors:',errs.slice(0,5));await browser.close();process.exit(bad?1:0);
})();
