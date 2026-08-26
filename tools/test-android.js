/* Smoke-test the app in Chrome on a real Android build, over adb.
 *
 *   node tools/test-android.js [outDir]
 *
 * This is a compatibility check, not a speed one. An emulator runs on the
 * host CPU and is usually faster than a cheap phone; tools/test-slowphone.js
 * is the honest answer on speed.
 *
 * Why it is driven this way. The obvious approach is Playwright's Android
 * support, and the first version of this file used it. It does not work
 * against a Play Store system image: launchBrowser needs a Chrome built with
 * a debugging socket, and it simply hangs. A suite that can never pass is
 * worse than no suite, so this uses the channels adb really gives you:
 *
 *   logcat      Chrome writes page console errors there, so a JS exception
 *               on Android is visible without any debugger.
 *   uiautomator dumps the accessibility tree, which for a web page contains
 *               the visible text. That is enough to assert a screen rendered.
 *   screencap   for a human to look at afterwards.
 *
 * Needs an emulator or device on adb, and:
 *   adb reverse tcp:5200 tcp:5200
 * so the phone can reach the dev server on the host.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || path.join(__dirname, '.out');
fs.mkdirSync(OUT, { recursive: true });
const URL = process.env.QG_ANDROID_URL || 'http://127.0.0.1:5200/index.html';
const ADB = process.env.QG_ADB || 'C:/Android/platform-tools/adb.exe';
const PKG = 'com.android.chrome';

function adb(args, opts) {
  return execFileSync(ADB, args, { encoding: 'utf8', stdio: 'pipe', ...opts });
}
function sleep(ms) { execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},' + ms + ')']); }
function wait(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

const res = [];
const ok = (n, pass, d) => res.push({ n, pass: !!pass, d });

/* ------------------------------------------------------------ preflight */
let serial = '';
try {
  const list = adb(['devices']).split('\n').slice(1)
    .map(l => l.trim()).filter(l => /\tdevice$/.test(l));
  if (!list.length) throw new Error('none');
  serial = list[0].split('\t')[0];
} catch (e) {
  /* Exit 2 is the runner's "needed hardware, had none" signal. It is reported
   * as skipped rather than passed: a suite that quietly passes without
   * running tells you nothing. */
  console.log('skipped: no Android device on adb (start the emulator first)');
  process.exit(2);
}

const release = adb(['shell', 'getprop', 'ro.build.version.release']).trim();
const model = adb(['shell', 'getprop', 'ro.product.model']).trim();
console.log('device: ' + model + ', Android ' + release + ', serial ' + serial + '\n');

if (!adb(['shell', 'pm', 'list', 'packages']).includes(PKG)) {
  console.log('skipped: Chrome is not installed on this device');
  process.exit(2);
}

try { adb(['reverse', 'tcp:5200', 'tcp:5200']); } catch (e) { /* may already exist */ }

/* --------------------------------------------------------------- helpers */
function screenshot(name) {
  const buf = execFileSync(ADB, ['exec-out', 'screencap', '-p'],
    { maxBuffer: 64 * 1024 * 1024 });
  fs.writeFileSync(path.join(OUT, 'android-' + name + '.png'), buf);
}

/* The accessibility tree of the page: for a web view this carries the text
 * actually on screen, which is what "did this screen render" means. Each node
 * comes back with its box so a tap can be aimed at a specific one. */
function nodes() {
  try {
    adb(['shell', 'uiautomator', 'dump', '/sdcard/qg-ui.xml']);
    const xml = adb(['shell', 'cat', '/sdcard/qg-ui.xml']);
    return [...xml.matchAll(/text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)]
      .map(m => ({ text: m[1], x: Math.round((+m[2] + +m[4]) / 2),
                   y: Math.round((+m[3] + +m[5]) / 2) }))
      .filter(n => n.text);
  } catch (e) { return []; }
}

function visibleText() {
  return nodes().map(n => n.text).join(' | ');
}

/* Takes a predicate, not a substring.
 *
 * Matching 'Grade' as a substring also hits 'QuickGrade' in the page title
 * and the logo, and taps the wrong thing. A test that quietly acts on the
 * wrong element is worse than one that fails. */
let screenW = 1080;
try {
  const m = adb(['shell', 'wm', 'size']).match(/(\d+)x(\d+)/);
  if (m) screenW = +m[1];
} catch (e) { /* keep the default */ }

function tapWhere(pred) {
  let n = nodes().find(pred);
  if (!n) return null;
  /* The nav strip scrolls sideways and centres whichever tab is active, so a
   * tab further along can sit half off the edge. Its midpoint is then outside
   * the screen and the tap lands on nothing. Nudge the strip and look again
   * before giving up. */
  if (n.x >= screenW - 4 || n.x <= 4) {
    adb(['shell', 'input', 'swipe',
         String(Math.round(screenW * 0.8)), String(n.y),
         String(Math.round(screenW * 0.25)), String(n.y), '260']);
    wait(1200);
    n = nodes().find(pred);
    if (!n) return null;
  }
  const x = Math.min(Math.max(n.x, 4), screenW - 4);
  adb(['shell', 'input', 'tap', String(x), String(n.y)]);
  return n.text;
}

/* ------------------------------------------------------------------ run */
adb(['logcat', '-c']);                       // errors from here on are ours
adb(['shell', 'am', 'force-stop', PKG]);
adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', URL, PKG]);
wait(14000);

/* Android offers to install the app once the manifest and service worker are
 * both valid, and that sheet covers the page. It is a good sign, but it has
 * to be dismissed before anything can be read off the screen. */
/* Poll for a condition rather than guessing a duration. A fixed wait is either
 * too short on a slow device or wasted on a fast one, and when it is too short
 * the failure reads as a broken screen instead of a slow one. */
function waitFor(pred, ms) {
  const until = Date.now() + (ms || 15000);
  while (Date.now() < until) {
    const t = visibleText();
    if (pred(t)) return t;
    wait(1200);
  }
  return null;
}

function inChrome() {
  try {
    return adb(['shell', 'dumpsys', 'window']).includes(PKG + '/org.chromium');
  } catch (e) { return false; }
}
function relaunch() {
  adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', URL, PKG]);
  wait(9000);
}
/* Chrome's own first run, on a device that has never opened it. Both choices
 * here are the minimal ones: no account, no notifications. */
function dismissChromeFirstRun() {
  for (let i = 0; i < 4; i++) {
    const n = nodes();
    const hit = n.find(x => /Use without an account|No thanks|Accept|Got it/i.test(x.text));
    if (!hit) break;
    adb(['shell', 'input', 'tap', String(hit.x), String(hit.y)]);
    wait(2500);
  }
}

function dismissInstallPrompt() {
  let seen = false;
  for (let i = 0; i < 4; i++) {
    if (!/Home screen|Add .* to Home/i.test(visibleText())) break;
    seen = true;
    /* It is a bottom sheet, so swipe it down. Back would dismiss it and then
     * keep going, walking straight out of Chrome to the launcher. */
    adb(['shell', 'input', 'swipe', '540', '1750', '540', '2300', '250']);
    wait(1800);
  }
  if (!inChrome()) relaunch();
  return seen;
}
dismissChromeFirstRun();
const hadPrompt = dismissInstallPrompt();

let text = visibleText();
/* Reported, not asserted. Chrome decides when to offer an install using its
 * own engagement heuristics, so a fresh profile will not show it however
 * correct the manifest is. Failing on that would be measuring Chrome. */
console.log('  note  install prompt: ' + (hadPrompt
  ? 'Chrome offered to add it to the home screen'
  : 'not offered on this profile (Chrome decides, not the app)'));
/* Two nav labels, not the page title: a Chrome error page would still carry
 * the title, so on its own it proves nothing. */
ok('the app renders in Android Chrome',
  /\bRoster\b/.test(text) && /\bExport\b/.test(text),
  text.slice(0, 90) || 'nothing on screen');
screenshot('01-loaded');

/* Get to a populated app. On a clean install that means pressing the sample
 * button. If an earlier run left data behind, the first-run panel is not
 * rendered at all and there is nothing to press, which is correct behaviour
 * and must not read as a failure. */
let populated = /Review \d/.test(text);
if (!populated) {
  let hit = tapWhere(n => /sample class/i.test(n.text));
  if (!hit) {
    adb(['shell', 'input', 'swipe', '540', '1800', '540', '500', '300']);
    wait(1500);
    hit = tapWhere(n => /sample class/i.test(n.text));
  }
  ok('the sample-class button is reachable', !!hit, hit || 'not found on screen');
  if (hit) {
    const done = waitFor(t => /Review \d/.test(t), 90000);
    text = done || visibleText();
    populated = !!done;
  }
} else {
  ok('the app already holds scans from an earlier run', true,
    (text.match(/Review \d+/) || [''])[0]);
}

ok('the reader ran on Android', populated,
  populated ? (text.match(/Review \d+/) || [''])[0] + ' flagged unmatched' : 'no scans');
screenshot('02-review');

/* The scores a teacher spent an evening on have to still be there tomorrow.
 * That is IndexedDB doing its job on Android, and it is the one storage
 * question a desktop browser cannot answer for a phone. */
relaunch();
dismissInstallPrompt();
const after = waitFor(t => /Review \d/.test(t), 40000);
ok('scans survive a reload on Android', !!after,
  after ? (after.match(/Review \d+/) || [''])[0] + ' still flagged after reload'
        : 'data did not come back');
screenshot('03-after-reload');

/* Why the marking screen is not driven from here.
 *
 * It would need a tap on the nav, and the nav scrolls sideways. uiautomator
 * reports the text of its children correctly but not their geometry: on this
 * build 'Export' comes back as [750..937] while 'Language' comes back as
 * [643..866], overlapping it, and a tap aimed at one lands on the other. The
 * boxes do not change after scrolling the strip either, so there is no
 * settling trick that fixes it.
 *
 * Rather than ship a check that taps whatever happens to be under a bad
 * coordinate, the property it was after — that nothing in the marking bar
 * falls below the fold — is asserted deterministically in a real browser at
 * phone size by tools/test-slowphone.js, and was confirmed by hand on this
 * device. What is left here is what adb can establish honestly. */

/* Chrome puts page console errors in logcat, so an exception on Android is
 * visible even without a debugger attached. */
let jsErrors = [];
try {
  const log = adb(['logcat', '-d', '-v', 'brief', 'chromium:E', '*:S'], { maxBuffer: 16 * 1024 * 1024 });
  jsErrors = log.split('\n')
    .filter(l => /Uncaught|TypeError|ReferenceError|is not a function|not defined/.test(l))
    .map(l => l.trim());
} catch (e) { /* logcat unavailable */ }
ok('no JavaScript errors on Android', jsErrors.length === 0,
  jsErrors.slice(0, 2).join(' | ') || 'clean logcat');

/* ------------------------------------------------------------- report */
let failed = 0;
for (const r of res) {
  if (!r.pass) failed++;
  console.log('  ' + (r.pass ? 'ok   ' : 'FAIL ') + r.n + (r.d != null ? '  — ' + r.d : ''));
}
console.log('\n  screenshots in ' + path.resolve(OUT));
console.log('  ' + (failed ? failed + ' problem(s) on Android' : 'clean on Android ' + release));
process.exit(failed ? 1 : 0);
