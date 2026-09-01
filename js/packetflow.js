/* QuickGrade — packetflow.js
 *
 * A physical test is a packet. Page 1 starts it; pages 2..N belong to that
 * packet until it is complete. This layer does not change scoring or storage.
 * It watches the scanner's existing save boundary and makes the dangerous
 * action visible: starting another page 1 while the previous packet is still
 * missing pages.
 */
(function (global) {
'use strict';
var Q = global.QG, Scanner = Q && Q.Scanner;
if (!Q || !Scanner || !Scanner.hooks || !Scanner.hooks.saveScan) return;
var T = Q.T;

var active = null;

function normSid(s) {
  return Q.Sheet && Q.Sheet.normId ? Q.Sheet.normId(s) : String(s || '');
}
function sameStudent(a, b) {
  var aa = normSid(a), bb = normSid(b);
  return !!aa && !!bb && aa === bb;
}
function cloneMissing(a) { return (a || []).map(Number).filter(function (n) { return n > 0; }); }
function packetTotal(record) {
  var p = record && record.packet;
  if (p && p.total) return +p.total;
  var pages = Scanner.hooks.getPages && Scanner.hooks.getPages();
  return pages ? pages.length : 1;
}
function defaultMissing(record) {
  var out = [], n = packetTotal(record);
  for (var i = 1; i <= n; i++) if (i !== +record.page) out.push(i);
  return out;
}

function wouldAdvance(record) {
  if (!active || +record.page !== 1) return null;
  if (active.testId !== record.testId) return null;
  if (!active.missing.length) return null;
  /* Re-photographing page 1 of the same student is a rescan, not the next
   * packet. When identity is unavailable we cannot prove that, so warn: the
   * cost of one visible warning is lower than silently abandoning pages. */
  if (sameStudent(active.sid, record.sid)) return null;
  return { name: active.name, missingPages: active.missing.slice(), sid: active.sid };
}

function start(record, res) {
  active = {
    testId: record.testId,
    code: record.code,
    form: record.form || null,
    sid: normSid(record.sid) || null,
    name: res && res.name || null,
    total: packetTotal(record),
    seen: {},
    missing: []
  };
  active.seen[+record.page] = true;
  active.missing = res && res.missingPages ? cloneMissing(res.missingPages) : defaultMissing(record);
}
function observe(record, res) {
  if (!record || !res || res.status === 'key') return;
  var p = +record.page;
  if (p === 1) {
    start(record, res);
  } else {
    if (!active || active.testId !== record.testId) return;
    active.seen[p] = true;
    if (!active.sid && record.sid) active.sid = normSid(record.sid) || null;
    if (!active.name && res.name) active.name = res.name;
    if (res.missingPages) active.missing = cloneMissing(res.missingPages);
    else active.missing = active.missing.filter(function (n) { return n !== p; });
  }
  if (res.complete || (active && active.missing.length === 0)) active = null;
  render();
}

function label() {
  if (!active) return '';
  var who = active.name || T('names.unassigned');
  if (!active.missing.length) return who + ' · ' + T('scan.complete');
  return who + ' · ' + T('scan.stillNeed', { pages: active.missing.join(', ') });
}
function ensurePill() {
  var row = document.querySelector('#scanHud .hudrow:nth-child(2)');
  if (!row || document.getElementById('pillPacket')) return;
  var p = document.createElement('span');
  p.className = 'pill'; p.id = 'pillPacket'; p.hidden = true;
  var status = document.getElementById('pillStatus');
  row.insertBefore(p, status || null);
}
function render(warn) {
  ensurePill();
  var p = document.getElementById('pillPacket');
  if (!p) return;
  p.hidden = !active;
  p.textContent = label();
  p.className = 'pill' + (warn ? ' bad' : active ? ' ok' : '');
}
function warnAdvance(info) {
  if (!info) return;
  var who = info.name || T('names.unassigned');
  var msg = who + ' · ' + T('scan.stillNeed', { pages: info.missingPages.join(', ') });
  Q.toast(msg, 'err', 7500);
  render(true);
}
function reset() { active = null; render(); }

var legacySave = Scanner.hooks.saveScan;
Scanner.hooks.saveScan = function (record, blobs) {
  var warning = wouldAdvance(record);
  if (warning) warnAdvance(warning);
  return legacySave.call(Scanner.hooks, record, blobs).then(function (res) {
    observe(record, res);
    return res;
  });
};

var legacyReset = Scanner.resetSession;
Scanner.resetSession = function () {
  reset();
  return legacyReset.apply(Scanner, arguments);
};

ensurePill();
Q.PacketFlow = {
  get active() { return active; },
  wouldAdvance: wouldAdvance,
  observe: observe,
  reset: reset,
  label: label
};
})(window);
