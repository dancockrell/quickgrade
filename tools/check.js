/* Run every suite and report one number.
 *
 *   node tools/check.js
 *
 * It discovers suites rather than listing them, because the one time a suite
 * was left out of a hand-written list it sat broken for a whole session while
 * everything else reported green.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const suites = fs.readdirSync(DIR)
  .filter(f => /^(test-.*|runtests)\.js$/.test(f))
  .sort();

let total = 0, failed = 0;
const broken = [];

console.log('QuickGrade — full check\n');
for (const f of suites) {
  let out = '', code = 0;
  const t0 = Date.now();
  try {
    out = execFileSync(process.execPath, [path.join(DIR, f)], { encoding: 'utf8' });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    code = e.status == null ? 1 : e.status;
  }
  const ms = Date.now() - t0;

  /* Suites report in three different shapes; count all of them rather than
   * assuming one, which is how a suite asserting nothing looked like a pass. */
  const passes = (out.match(/^\s*(PASS|ok)\b/gm) || []).length;
  const fails = (out.match(/^\s*(FAIL|!)\s/gm) || []).length;
  const json = out.match(/"total":\s*(\d+)/g);
  const jsonTotal = json ? json.reduce((a, m) => a + Number(m.match(/(\d+)/)[1]), 0) : 0;
  const jsonFailed = (out.match(/"failed":\s*(\d+)/g) || [])
    .reduce((a, m) => a + Number(m.match(/(\d+)/)[1]), 0);
  const jsonErr = /"error"/.test(out);

  const n = passes + jsonTotal;
  const bad = code !== 0 || fails > 0 || jsonFailed > 0 || jsonErr;

  total += n;
  if (bad) { failed++; broken.push(f); }

  /* console.log has no width specifiers, so pad by hand. */
  console.log('  ' + (bad ? 'FAIL' : ' ok ') + '  ' +
    f.replace(/\.js$/, '').padEnd(20) +
    String(n).padStart(4) + ' checks ' + String(ms).padStart(7) + ' ms' +
    (n === 0 && !bad ? '   (asserted nothing — look at it)' : ''));
  if (bad) {
    out.split('\n').filter(l => /FAIL|error|Error/.test(l)).slice(0, 4)
      .forEach(l => console.log('        ' + l.trim().slice(0, 130)));
  }
}

console.log('\n  ' + suites.length + ' suites, ' + total + ' checks, ' +
  (failed ? failed + ' FAILING: ' + broken.join(', ') : 'all passing'));
process.exit(failed ? 1 : 0);
