/* Prove that the suite runner cannot turn an ordinary crash into a skip. */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qg-check-'));
let failed = 0;
function check(name, pass) {
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name);
  if (!pass) failed++;
}
function run(name) {
  fs.writeFileSync(path.join(dir, name), 'process.exit(2);\n');
  try {
    return { code: 0, out: execFileSync(process.execPath,
      [path.join(__dirname, 'check.js')],
      { encoding: 'utf8', env: Object.assign({}, process.env, { QG_CHECK_DIR: dir }) }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  } finally {
    fs.unlinkSync(path.join(dir, name));
  }
}

const ordinary = run('test-ordinary.js');
check('exit 2 from an ordinary suite fails the gate',
  ordinary.code === 1 && /test-ordinary/.test(ordinary.out) && /FAILING/.test(ordinary.out));
const hardware = run('test-android.js');
check('the named hardware suite may explicitly skip',
  hardware.code === 0 && /skipped: test-android/.test(hardware.out));
fs.rmdirSync(dir);
process.exit(failed ? 1 : 0);
