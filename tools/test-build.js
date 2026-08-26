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
/* Windows ships a bare 'python' alias that only advertises the Store and
 * writes a paragraph to stderr, so try the real interpreters first and keep
 * that noise out of the report. */
const PYTHONS = [process.env.QG_PYTHON, 'py', 'python3', 'python',
                 'C:/Users/Admin/anaconda3/python.exe'].filter(Boolean);
let built = false;
for (const exe of PYTHONS) {
  try {
    execFileSync(exe, ['build.py'], { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' });
    built = true;
    break;
  } catch (e) { /* try the next one */ }
}
ok('build.py runs', built);

if (built) {
  const after = { sw: read('sw.js'), out: read('QuickGrade.html') };
  ok('sw.js is up to date with the source files', after.sw === before.sw,
    after.sw === before.sw ? 'in sync' : 'was stale — build.py changed it');
  ok('QuickGrade.html is up to date', after.out === before.out,
    after.out === before.out ? 'in sync' : 'was stale — build.py changed it');
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

/* The single file has to be genuinely standalone. */
const out = read('QuickGrade.html');
const externals = [...out.matchAll(/(?:src|href)="((?!data:|#)[^"]+)"/g)]
  .map(m => m[1])
  .filter(u => !/^https:\/\/fonts\./.test(u));
ok('the single file has no external references', externals.length === 0,
  externals.slice(0, 4).join(', ') || 'self-contained');

let failed = 0;
for (const r of res) {
  if (!r.pass) failed++;
  console.log('  ' + (r.pass ? 'ok   ' : 'FAIL ') + r.n + (r.d != null ? '  — ' + r.d : ''));
}
console.log('\n  ' + (failed ? failed + ' problem(s)' : 'build output is in sync'));
process.exit(failed ? 1 : 0);
