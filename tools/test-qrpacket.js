/* New sheets use one bottom-left QR for geometry + document identity. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);

  const out = await page.evaluate(async () => {
    const res = {}; const ok = (n, c, d) => res[n] = { pass: !!c, d };
    const S = QG.Sheet, V = QG.Vision, Sy = QG.Synth, P = QG.QRPacket;
    ok('QR packet module loaded by the app', !!P && P.version === 3, P && P.prefix);

    const key = Array.from({length: 100}, (_, i) => i % 5);
    const test = {
      id:'qrpacket', title:'Geometry Test', className:'Biology P3', classes:['Biology P3'],
      date:'2026-09-01', code:'042',
      mc:{count:100,choices:5,key:key,points:1,text:[],options:[],topic:[],rules:{}},
      written:[],curve:{kind:'none',value:0},
      options:{prefillId:false,idDigits:3,paper:'letter',wPerPage:2,instructions:'',
        scale:[[90,'A'],[80,'B'],[70,'C'],[0,'F']],footer:'',topsheet:{}}
    };
    S.usePaper(test);
    const pages = S.layoutTest(test);
    ok('fixture spans more than one page', pages.length > 1, pages.length + ' pages');

    const payload = P.payload('042', 2, pages.length);
    const parsed = P.parse(payload);
    ok('payload round-trips code/page/geometry',
      parsed && parsed.code === '042' && parsed.page === 2 && parsed.total === pages.length && parsed.geometry === 3,
      payload);
    const damaged = payload.slice(0,-1) + (payload.slice(-1) === '0' ? '1' : '0');
    ok('checksum rejects a damaged payload', P.parse(damaged) === null, damaged);
    ok('somebody else\'s QR is ignored', P.parse('https://example.org') === null);

    const html = S.renderSheets(test, [{}]);
    ok('new printout has no registration-border element', html.indexOf('<div class="edge"') < 0);
    ok('legacy identity QR modules are removed', html.indexOf('<div class="qrmod"') < 0);
    const boxes = (html.match(/class="qgqrbox"/g) || []).length;
    const clean = (html.match(/class="qgclean"/g) || []).length;
    ok('there is exactly one packet QR per page', boxes === pages.length,
      boxes + ' QR boxes for ' + pages.length + ' pages');
    ok('legacy machine-identity area is visually cleared on every page', clean === pages.length,
      clean + ' clean panels for ' + pages.length + ' pages');

    function answersFor(pg) { const a={}; pg.mc.forEach(it => { a[it.q]=key[it.q]; }); return a; }
    function grayAt(photo, maxW=960) {
      const w=Math.min(maxW,photo.width),h=Math.round(photo.height*w/photo.width);
      const c=document.createElement('canvas');c.width=w;c.height=h;
      c.getContext('2d').drawImage(photo,0,0,w,h);
      const g=V.toGray(c.getContext('2d').getImageData(0,0,w,h));
      return {g:g.g,w,h};
    }
    function detect(photo) {
      const low=grayAt(photo);
      const found=V.findSheet(low.g,low.w,low.h); if(!found)return null;
      const H=V.scaleH(found.H,photo.width/low.w);
      const cap=V.toGray(photo.getContext('2d').getImageData(0,0,photo.width,photo.height));
      const white=V.whiteLevel(cap.g,photo.width,photo.height,H);
      const ident=V.decodeIdentity(cap.g,photo.width,photo.height,H,white,S.idDigitsOf(test));
      return {found,H,cap,white,ident};
    }

    /* Give synth a fake id deliberately. New paper must ignore it: there is no
       machine student field for a child to fill in anymore. */
    const sheet1=Sy.renderSynthetic(test,0,{sid:'027',name:'Avery Nguyen',answers:answersFor(pages[0])});
    const photo1=Sy.simulateCamera(sheet1,{w:1280,h:1450,corners:[[190,120],[1080,94],[1110,1330],[160,1350]],noise:8,vignette:0.18});
    const d1=detect(photo1);
    ok('the single QR locates a photographed page',!!d1,
      d1&&d1.found.qrQuality?d1.found.qrQuality.pixels+'px QR':'not found');
    if(d1){
      ok('QR geometry path was used instead of legacy border detection',
        d1.found.markers===1&&d1.found.qrPacket&&d1.found.qrPacket.geometry===3,'markers='+d1.found.markers);
      ok('accepted scan records useful QR/page quality measurements',
        d1.found.qrQuality&&d1.found.qrQuality.pixels>=34&&d1.found.qrQuality.area>=0.08,
        JSON.stringify(d1.found.qrQuality));
      ok('page one needs no machine student identity',
        d1.ident.code==='042'&&d1.ident.page===1&&d1.ident.sid===null&&d1.ident.flags.length===0,
        JSON.stringify({code:d1.ident.code,page:d1.ident.page,sid:d1.ident.sid,flags:d1.ident.flags}));
      const ans=V.decodeAnswers(d1.cap.g,photo1.width,photo1.height,d1.H,d1.white,pages[0]);
      let wrong=0;pages[0].mc.forEach(it=>{if(ans.answers[it.q]!==key[it.q])wrong++;});
      ok('QR-derived geometry still reads the answer grid',wrong===0,wrong+' wrong of '+pages[0].mc.length);
    }

    /* A readable QR is not permission to grade if its projected page is cut
       off. Put the QR end inside the camera but push the opposite corner out. */
    const cropped=Sy.simulateCamera(sheet1,{w:1280,h:1450,
      corners:[[-150,-90],[1040,30],[1150,1290],[120,1390]],noise:4,vignette:0.08});
    const cg=grayAt(cropped);
    ok('readable QR does not accept a page whose projected corners leave the frame',
      P.find(cg.g,cg.w,cg.h)===null);

    /* Likewise, a distant page is not gradeable merely because a decoder gets
       lucky. Below the QR-size floor there are too few pixels for trustworthy
       answer sampling across the rest of the sheet. */
    const tiny=Sy.simulateCamera(sheet1,{w:1280,h:1450,
      corners:[[520,500],[760,505],[765,845],[515,840]],noise:2,vignette:0});
    const tg=grayAt(tiny);
    ok('too-small QR/page is rejected rather than sampled optimistically',
      P.find(tg.g,tg.w,tg.h)===null);

    const sheet2=Sy.renderSynthetic(test,1,{sid:'',name:'',answers:answersFor(pages[1])});
    const photo2=Sy.simulateCamera(sheet2,{w:1280,h:1450,corners:[[155,105],[1100,135],[1060,1340],[185,1310]],noise:10,vignette:0.23});
    const d2=detect(photo2);
    ok('a continuation page is independently identified by its QR',
      d2&&d2.ident.code==='042'&&d2.ident.page===2&&d2.ident.continuation===true,
      d2?JSON.stringify({code:d2.ident.code,page:d2.ident.page,continuation:d2.ident.continuation}):'not found');
    return res;
  });

  let bad=0;
  for(const [k,v] of Object.entries(out)){if(!v.pass)bad++;console.log((v.pass?'PASS  ':'FAIL  ')+k+(v.d!=null?' — '+v.d:''));}
  console.log('\n'+(bad?bad+' FAILED':'all '+Object.keys(out).length+' passed'));
  if(errs.length)console.log('page errors:',errs.slice(0,5));
  await browser.close();
  process.exit(bad?1:0);
})();
