/* QuickGrade — i18n.js : interface language.
 *
 * The point of this app is reach, so the interface has to speak the language
 * of the person holding the papers. Three rules keep that honest:
 *
 *   1. Every user-visible string lives in a pack, never in the markup or in a
 *      function body. English is the reference pack and the fallback.
 *   2. The language is detected from the browser on first run. A teacher who
 *      cannot read English cannot find a menu labelled "Language".
 *   3. The answer sheet geometry never changes. Right-to-left languages get
 *      right-to-left *interface* and right-to-left label text, but the bubble
 *      grid stays exactly where it is, because the scanner reads by position
 *      and forking that for one language would fork the decode path.
 *
 * Packs are plain objects. That is deliberate: a native speaker can correct
 * one and send it back without knowing anything about the rest of the code. */
(function (global) {
'use strict';
var Q = global.QG;

/* Languages offered. `dir` drives the document direction; `name` is written
 * in the language itself, because that is the only form a speaker of it can
 * recognise in a list. */
var LANGS = [
  { code: 'en', name: 'English',    dir: 'ltr' },
  { code: 'es', name: 'Espa\u00f1ol',    dir: 'ltr' },
  { code: 'ar', name: '\u0627\u0644\u0639\u0631\u0628\u064a\u0629', dir: 'rtl' },
  { code: 'hi', name: '\u0939\u093f\u0928\u094d\u0926\u0940', dir: 'ltr' },
  { code: 'tl', name: 'Tagalog',    dir: 'ltr' },
  { code: 'ru', name: '\u0420\u0443\u0441\u0441\u043a\u0438\u0439', dir: 'ltr' },
  { code: 'th', name: '\u0e44\u0e17\u0e22',   dir: 'ltr' },
  { code: 'ko', name: '\ud55c\uad6d\uc5b4',  dir: 'ltr' },
  { code: 'vi', name: 'Ti\u1ebfng Vi\u1ec7t', dir: 'ltr' },
  { code: 'id', name: 'Bahasa Indonesia', dir: 'ltr' },
  { code: 'pt', name: 'Portugu\u00eas',  dir: 'ltr' },
  { code: 'fr', name: 'Fran\u00e7ais',   dir: 'ltr' },
  { code: 'zh', name: '\u4e2d\u6587',    dir: 'ltr' }
];

var packs = { en: {} };          /* filled by lang/*.js, en by lang/en.js */
var lang = 'en';
var listeners = [];

function meta(code) {
  for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i];
  return LANGS[0];
}
function has(code) { return !!packs[code]; }

/* ------------------------------------------------------------- lookup */

/* Plural-aware where a language needs it. Russian and Arabic genuinely do:
 * a pack may supply `key.one` / `key.few` / `key.many` / `key.other` and the
 * right one is chosen by Intl. A pack that supplies only `key` gets `key`. */
function pick(p, key, vars) {
  if (vars && vars.n != null && p[key + '.other'] != null) {
    var cat = 'other';
    try { cat = new Intl.PluralRules(lang).select(vars.n); } catch (e) {}
    if (p[key + '.' + cat] != null) return p[key + '.' + cat];
    return p[key + '.other'];
  }
  return p[key];
}

function t(key, vars) {
  var s = pick(packs[lang] || {}, key, vars);
  if (s == null) s = pick(packs.en || {}, key, vars);
  if (s == null) s = key;                       /* visible, so it gets noticed */
  if (vars) s = String(s).replace(/\{(\w+)\}/g, function (m, k) {
    return vars[k] != null ? vars[k] : m;
  });
  return s;
}

/* ------------------------------------------------- applying to the DOM */

var ATTRS = [
  ['data-i18n-ph',    'placeholder'],
  ['data-i18n-title', 'title'],
  ['data-i18n-aria',  'aria-label'],
  ['data-i18n-value', 'value'],
  ['data-i18n-alt',   'alt']
];

function apply(root) {
  root = root || document;
  var i, j, n, nodes;

  nodes = root.querySelectorAll('[data-i18n]');
  for (i = 0; i < nodes.length; i++) {
    n = nodes[i];
    /* Some labels carry a child element (a badge, an icon). Only the text
     * belongs to the pack, so replace the first text node and leave the rest. */
    var txt = t(n.getAttribute('data-i18n'));
    var first = null;
    for (j = 0; j < n.childNodes.length; j++) {
      if (n.childNodes[j].nodeType === 3) { first = n.childNodes[j]; break; }
    }
    if (first && n.children.length) first.nodeValue = txt;
    else n.textContent = txt;
  }

  /* Blocks whose English contains markup — a <code> sample, a <strong> — are
   * translated whole. The pack owns the tags too, so a translator can move
   * them where their language needs them. */
  nodes = root.querySelectorAll('[data-i18n-html]');
  for (i = 0; i < nodes.length; i++) {
    nodes[i].innerHTML = t(nodes[i].getAttribute('data-i18n-html'));
  }

  for (var a = 0; a < ATTRS.length; a++) {
    nodes = root.querySelectorAll('[' + ATTRS[a][0] + ']');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].setAttribute(ATTRS[a][1], t(nodes[i].getAttribute(ATTRS[a][0])));
    }
  }
}

/* ------------------------------------------------------------ switching */

function set(code, opts) {
  if (!has(code)) code = 'en';
  lang = code;
  var m = meta(code);
  var d = document.documentElement;
  d.setAttribute('lang', code);
  d.setAttribute('dir', m.dir);
  if (!(opts && opts.silent)) { try { Q.Prefs.set('lang', code); } catch (e) {} }
  /* Two labels live in CSS `content:` where the DOM walker cannot reach them.
   * Hand them over as custom properties instead of leaving them in English. */
  d.style.setProperty('--lbl-selected', JSON.stringify(t('css.selected')));
  d.style.setProperty('--lbl-manycols', JSON.stringify(t('css.manyColumns')));
  apply(document);
  listeners.forEach(function (f) { try { f(code); } catch (e) {} });
}

/* Fonts.
 *
 * A font stack is resolved per character, not per element: the browser walks
 * it until something has the glyph. So one broad stack serves every script
 * and there is no need to swap fonts when the language changes. The Noto
 * names cover Linux and Android; the rest are what Windows and macOS ship.
 *
 * Thai and Devanagari stack marks above and below the line, so they need more
 * leading than Latin or the diacritics clip inside fixed-height controls. */
var FONT_STACK = 'ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,' +
  '"Helvetica Neue",Arial,"Noto Sans","Noto Sans Thai","Leelawadee UI",' +
  '"Noto Sans Devanagari","Nirmala UI","Noto Sans Arabic",Tahoma,' +
  '"Noto Sans KR","Malgun Gothic","Noto Sans SC","Microsoft YaHei",sans-serif';

var PRINT_STACK = 'Calibri,Arial,"Noto Sans","Noto Sans Thai","Leelawadee UI",' +
  '"Noto Sans Devanagari","Nirmala UI","Noto Sans Arabic",Tahoma,' +
  '"Noto Sans KR","Malgun Gothic",sans-serif';

/* Word needs three separate font slots — Latin, East Asian and "complex
 * script" (Arabic, Thai, Devanagari). Naming only the Latin one leaves Word
 * to substitute for the rest, usually badly. */
var DOCX_FONTS = {
  ar: { ascii: 'Calibri', cs: 'Arial',           eastAsia: 'Calibri' },
  th: { ascii: 'Calibri', cs: 'Leelawadee UI',   eastAsia: 'Calibri' },
  hi: { ascii: 'Calibri', cs: 'Nirmala UI',      eastAsia: 'Calibri' },
  ko: { ascii: 'Calibri', cs: 'Calibri',         eastAsia: 'Malgun Gothic' },
  zh: { ascii: 'Calibri', cs: 'Calibri',         eastAsia: 'Microsoft YaHei' }
};
function fonts() {
  return {
    css: FONT_STACK,
    print: PRINT_STACK,
    docx: DOCX_FONTS[lang] || { ascii: 'Calibri', cs: 'Calibri', eastAsia: 'Calibri' }
  };
}

function onChange(fn) { listeners.push(fn); }

/* The picker lists only languages we actually have a pack for, and lists
 * each in its own script — a speaker of Thai recognises ไทย, not "Thai". */
function mountPicker(node) {
  if (!node) return;
  node.innerHTML = '';
  var avail = LANGS.filter(function (l) { return has(l.code); });
  /* One language is not a choice; do not spend header space on it. */
  if (avail.length < 2) { node.hidden = true; return; }
  node.hidden = false;
  avail.forEach(function (l) {
    var o = document.createElement('option');
    o.value = l.code; o.textContent = l.name;
    if (l.code === lang) o.selected = true;
    node.appendChild(o);
  });
  node.addEventListener('change', function () { set(node.value); });
}

/* What the browser says, narrowed to a pack we actually have. `pt-BR` and
 * `zh-Hans` land on `pt` and `zh`. */
function detect() {
  var want = (global.navigator.languages || [global.navigator.language || 'en']);
  for (var i = 0; i < want.length; i++) {
    var c = String(want[i] || '').toLowerCase();
    if (has(c)) return c;
    var base = c.split('-')[0];
    if (has(base)) return base;
  }
  return 'en';
}

function boot() {
  var saved = null;
  try { saved = Q.Prefs.get('lang', null); } catch (e) {}
  set(saved || detect(), { silent: !saved });
}

global.QG.I18N = {
  LANGS: LANGS, packs: packs,
  t: t, apply: apply, set: set, boot: boot, detect: detect, mountPicker: mountPicker,
  onChange: onChange, has: has, meta: meta, fonts: fonts,
  get lang() { return lang; },
  /* Which keys the current pack is missing — used by the test suite so an
   * untranslated string is a build failure rather than a surprise in class. */
  missing: function (code) {
    var p = packs[code] || {}, out = [];
    for (var k in packs.en) if (p[k] == null && p[k.replace(/\.(one|few|many|other)$/, '.other')] == null) out.push(k);
    return out;
  }
};
global.QG.T = t;
})(window);
