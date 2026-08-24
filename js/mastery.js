/* QuickGrade — mastery.js
 *
 * A percentage tells a teacher who is behind. It does not tell them what to
 * reteach. Grouping the same answers by the objective each question tests
 * turns one number into an answer to "what do I do on Monday?".
 *
 * Nothing here scores anything — it reads the per-question outcomes that
 * scoring.js already decided, and groups them.
 */
(function (global) {
'use strict';
var SC = null;
function sc() { return SC || (SC = global.QG.Scoring); }

var LEVELS = [
  { id: 'secure',     label: 'Secure',     min: 80 },
  { id: 'developing', label: 'Developing', min: 60 },
  { id: 'notyet',     label: 'Not yet',    min: 0 }
];

function thresholds(test) {
  var m = (test.options && test.options.mastery) || {};
  return { secure: m.secure == null ? 80 : m.secure,
           developing: m.developing == null ? 60 : m.developing };
}
function levelFor(test, pct) {
  var t = thresholds(test), p = pct * 100;
  if (p >= t.secure) return LEVELS[0];
  if (p >= t.developing) return LEVELS[1];
  return LEVELS[2];
}

/** The objectives this test covers, in the order they first appear. */
function standardsOf(test) {
  var order = [], map = {};
  var topics = (test.mc && test.mc.topic) || [];
  for (var q = 0; q < (test.mc ? test.mc.count : 0); q++) {
    var name = String(topics[q] || '').trim();
    if (!name) continue;
    if (!map[name]) { map[name] = { name: name, questions: [] }; order.push(map[name]); }
    map[name].questions.push(q);
  }
  return order;
}
function isTagged(test) { return standardsOf(test).length > 0; }

/**
 * forStudent(test, row) -> [{ name, correct, counted, pct, level, questions }]
 * A question only counts if it was actually scored for this student, so a
 * dropped question or an unscanned page never drags an objective down.
 */
function forStudent(test, row) {
  var S = sc();
  return standardsOf(test).map(function (std) {
    var correct = 0, counted = 0;
    std.questions.forEach(function (q) {
      var st = row.qStatus ? row.qStatus[q] : null;
      if (st === S.STATUS.DROPPED || st === S.STATUS.UNSCANNED) return;
      counted++;
      if (st === S.STATUS.CORRECT || st === S.STATUS.CREDIT) correct++;
    });
    var pct = counted ? correct / counted : 0;
    return { name: std.name, correct: correct, counted: counted, pct: pct,
             level: levelFor(test, pct), questions: std.questions };
  }).filter(function (s) { return s.counted > 0; });
}

/**
 * forClass(test, results) -> [{ name, questions, pct, counted, correct,
 *                               secure, developing, notyet, weakest }]
 * Sorted weakest first, because that is the order a teacher acts in.
 */
function forClass(test, results) {
  var rows = (results && results.scannedRows) || [];
  var out = standardsOf(test).map(function (std) {
    var correct = 0, counted = 0, tally = { secure: 0, developing: 0, notyet: 0 };
    rows.forEach(function (row) {
      var mine = forStudent(test, row).filter(function (s) { return s.name === std.name; })[0];
      if (!mine) return;
      correct += mine.correct;
      counted += mine.counted;
      tally[mine.level.id]++;
    });
    return {
      name: std.name, questions: std.questions,
      correct: correct, counted: counted,
      pct: counted ? correct / counted : 0,
      secure: tally.secure, developing: tally.developing, notyet: tally.notyet,
      students: rows.length
    };
  });
  out.sort(function (a, b) { return a.pct - b.pct; });
  return out;
}

/** One line a teacher can act on, or '' when there is nothing to say. */
function classHeadline(test, results) {
  var list = forClass(test, results);
  if (!list.length) return '';
  var weak = list.filter(function (s) { return s.pct < thresholds(test).developing / 100; });
  if (!weak.length) return 'Every objective is at or above the developing threshold.';
  return weak.length === 1
    ? 'Weakest objective: ' + weak[0].name + ', ' + Math.round(weak[0].pct * 100) + '% across the class.'
    : weak.length + ' objectives are below the developing threshold, weakest is ' +
      weak[0].name + ' at ' + Math.round(weak[0].pct * 100) + '%.';
}

global.QG = global.QG || {};
global.QG.Mastery = {
  LEVELS: LEVELS, thresholds: thresholds, levelFor: levelFor,
  standardsOf: standardsOf, isTagged: isTagged,
  forStudent: forStudent, forClass: forClass, classHeadline: classHeadline
};
})(window);
