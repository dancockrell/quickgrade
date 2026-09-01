/* Page 1 starts a packet; another page 1 must warn while pages are missing. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.QG && QG.PacketFlow, null, { timeout: 10000 });

  const out = await page.evaluate(() => {
    const R = {}; const ok = (n,c,d) => R[n]={pass:!!c,d};
    const F = QG.PacketFlow;
    F.reset();
    ok('starts with no active packet', F.active === null);

    const p1 = { testId:'t1', code:'042', form:null, page:1, sid:'27', packet:{total:4} };
    F.observe(p1, { status:'ok', name:'Avery Nguyen', missingPages:[2,3,4] });
    ok('page one opens a four-page packet',
      F.active && F.active.name === 'Avery Nguyen' && F.active.missing.join(',') === '2,3,4',
      F.label());

    const same = F.wouldAdvance({ testId:'t1', code:'042', form:null, page:1, sid:'027' });
    ok('rescanning the same student page one is not a false warning', same === null);

    const next = F.wouldAdvance({ testId:'t1', code:'042', form:null, page:1, sid:'28' });
    ok('a different page one warns before the packet is finished',
      next && next.name === 'Avery Nguyen' && next.missingPages.join(',') === '2,3,4',
      next && next.missingPages.join(','));

    ok('same version continuation is allowed',
      F.packetConflict({ testId:'t1', code:'042', form:null, page:2, sid:'27' }) === null);
    const mixed = F.packetConflict({ testId:'t1', code:'043', form:'B', page:2, sid:'27' });
    ok('different version continuation is rejected before routing',
      mixed && mixed.expectedCode === '042' && mixed.gotCode === '043',
      mixed && mixed.expectedCode + ' vs ' + mixed.gotCode);

    F.observe({ testId:'t1', code:'042', form:null, page:3, sid:'27' },
      { status:'ok', name:'Avery Nguyen', missingPages:[2,4] });
    ok('pages may arrive out of order inside one packet',
      F.active && F.active.missing.join(',') === '2,4', F.label());

    F.observe({ testId:'t1', code:'042', form:null, page:2, sid:'27' },
      { status:'ok', name:'Avery Nguyen', missingPages:[4] });
    F.observe({ testId:'t1', code:'042', form:null, page:4, sid:'27' },
      { status:'ok', name:'Avery Nguyen', complete:true, missingPages:[] });
    ok('the packet closes automatically when all pages are present', F.active === null);

    const after = F.wouldAdvance({ testId:'t1', code:'042', form:null, page:1, sid:'28' });
    ok('the next student starts clean after completion', after === null);

    F.observe({ testId:'t1', code:'042', form:null, page:1, sid:null, packet:{total:3} },
      { status:'no-id' });
    ok('an unidentified page one still opens a packet instead of losing continuity',
      F.active && F.active.sid === null && F.active.missing.join(',') === '2,3', F.label());
    const unknownNext = F.wouldAdvance({ testId:'t1', code:'042', form:null, page:1, sid:null });
    ok('unknown identity errs toward warning rather than silently abandoning pages',
      unknownNext && unknownNext.missingPages.join(',') === '2,3');
    F.reset();
    return R;
  });

  let bad=0;
  for(const [k,v] of Object.entries(out)){if(!v.pass)bad++;console.log((v.pass?'PASS  ':'FAIL  ')+k+(v.d!=null?' — '+v.d:''));}
  console.log('\n'+(bad?bad+' FAILED':'all '+Object.keys(out).length+' passed'));
  if(errs.length)console.log('page errors:',errs.slice(0,5));
  await browser.close();
  process.exit(bad?1:0);
})();
