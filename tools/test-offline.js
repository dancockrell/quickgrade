/* Offline is the feature this app is pitched on, and until now the only line
 * that delivers it swallowed its own failure:
 *
 *     navigator.serviceWorker.register('sw.js').catch(function () {});
 *
 * Two red team sessions found the same thing independently, one of them by
 * hitting it accidentally in a browser where registration failed for
 * environment reasons. The page rendered perfectly, every control worked, and
 * nothing anywhere said offline mode had not installed. Neither could the app.
 *
 * The README names locked-down district laptops as a reason to want offline,
 * which is exactly the fleet where a policy disables service workers, so the
 * silent case is the likely one rather than the exotic one.
 *
 * These cases block the service worker outright and check the app notices.
 */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

(async () => {
  const browser = await chromium.launch();
  const res = {};
  const ok = (n, c, d) => res[n] = { pass: !!c, d };

  /* Deny registration, which is what a device policy looks like from the
   * page.
   *
   * Two earlier sabotages did not land, and each one failed against correct
   * code while looking like a real defect. serviceWorkers:'block' still lets
   * register() RESOLVE. page.route('**\/sw.js') does not intercept it either,
   * because that request comes from the service worker machinery rather than
   * from the page. Hence the first assertion below: the sabotage has to prove
   * it landed before anything after it means a thing. */
  const blocked = await browser.newContext();
  const page = await blocked.newPage();
  await page.addInitScript(() => {
    if (navigator.serviceWorker) {
      Object.defineProperty(navigator.serviceWorker, 'register', {
        configurable: true,
        value: () => Promise.reject(new Error('blocked by policy'))
      });
    }
  });
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(4200);

  ok('the sabotage landed: the worker script really was refused',
    await page.evaluate(() => window.__swState === 'failed'),
    'state=' + await page.evaluate(() => window.__swState || 'unresolved'));

  const banner = await page.evaluate(() => {
    const box = document.getElementById('storageWarn');
    return { hidden: box ? box.hidden : null,
             text: box ? box.textContent.trim() : '',
             state: window.__swState || 'unresolved' };
  });
  ok('registration failure is recorded rather than swallowed',
    banner.state !== 'ok', 'state=' + banner.state);
  ok('the app tells the teacher offline mode is not available',
    banner.hidden === false && banner.text.length > 20,
    banner.hidden === false ? JSON.stringify(banner.text.slice(0, 64)) : 'no banner shown');
  ok('and does not leave an untranslated key on screen',
    banner.text.indexOf('offline.') < 0, JSON.stringify(banner.text.slice(0, 48)));
  /* Registration only runs on http(s), so everyone who ever sees this banner
   * is already hosted. It used to borrow storage.headsUp, whose wrapper ends
   * "Close this and run Start QuickGrade.bat instead" - which sends the exact
   * teacher this banner exists for, on the locked-down laptop most likely to
   * block service workers, to run the .bat file that laptop most likely
   * blocks too. Found by re-verification against a browser where registration
   * genuinely fails, not by a stub. */
  ok('the remedy does not point at a launcher a hosted reader cannot use',
    !/\.bat/i.test(banner.text), JSON.stringify(banner.text));
  ok('the rest of the app still works without it',
    await page.evaluate(() => !!(window.QG && QG.App && QG.App.State)),
    'QG.App present');
  await blocked.close();

  /* And the healthy case must NOT nag: a check that always fires is as empty
   * as one that never does. */
  const allowed = await browser.newContext();
  const page2 = await allowed.newPage();
  await page2.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(4200);
  const quiet = await page2.evaluate(() => {
    const box = document.getElementById('storageWarn');
    return { hidden: box ? box.hidden : null, state: window.__swState || 'unresolved',
             text: box ? box.textContent.trim() : '' };
  });
  ok('a working install registers', quiet.state === 'ok', 'state=' + quiet.state);
  ok('and raises no offline warning', quiet.hidden !== false || !/offline/i.test(quiet.text),
    'hidden=' + quiet.hidden + ' ' + JSON.stringify(quiet.text.slice(0, 40)));
  await allowed.close();

  /* The install itself used to resolve whatever happened: Promise.all over
   * add().catch(noop) cannot reject, so skipWaiting() ran on a cache holding
   * 26 files or none. Assert the source now counts what landed. */
  const sw = await (await fetch(BASE + '/sw.js')).text();
  ok('the install counts what actually cached',
    /results\.filter\(Boolean\)/.test(sw) && /throw new Error\('offline install incomplete/.test(sw),
    'counts=' + /results\.filter\(Boolean\)/.test(sw));
  ok('and refuses to activate without the page shell',
    /indexOf\('\.\/index\.html'\) >= 0/.test(sw), 'shell guard present');
  ok('a navigation with nothing cached explains itself instead of failing bare',
    /QuickGrade cannot load/.test(sw) && /503/.test(sw), 'fallback response present');

  let failed = 0;
  for (const [name, r] of Object.entries(res)) {
    if (!r.pass) failed++;
    console.log('  ' + (r.pass ? 'PASS' : 'FAIL') + '  ' + name + (r.d ? '  — ' + r.d : ''));
  }
  console.log('\n' + (failed ? failed + ' problem(s)' : 'all clear'));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
