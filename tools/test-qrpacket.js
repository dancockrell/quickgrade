/* New sheets use one bottom-left QR for geometry + document identity. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.addScriptTag({ url: BASE + '/js/qrpacket.js' });
  await page.waitForTimeout(300);

  const out = await page.evaluate(async () => {
    const res = {}; const ok = (n, c, d) => res[n] = { pass: !!c, d };
    const S = QG.Sheet, V = QG.Vision, Sy = QG.Synth, P = QG.QRPacket;
    ok('QR packet module loaded', !!P && P.version === 3, P && P.prefix);

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
    ok('there is exactly one packet QR per page', boxes === pages.length,
      boxes + ' QR boxes for ' + pages.length + ' pages');

    function answersFor(pg) { const a={}; pg.mc.forEach(it => { a[it.q]=key[it.q]; }); return a; }
    function detect(photo) {
      const detW=Math.min(960,photo.width),detH=Math.round(photo.height*detW/photo.width);
      const dc=document.createElement('canvas');dc.width=detW;dc.height=detH;
      dc.getContext('2d').drawImage(photo,0,0,detW,detH);
      const gd=V.toGray(dc.getContext('2d').getImageData(0,0,detW,detH));
      const found=V.findSheet(gd.g,detW,detH); if(!found)return null;
      const H=V.scaleH(found.H,photo.width/detW);
      const cap=V.toGray(photo.getContext('2d').getImageData(0,0,photo.width,photo.height));
      const white=V.whiteLevel(cap.g,photo.width,photo.height,H);
      const ident=V.decodeIdentity(cap.g,photo.width,photo.height,H,white,S.idDigitsOf(test));
      return {found,H,cap,white,ident};
    }

    const sheet1=Sy.renderSynthetic(test,0,{sid:'027',name:'Avery Nguyen',answers:answersFor(pages[0])});
    const photo1=Sy.simulateCamera(sheet1,{w:1280,h:1450,corners:[[190,120],[1080,94],[1110,1330],[160,1350]],noise:8,vignette:0.18});
    const d1=detect(photo1);
    ok('the single QR locates a photographed page',!!d1,
      d1&&d1.found.qrQuality?d1.found.qrQuality.pixels+'px QR':'not found');
    if(d1){
      ok('QR geometry path was used instead of legacy border detection',
        d1.found.markers===1&&d1.found.qrPacket&&d1.found.qrPacket.geometry===3,'markers='+d1.found.markers);
      ok('page one keeps transitional student ID while QR owns page identity',
        d1.ident.code==='042'&&d1.ident.page===1&&d1.ident.sid==='027',
        JSON.stringify({code:d1.ident.code,page:d1.ident.page,sid:d1.ident.sid}));
      const ans=V.decodeAnswers(d1.cap.g,photo1.width,photo1.height,d1.H,d1.white,pages[0]);
      let wrong=0;pages[0].mc.forEach(it=>{if(ans.answers[it.q]!==key[it.q])wrong++;});
      ok('QR-derived geometry still reads the answer grid',wrong===0,wrong+' wrong of '+pages[0].mc.length);
    }

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
