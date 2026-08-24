const { chromium } = require('playwright');
const OUT = process.argv[2], LANG = process.argv[3], VIEW = process.argv[4] || 'tests';
(async () => {
  const b = await chromium.launch();
  const p = await (await b.newContext({viewport:{width:1280,height:900}})).newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message));
  await p.goto('http://127.0.0.1:5200/index.html',{waitUntil:'networkidle'});
  await p.waitForTimeout(700);
  await p.evaluate(async (a)=>{ QG.I18N.set(a[0]); await new Promise(r=>setTimeout(r,300)); QG.App.route(a[1]); await new Promise(r=>setTimeout(r,300)); }, [LANG, VIEW]);
  await p.screenshot({path: OUT});
  console.log(LANG, VIEW, 'errors:', errs.length?errs.join('|'):'none');
  await b.close();
})();
