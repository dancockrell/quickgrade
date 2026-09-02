/* The generated things must match what is actually on disk.
 *
 * build.py derives the service worker's cache name and precache list, and
 * inlines everything into QuickGrade.html. All three go stale silently: the
 * app keeps working in development while a released copy is wrong. */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const res = [];
const ok = (n, pass, d) => res.push({ n, pass: !!pass, d });

const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

/* Rebuild into a scratch copy and compare, so a forgotten build is caught. */
const before = { sw: read('sw.js'), out: read('QuickGrade.html') };
/* Finding a working interpreter on Windows takes more than a name.
 *
 * The bare 'python' and 'python3' on PATH here are the Store aliases: they
 * advertise the Store on stderr and exit without running anything, and 'py'
 * is not installed at all. Meanwhile a path that looks like a real
 * interpreter is not necessarily a working one. The conda install on this
 * machine cannot start from a child process at all ("Could not find platform
 * independent libraries") because it needs its own directories on PATH for
 * its DLLs, which it has when launched from a conda shell and not otherwise.
 *
 * So candidates are not trusted by name or by existing on disk. Each one is
 * asked to print something first, and only an interpreter that answers gets
 * to run build.py. */
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const PYTHONS = [process.env.QG_PYTHON, 'py', 'python3', 'python',
                 HOME + '/AppData/Local/Programs/Python/Python313/python.exe',
                 HOME + '/anaconda3/python.exe',
                 HOME + '/miniconda3/python.exe'].filter(Boolean);
let built = false, usedPython = '', buildErr = '', foundPython = false;
for (const exe of PYTHONS) {
  let out;
  try {
    out = execFileSync(exe, ['-c', 'print(1)'], { encoding: 'utf8', stdio: 'pipe' });
  } catch (e) { continue; }              // absent, or cannot start
  if (!/^1/.test(out)) continue;         // answered, but not with Python
  foundPython = true;
  try {
    execFileSync(exe, ['build.py'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    built = true;
    usedPython = exe;
  } catch (e) {
    /* A working interpreter that could not run build.py is a real failure,
     * and the report has to carry the reason rather than a bare FAIL. */
    buildErr = String(e.stderr || e.message || '').trim().split('\n').pop();
  }
  break;
}

if (!foundPython) {
  /* No interpreter at all is not a defect in this repo. Saying so plainly
   * beats a red line that a contributor learns to scroll past. */
  console.log('  note  build.py not exercised: no working Python found'
    + ' (set QG_PYTHON to point at one)');
} else {
  ok('build.py runs', built, built ? usedPython : buildErr || 'failed with no output');
}


if (built) {
  const after = { sw: read('sw.js'), out: read('QuickGrade.html') };
  ok('sw.js is up to date with the source files', after.sw === before.sw,
    after.sw === before.sw ? 'in sync' : 'was stale — build.py changed it');
  ok('QuickGrade.html is up to date', after.out === before.out,
    after.out === before.out ? 'in sync' : 'was stale — build.py changed it');

  /* A second build must be byte-for-byte stable. This specifically catches
   * cache hashes that depend on generated output or checkout line endings and
   * otherwise make Actions commit a new bundle after every green run. */
  execFileSync(usedPython, ['build.py'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
  const stable = read('sw.js') === after.sw && read('QuickGrade.html') === after.out;
  ok('a second build is idempotent', stable,
    stable ? 'byte-for-byte stable' : 'generated output changed on an identical second build');
}

const sw = read('sw.js');
const index = read('index.html');

/* Every module index.html loads must be precached, or offline is broken in a
 * way that only shows up offline. */
const wanted = [...index.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)].map(m => m[1]);
const missing = wanted.filter(f => !sw.includes("'./" + f + "'"));
ok('every script index.html loads is precached', missing.length === 0,
  missing.slice(0, 5).join(', ') || wanted.length + ' scripts');

ok('the cache name is content-derived, not a hand-typed version',
  /var CACHE = 'quickgrade-[0-9a-f]{12}';/.test(sw),
  (sw.match(/var CACHE = '[^']*'/) || ['?'])[0]);

/* The single file has to be genuinely standalone.
 *
 * What counts is whether the browser would go and fetch something, so this
 * looks for values that name a place to fetch from and ignores the rest. The
 * naive version matched any src= or href= in the file, including ones inside
 * inlined JavaScript: a line building an image tag as
 *   '<img src="' + E(logo) + '">'
 * was reported as an external reference to the literal text ' + E(logo) + '.
 * That is a string being assembled at runtime from a data URI, and there is
 * nothing there to fetch. */
const out = read('QuickGrade.html');
const externals = [...out.matchAll(/(?:src|href)="((?!data:|#)[^"]+)"/g)]
  .map(m => m[1])
  .filter(u => !/^https:\/\/fonts\./.test(u))
  /* a value containing quote-plus or plus-quote is JavaScript concatenation,
   * not a URL: no path or scheme can contain those */
  .filter(u => !/['+]/.test(u))
  /* and an empty or whitespace-only value fetches nothing */
  .filter(u => u.trim().length > 0);
ok('the single file has no external references', externals.length === 0,
  externals.slice(0, 4).join(', ') || 'self-contained');

let failed = 0;
for (const r of res) {
  if (!r.pass) failed++;
  console.log('  ' + (r.pass ? 'ok   ' : 'FAIL ') + r.n + (r.d != null ? '  — ' + r.d : ''));
}
console.log('\n  ' + (failed ? failed + ' problem(s)' : 'build output is in sync'));
process.exit(failed ? 1 : 0);
