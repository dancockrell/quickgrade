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
/* An optional substring argument runs only the suites whose names match.
 * The full set takes ten minutes, which is long enough that a person
 * checking one thing will skip running it at all. */
const only = process.argv[2];
const suites = (fs.readdirSync(DIR)
  .filter(f => /^(test-.*|runtests)\.js$/.test(f))
  .sort())
  .filter(f => !only || f.indexOf(only) >= 0);

let total = 0, failed = 0;
const broken = [];
const skippedList = [];

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
  /* Exit code 2 is the agreed "this needs hardware I do not have" signal.
   * Reported every time, never counted as passing, never as failing: a suite
   * that silently passes without running is the same bug as one that asserts
   * nothing. */
  const skipped = code === 2;
  /* A suite that asserted nothing is a failure, not a note.
   *
   * It printed '(asserted nothing - look at it)' beside a green line and was
   * counted as passing, which is the exact shape of the defect this runner
   * exists to catch: an absent result and a negative result print the same,
   * and the absent one looks like success. A suite exits 0 having run no
   * assertions for only one interesting reason - it fell over before it got
   * there - and the count of checks is the fragile number, the one that goes
   * to zero when the mechanism breaks. So it is the one to assert on.
   *
   * Exit code 2 still means 'needed hardware I do not have' and is exempt,
   * because that suite has said so deliberately. */
  const assertedNothing = !skipped && n === 0;
  const bad = !skipped && (code !== 0 || fails > 0 || jsonFailed > 0 || jsonErr ||
                           assertedNothing);

  total += n;
  if (skipped) skippedList.push(f);
  else if (bad) { failed++; broken.push(f); }

  /* console.log has no width specifiers, so pad by hand. */
  console.log('  ' + (skipped ? 'skip' : bad ? 'FAIL' : ' ok ') + '  ' +
    f.replace(/\.js$/, '').padEnd(20) +
    String(n).padStart(4) + ' checks ' + String(ms).padStart(7) + ' ms' +
    (skipped
      ? '   ' + (out.split('\n').find(l => l.trim()) || '').trim().slice(0, 58)
      : assertedNothing ? '   asserted nothing' : ''));
  if (bad) {
    out.split('\n').filter(l => /FAIL|error|Error/.test(l)).slice(0, 4)
      .forEach(l => console.log('        ' + l.trim().slice(0, 130)));
  }
}

console.log('\n  ' + suites.length + ' suites, ' + total + ' checks, ' +
  (failed ? failed + ' FAILING: ' + broken.join(', ') : 'all passing') +
  (skippedList.length
    ? '  (' + skippedList.length + ' skipped: ' +
      skippedList.map(f => f.replace(/\.js$/, '')).join(', ') + ')'
    : ''));
process.exit(failed ? 1 : 0);
