/* Answer-key sheets no longer need a magic all-9 bubble identity. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  const out = await page.evaluate(() => {
    const R={}; const ok=(n,c,d)=>R[n]={pass:!!c,d};
    const S=QG.Sheet,V=QG.Vision,Sy=QG.Synth,P=QG.QRPacket;
    const p=P.parse(P.payload('314',1,2,null,'K'));
    ok('QR payload carries answer-key mode',p&&p.keyMode&&p.kind==='K',p&&p.raw);

    const test={id:'keyqr',title:'Key QR',className:'C',classes:['C'],date:'2026-09-01',code:'314',
      mc:{count:8,choices:4,key:[0,1,2,3,0,1,2,3],points:1,text:[],options:[],topic:[],rules:{}},
      written:[],curve:{kind:'none',value:0},
      options:{prefillId:false,idDigits:3,paper:'letter',wPerPage:2,instructions:'',scale:[[0,'F']],footer:'',topsheet:{}}};
    S.usePaper(test);
    const ans={};test.mc.key.forEach((a,i)=>ans[i]=a);
    const sheet=Sy.renderSynthetic(test,0,{sid:S.keySid(3),name:'KEY',answers:ans});
    const photo=Sy.simulateCamera(sheet,{w:1280,h:1450,corners:[[180,100],[1090,115],[1080,1340],[170,1325]],noise:6,vignette:0.15});
    const dw=960,dh=Math.round(photo.height*dw/photo.width),dc=document.createElement('canvas');dc.width=dw;dc.height=dh;
    dc.getContext('2d').drawImage(photo,0,0,dw,dh);
    const gd=V.toGray(dc.getContext('2d').getImageData(0,0,dw,dh)),found=V.findSheet(gd.g,dw,dh);
    if(!found){ok('key sheet is found from its QR',false,'not found');return R;}
    ok('key sheet is found from its QR',!!found.qrPacket,found.qrPacket&&found.qrPacket.raw);
    const H=V.scaleH(found.H,photo.width/dw),cap=V.toGray(photo.getContext('2d').getImageData(0,0,photo.width,photo.height));
    const id=V.decodeIdentity(cap.g,photo.width,photo.height,H,V.whiteLevel(cap.g,photo.width,photo.height,H),3);
    ok('key QR decodes to the reserved key identity without bubbles',S.isKeySid(id.sid,3)&&id.code==='314'&&id.page===1,
      JSON.stringify({sid:id.sid,code:id.code,page:id.page}));
    return R;
  });
  let bad=0;for(const[k,v]of Object.entries(out)){if(!v.pass)bad++;console.log((v.pass?'PASS  ':'FAIL  ')+k+(v.d?' — '+v.d:''));}
  await browser.close();process.exit(bad?1:0);
})();
