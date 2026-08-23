/* QuickGrade — lib.js : DOM helpers, storage, audio, UI primitives */
(function (global) {
'use strict';

/* ---------------------------------------------------------------- DOM */
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
function el(tag, attrs, kids) {
  var n = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    if (k === 'class') n.className = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k === 'text') n.textContent = attrs[k];
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] === true) n.setAttribute(k, '');
    else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
  }
  if (kids) [].concat(kids).forEach(function (c) {
    if (c == null) return;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
}
function on(node, evt, fn) { if (node) node.addEventListener(evt, fn); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function round2(v) { return Math.round(v * 100) / 100; }
function todayISO() {
  var d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2);
}
function prettyDate(iso) {
  if (!iso) return '';
  var p = String(iso).split('-');
  if (p.length !== 3) return iso;
  var d = new Date(+p[0], +p[1] - 1, +p[2]);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}
/** Last, First — for stable roster sorting. */
function sortName(name) {
  var t = String(name || '').trim().split(/\s+/);
  if (t.length < 2) return (name || '').toLowerCase();
  return (t[t.length - 1] + ' ' + t.slice(0, -1).join(' ')).toLowerCase();
}

/* ------------------------------------------------------------ storage
 * IndexedDB when the browser allows it. Opening a file straight off disk
 * (file://) makes the origin opaque and IndexedDB throws, so we fall back to
 * localStorage — scores, rosters and answers still persist; only the scanned
 * images become session-only, because they would blow the 5 MB quota.
 * Last resort is memory, so the app always runs rather than dying at boot.
 */
var DB = (function () {
  var STORES = ['tests', 'students', 'scans', 'blobs', 'kv'];
  var KEYPATH = { tests: 'id', students: 'sid', scans: 'id', blobs: 'id', kv: 'k' };
  var VOLATILE = { blobs: 1 };          // never written to localStorage
  var dbp = null, mode = null, warned = false;

  /* ---------- IndexedDB ---------- */
  function openIdb() {
    return new Promise(function (res, rej) {
      var done = false;
      var fail = function (e) { if (!done) { done = true; rej(e || new Error('indexedDB unavailable')); } };
      if (!global.indexedDB) return fail();
      var rq;
      try { rq = indexedDB.open('quickgrade', 1); } catch (e) { return fail(e); }
      setTimeout(function () { fail(new Error('indexedDB timed out')); }, 3000);
      rq.onupgradeneeded = function (e) {
        var db = e.target.result;
        STORES.forEach(function (s) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: KEYPATH[s] });
        });
      };
      rq.onsuccess = function () { if (!done) { done = true; res(rq.result); } };
      rq.onerror = fail;
      rq.onblocked = fail;
    });
  }
  function req(r) {
    return new Promise(function (res, rej) {
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(store, m, fn) {
    return dbp.then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(store, m), out;
        t.oncomplete = function () { res(out); };
        t.onerror = function () { rej(t.error); };
        t.onabort = function () { rej(t.error); };
        out = fn(t.objectStore(store));
      });
    });
  }

  /* ---------- fallback ---------- */
  var mem = {};
  STORES.forEach(function (s) { mem[s] = {}; });

  function lsKey(s) { return 'qg.store.' + s; }
  function loadFallback() {
    if (mode !== 'local') return;
    STORES.forEach(function (s) {
      if (VOLATILE[s]) return;
      try {
        var raw = localStorage.getItem(lsKey(s));
        if (raw) mem[s] = JSON.parse(raw) || {};
      } catch (e) { mem[s] = {}; }
    });
  }
  function flush(store) {
    if (mode !== 'local' || VOLATILE[store]) return Promise.resolve();
    try {
      localStorage.setItem(lsKey(store), JSON.stringify(mem[store]));
    } catch (e) {
      if (!warned) {
        warned = true;
        toast('Local storage is full — recent changes may not survive a reload. Export a backup.', 'err', 9000);
      }
    }
    return Promise.resolve();
  }

  function ready() {
    if (dbp) return dbp;
    dbp = openIdb().then(function (db) {
      mode = 'idb';
      return db;
    }).catch(function () {
      try {
        localStorage.setItem('qg.probe', '1');
        localStorage.removeItem('qg.probe');
        mode = 'local';
      } catch (e) { mode = 'memory'; }
      loadFallback();
      return null;
    });
    return dbp;
  }

  function api(fn) { return function () { var a = arguments; return ready().then(function () { return fn.apply(null, a); }); }; }

  return {
    stores: STORES,
    ready: ready,
    mode: function () { return mode; },
    get: api(function (store, key) {
      if (mode === 'idb') return dbp.then(function (db) {
        return req(db.transaction(store, 'readonly').objectStore(store).get(key));
      });
      return Promise.resolve(mem[store][key]);
    }),
    all: api(function (store) {
      if (mode === 'idb') return dbp.then(function (db) {
        return req(db.transaction(store, 'readonly').objectStore(store).getAll());
      });
      return Promise.resolve(Object.keys(mem[store]).map(function (k) { return mem[store][k]; }));
    }),
    put: api(function (store, val) {
      if (mode === 'idb') return tx(store, 'readwrite', function (s) { s.put(val); return val; });
      mem[store][val[KEYPATH[store]]] = val;
      return flush(store).then(function () { return val; });
    }),
    putMany: api(function (store, vals) {
      if (mode === 'idb') return tx(store, 'readwrite', function (s) {
        vals.forEach(function (v) { s.put(v); }); return vals.length;
      });
      vals.forEach(function (v) { mem[store][v[KEYPATH[store]]] = v; });
      return flush(store).then(function () { return vals.length; });
    }),
    del: api(function (store, key) {
      if (mode === 'idb') return tx(store, 'readwrite', function (s) { s.delete(key); });
      delete mem[store][key];
      return flush(store);
    }),
    delMany: api(function (store, keys) {
      if (mode === 'idb') return tx(store, 'readwrite', function (s) {
        keys.forEach(function (k) { s.delete(k); });
      });
      keys.forEach(function (k) { delete mem[store][k]; });
      return flush(store);
    }),
    clear: api(function (store) {
      if (mode === 'idb') return tx(store, 'readwrite', function (s) { s.clear(); });
      mem[store] = {};
      return flush(store);
    })
  };
})();

/* Small synchronous settings bag (localStorage). */
var Prefs = {
  get: function (k, dflt) {
    try { var v = localStorage.getItem('qg.' + k); return v == null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  },
  set: function (k, v) { try { localStorage.setItem('qg.' + k, JSON.stringify(v)); } catch (e) {} }
};

/* -------------------------------------------------------------- audio */
var Audio2 = (function () {
  var ctx = null, enabled = true;
  function ac() {
    if (!ctx) {
      var C = global.AudioContext || global.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, start, dur, type, vol) {
    var c = ac(); if (!c) return;
    var o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, c.currentTime + start);
    g.gain.setValueAtTime(0.0001, c.currentTime + start);
    g.gain.exponentialRampToValueAtTime(vol == null ? 0.28 : vol, c.currentTime + start + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    o.connect(g); g.connect(c.destination);
    o.start(c.currentTime + start);
    o.stop(c.currentTime + start + dur + 0.02);
  }
  return {
    unlock: function () { ac(); },
    setEnabled: function (v) { enabled = !!v; },
    /** crisp two-note rise — sheet accepted */
    ok: function () { if (!enabled) return; tone(880, 0, 0.07, 'sine', .3); tone(1320, 0.06, 0.10, 'sine', .3); },
    /** low double buzz — name unknown / bad read */
    bad: function () { if (!enabled) return; tone(196, 0, 0.16, 'square', .22); tone(160, 0.19, 0.24, 'square', .22); },
    /** single amber tone — duplicate page */
    dup: function () { if (!enabled) return; tone(560, 0, 0.16, 'triangle', .26); },
    /** soft click — page 2+ of a multi-page test */
    tick: function () { if (!enabled) return; tone(1100, 0, 0.045, 'sine', .18); },
    /** ascending chime — that student is now complete */
    done: function () { if (!enabled) return; tone(660, 0, .07, 'sine', .26); tone(880, .07, .07, 'sine', .26); tone(1180, .14, .13, 'sine', .26); }
  };
})();

function speak(text) {
  try {
    if (!global.speechSynthesis) return;
    global.speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(String(text));
    u.rate = 1.15; u.volume = 0.9;
    global.speechSynthesis.speak(u);
  } catch (e) {}
}

/* ----------------------------------------------------------- UI bits */
function toast(msg, kind, ms) {
  var box = $('#toasts'); if (!box) return;
  var t = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
  box.appendChild(t);
  setTimeout(function () {
    t.style.transition = 'opacity .3s'; t.style.opacity = '0';
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
  }, ms || 3200);
}

/** Modal. content = DOM node or HTML string. Returns {close}. */
function modal(content, opts) {
  opts = opts || {};
  var m = $('#modal'), card = $('#modalCard');
  card.innerHTML = '';
  if (typeof content === 'string') card.innerHTML = content;
  else card.appendChild(content);
  m.hidden = false;
  function close() { m.hidden = true; card.innerHTML = ''; document.removeEventListener('keydown', onKey); m.removeEventListener('click', onBg); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  function onBg(e) { if (e.target === m && !opts.sticky) close(); }
  document.addEventListener('keydown', onKey);
  m.addEventListener('click', onBg);
  return { close: close, card: card };
}

function confirmBox(msg, okLabel) {
  return new Promise(function (res) {
    var body = el('div', {}, [
      el('p', { text: msg, style: 'margin:0 0 16px;font-size:15px' }),
      el('div', { class: 'row gap end' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: function () { h.close(); res(false); } }),
        el('button', { class: 'btn danger', text: okLabel || 'Delete', onclick: function () { h.close(); res(true); } })
      ])
    ]);
    var h = modal(body);
  });
}

function promptBox(msg, dflt) {
  return new Promise(function (res) {
    var inp = el('input', { value: dflt || '' });
    var body = el('div', {}, [
      el('p', { text: msg, style: 'margin:0 0 10px' }), inp,
      el('div', { class: 'row gap end', style: 'margin-top:16px' }, [
        el('button', { class: 'btn', text: 'Cancel', onclick: function () { h.close(); res(null); } }),
        el('button', { class: 'btn go', text: 'OK', onclick: function () { h.close(); res(inp.value.trim()); } })
      ])
    ]);
    var h = modal(body);
    setTimeout(function () { inp.focus(); inp.select(); }, 30);
    on(inp, 'keydown', function (e) { if (e.key === 'Enter') { h.close(); res(inp.value.trim()); } });
  });
}

/* ------------------------------------------------------------ files */
function downloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = el('a', { href: url, download: filename });
  document.body.appendChild(a); a.click();
  setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
}
function downloadText(text, filename, mime) {
  // BOM keeps Excel honest about UTF-8 in CSV.
  var isCsv = /csv$/i.test(filename);
  downloadBlob(new Blob([isCsv ? '﻿' + text : text], { type: (mime || 'text/plain') + ';charset=utf-8' }), filename);
}
function readFileText(file) {
  return new Promise(function (res, rej) {
    var r = new FileReader();
    r.onload = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
    r.readAsText(file);
  });
}
function loadImageFile(file) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { URL.revokeObjectURL(url); res(img); };
    img.onerror = function (e) { URL.revokeObjectURL(url); rej(e); };
    img.src = url;
  });
}
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  return new Promise(function (res, rej) {
    var ta = el('textarea', { style: 'position:fixed;left:-9999px' });
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); res(); } catch (e) { rej(e); }
    document.body.removeChild(ta);
  });
}
/** Open an HTML string in a new window and (optionally) trigger print. */
function openPrintWindow(html, autoPrint) {
  var w = global.open('', '_blank');
  if (!w) { toast('Pop-up blocked — allow pop-ups for this page to print.', 'err', 6000); return null; }
  w.document.open(); w.document.write(html); w.document.close();
  if (autoPrint) w.onload = function () { setTimeout(function () { w.focus(); w.print(); }, 350); };
  return w;
}

global.QG = global.QG || {};
Object.assign(global.QG, {
  $: $, $$: $$, el: el, on: on, esc: esc, pad: pad, uid: uid, clamp: clamp, round2: round2,
  todayISO: todayISO, prettyDate: prettyDate, sortName: sortName,
  DB: DB, Prefs: Prefs, Audio2: Audio2, speak: speak,
  toast: toast, modal: modal, confirmBox: confirmBox, promptBox: promptBox,
  downloadBlob: downloadBlob, downloadText: downloadText, readFileText: readFileText,
  loadImageFile: loadImageFile, copyToClipboard: copyToClipboard, openPrintWindow: openPrintWindow
});
})(window);
