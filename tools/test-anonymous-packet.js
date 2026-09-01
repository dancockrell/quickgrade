/* A student can write no machine identity at all; the packet must still survive. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:1400,height:900} });
  const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil:'networkidle' });
  await page.waitForFunction(()=>window.QG&&QG.PacketFlow,null,{timeout:10000});

  const out = await page.evaluate(async () => {
    const R={}; const ok=(n,c,d)=>R[n]={pass:!!c,d};
    const S=QG.Sheet,Sy=QG.Synth;
    const key=Array.from({length:180},(_,i)=>i%5);
    const t={id:'anonpacket',title:'Anonymous packet',className:'C',classes:['C'],date:'2026-09-01',code:'511',
      mc:{count:180,choices:5,key:key,points:1,text:[],options:[],topic:[],rules:{}},written:[],curve:{kind:'none',value:0},
      options:{prefillId:false,idDigits:3,paper:'letter',wPerPage:2,instructions:'',scale:[[0,'F']],footer:'',topsheet:{}}};
    await QG.DB.put('tests',t);
    await QG.DB.put('students',{sid:'1',name:'Avery Nguyen',cls:'C',email:''});
    QG.App.State.students=await QG.DB.all('students');
    await QG.App.selectTest(t); QG.PacketFlow.reset();
    const pages=S.layoutTest(t);
    ok('fixture is a multi-page packet',pages.length>1,pages.length+' pages');

    const files=[];
    for(let pi=0;pi<pages.length;pi++){
      const ans={};pages[pi].mc.forEach(it=>ans[it.q]=key[it.q]);
      const sheet=Sy.renderSynthetic(t,pi,{sid:'',name:'',answers:ans});
      const photo=Sy.simulateCamera(sheet,{w:1280,h:1450,
        corners:pi%2?[[165,105],[1095,125],[1070,1335],[180,1320]]:[[185,120],[1080,95],[1105,1325],[160,1345]],
        noise:7,vignette:0.17});
      files.push(await Sy.canvasToFile(photo,'page-'+(pi+1)+'.jpg'));
    }
    await QG.Scanner.importFiles(files,{quiet:true});
    const St=QG.App.State;
    ok('every page was retained',St.scans.length===pages.length,St.scans.length+' of '+pages.length);
    const ids=[...new Set(St.scans.map(s=>s.sid))];
    ok('all pages share one internal packet identity',ids.length===1&&!!ids[0],ids.join(','));
    ok('the internal identity is explicitly marked unassigned',
      St.scans.every(s=>s.packetUnassigned===true&&s.packet&&s.packet.geometry===3));
    ok('all page numbers survived independently',
      St.scans.map(s=>s.page).sort((a,b)=>a-b).join(',')===pages.map((_,i)=>i+1).join(','),
      St.scans.map(s=>s.page).sort((a,b)=>a-b).join(','));
    ok('packet closes when its final page arrives',QG.PacketFlow.active===null);
    ok('ownership is still unresolved rather than guessed',
      St.results.unresolved.length===pages.length,St.results.unresolved.length+' unresolved pages internally');

    QG.App.route('review');
    await new Promise(r=>setTimeout(r,350));
    const visible=[...document.querySelectorAll('#unresolvedBox .unrow')].filter(r=>!r.hidden);
    ok('Review shows one unresolved packet, not one row per page',visible.length===1,visible.length+' visible rows');
    ok('Review does not expose the temporary packet number',
      visible.length===1&&!visible[0].textContent.includes(ids[0]),visible[0]&&visible[0].textContent.slice(0,100));

    if(visible.length===1){
      const sel=visible[0].querySelector('select');
      const assign=visible[0].querySelector('button.go');
      sel.value='1'; assign.click();
      await new Promise(r=>setTimeout(r,500));
      ok('one Review assignment reassigns every page in the packet',
        St.scans.length===pages.length&&St.scans.every(s=>s.sid==='1'&&!s.packetUnassigned),
        [...new Set(St.scans.map(s=>s.sid))].join(','));
      ok('resolved packet leaves no unmatched pages',St.results.unresolved.length===0,
        St.results.unresolved.length+' unresolved');
    }
    return R;
  });
  let bad=0;for(const[k,v]of Object.entries(out)){if(!v.pass)bad++;console.log((v.pass?'PASS  ':'FAIL  ')+k+(v.d!=null?' — '+v.d:''));}
  if(errs.length)console.log('page errors:',errs.slice(0,5));
  await browser.close();process.exit(bad?1:0);
})();
