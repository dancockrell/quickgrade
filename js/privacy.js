/* QuickGrade — privacy.js : the plain statement of what happens to student
 * data.
 *
 * This exists because the risk to a teacher is not an abstract breach — it is
 * being the person who put student records somewhere they should not have
 * gone. So the statement has to be something they can hand to whoever approves
 * software, on paper, in their own language. All of the wording lives here in
 * one object for that reason: it is the unit that gets translated.
 *
 * Every claim below is checked against the code. If a network call is ever
 * added, this file must change in the same commit. */
(function (global) {
'use strict';
var Q = global.QG, el = Q.el;

var DOC = {
  title: 'What happens to student data',
  lede: 'QuickGrade runs on this device. Below is exactly where student ' +
        'information goes, written to be shown to whoever has to approve it.',

  points: [
    { h: 'Nothing is sent anywhere',
      b: 'QuickGrade has no server of its own. There is no account, no ' +
         'sign-in, no usage tracking, no error reporting and no automatic ' +
         'update. There is no address for it to send anything to.' },
    { h: 'Everything stays in this browser',
      b: 'The class list, the scanned images and the scores are kept by this ' +
         'browser on this device, the same way a web page remembers your ' +
         'settings. They are not copied to other devices, and nobody can read ' +
         'them from somewhere else.' },
    { h: 'You can check that yourself',
      b: 'Switch off the wifi and carry on using it. Everything still works, ' +
         'because nothing was going out in the first place.' },
    { h: 'Nothing leaves unless you send it',
      b: 'Exported files are saved to your Downloads folder like any other ' +
         'file. Emailing one, printing it, or putting it in a shared drive is ' +
         'a separate decision that you make each time.' },
    { h: 'Deleting really deletes',
      b: 'Removing a test removes its scans and its images with it. Clearing ' +
         'this browser\u2019s stored data for QuickGrade removes everything.' },
    { h: 'The code is public',
      b: 'None of the above has to be taken on trust. QuickGrade is open ' +
         'source under the MIT licence, and anyone technical can read it and ' +
         'confirm each point.' }
  ],

  /* Naming the exception is what makes the rest believable. */
  exception: {
    h: 'The one exception, and it starts switched off',
    b: 'Export has an optional \u201Csend scores to a web address\u201D ' +
       'feature, for a school that already has somewhere to receive results ' +
       'automatically. It does nothing at all until someone types in an ' +
       'address and presses send. If you never open it, nothing is ever ' +
       'transmitted.'
  },

  tradeoff: {
    h: 'What you give up in exchange',
    b: 'Because there is no server, there is no central gradebook, no ' +
       'automatic sharing between teachers, and no way to recover anything if ' +
       'the device is lost or its browser data is cleared. Use Export \u2192 ' +
       'Backup regularly and keep that file somewhere safe. It is the only ' +
       'copy that outlives this device.'
  }
};

/* ------------------------------------------------------------ on screen */

function body() {
  var wrap = el('div', { class: 'privacy' }, [
    el('h3', { text: DOC.title }),
    el('p', { class: 'hint', text: DOC.lede })
  ]);

  var list = el('ul', { class: 'privacy-list' });
  DOC.points.forEach(function (p) {
    list.appendChild(el('li', {}, [
      el('strong', { text: p.h }),
      el('span', { text: p.b })
    ]));
  });
  wrap.appendChild(list);

  [DOC.exception, DOC.tradeoff].forEach(function (s) {
    wrap.appendChild(el('div', { class: 'privacy-note' }, [
      el('strong', { text: s.h }),
      el('span', { text: s.b })
    ]));
  });
  return wrap;
}

function dialog() {
  var content = body();
  var h;
  content.appendChild(el('div', { class: 'row gap end', style: 'margin-top:16px' }, [
    el('button', { class: 'btn', text: 'Print this page',
      onclick: function () { printable(); } }),
    el('button', { class: 'btn go', text: 'Close',
      onclick: function () { h.close(); } })
  ]));
  h = Q.modal(content);
  return h;
}

/* ------------------------------------------------------- on paper */

function printable() {
  var esc = Q.OOXML.xml;
  var css = '@page{margin:.9in}' +
    'body{font:12pt/1.55 Georgia,\'Times New Roman\',serif;color:#111;max-width:40em;margin:0 auto}' +
    'h1{font-size:19pt;margin:0 0 4px}' +
    '.lede{color:#444;font-size:11pt;margin:0 0 22px}' +
    'dl{margin:0}dt{font-weight:700;margin-top:16px}dd{margin:3px 0 0}' +
    '.note{margin-top:22px;padding:12px 14px;border-left:3px solid #999;background:#f4f4f2}' +
    '.note b{display:block;margin-bottom:3px}' +
    '.foot{margin-top:30px;padding-top:8px;border-top:1px solid #ccc;font-size:9pt;color:#666}' +
    '.toolbar{background:#111;color:#fff;padding:10px 14px;margin:-1in -1in 24px;' +
    'display:flex;gap:12px;align-items:center;font-family:Arial,sans-serif;font-size:11pt}' +
    '.toolbar button{background:#22c07a;color:#04240f;border:0;border-radius:7px;' +
    'padding:9px 16px;font:inherit;font-weight:700;cursor:pointer}' +
    '@media print{.toolbar{display:none}body{max-width:none}}';

  var h = '<!doctype html><html><head><meta charset="utf-8"><title>' +
    esc(DOC.title) + '</title><style>' + css + '</style></head><body>' +
    '<div class="toolbar"><button onclick="window.print()">Print / Save as PDF</button>' +
    '<span>One page, for whoever approves software at your school.</span></div>' +
    '<h1>' + esc(DOC.title) + '</h1>' +
    '<p class="lede">' + esc(DOC.lede) + '</p><dl>';

  DOC.points.forEach(function (p) {
    h += '<dt>' + esc(p.h) + '</dt><dd>' + esc(p.b) + '</dd>';
  });
  h += '</dl>';

  [DOC.exception, DOC.tradeoff].forEach(function (s) {
    h += '<div class="note"><b>' + esc(s.h) + '</b>' + esc(s.b) + '</div>';
  });

  h += '<p class="foot">QuickGrade \u00b7 open source under the MIT licence \u00b7 ' +
    'printed ' + esc(Q.prettyDate(new Date().toISOString().slice(0, 10))) +
    '</p></body></html>';

  var w = global.open('', '_blank');
  if (!w) { Q.toast('Allow pop-ups to print this page.', 'err'); return; }
  w.document.write(h);
  w.document.close();
}

global.QG.Privacy = { DOC: DOC, dialog: dialog, printable: printable, body: body };
})(window);
