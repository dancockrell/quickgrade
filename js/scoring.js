/* QuickGrade — scoring.js
 *
 * The single place that decides what a question is worth and whether an answer
 * earned it. Nothing else in the app may compute a score.
 *
 * Every question carries an optional rule, so a test can be fixed after it has
 * been sat without touching the answer key or rescanning anything:
 *
 *   drop    — the question stops existing, for everyone, in both earned and possible
 *   credit  — everyone gets the points whatever they answered
 *   accept  — extra answers that also count as correct
 *   points  — what this one question is worth, overriding the test default
 *
 * Rules are data on the test, so they export, back up and restore with it.
 */
(function (global) {
'use strict';

var STATUS = {
  CORRECT: 'correct', WRONG: 'wrong', BLANK: 'blank', MULTI: 'multi',
  UNSCANNED: 'unscanned', DROPPED: 'dropped', CREDIT: 'credit'
};
/* answers[] uses these sentinels; -3 means the page was never scanned */
var UNSCANNED = -3, NO_MARK = -1;

/* ------------------------------------------------------------- versions
 * A test may be printed as several versions with the questions in different
 * orders, so neighbours cannot simply copy. Each version carries its own
 * answer key and its own printed test code — which is how the scanner knows
 * which key to apply without anyone selecting anything.
 *
 * Version A is always the test itself, so a test that has never been versioned
 * behaves exactly as before and needs no migration.
 */
function formsOf(test) {
  var primary = { id: (test.formLabel || 'A'), code: test.code,
                  key: test.mc.key, rules: test.mc.rules || {}, primary: true };
  return [primary].concat((test.forms || []).map(function (f) {
    return { id: f.id, code: f.code, key: f.key || [], rules: f.rules || {}, primary: false };
  }));
}
function hasForms(test) { return !!(test.forms && test.forms.length); }

/** The version a scanned sheet belongs to, found by its printed code. */
function formByCode(test, code) {
  if (code == null) return null;
  var want = String(code).replace(/\D/g, '');
  var hit = formsOf(test).filter(function (f) {
    return String(f.code).replace(/\D/g, '') === want;
  });
  return hit[0] || null;
}
/** The key and rules to score a sheet against. */
function variantOf(test, formId) {
  var all = formsOf(test);
  if (!formId) return all[0];
  return all.filter(function (f) { return f.id === formId; })[0] || all[0];
}

function rulesOf(test, variant) { return (variant ? variant.rules : (test.mc && test.mc.rules)) || {}; }
function ruleFor(test, q, variant) { return rulesOf(test, variant)[q] || {}; }
function keyOf(test, variant) { return (variant ? variant.key : test.mc.key) || []; }

/** True when the teacher has changed how this question scores. */
function isModified(test, q, variant) {
  var r = ruleFor(test, q, variant);
  return !!(r.drop || r.credit || (r.accept && r.accept.length) || r.points != null);
}

/** What this question is worth, before any rule that zeroes it out. */
function pointsFor(test, q, variant) {
  var r = ruleFor(test, q, variant);
  var p = r.points != null ? r.points : (test.mc.points == null ? 1 : test.mc.points);
  return isFinite(p) ? p : 0;
}

/** Every choice index that counts as correct. */
function acceptedFor(test, q, variant) {
  var r = ruleFor(test, q, variant);
  var key = keyOf(test, variant)[q];
  var list = (r.accept || []).slice();
  if (key != null && list.indexOf(key) < 0) list.push(key);
  return list;
}

/**
 * scoreQuestion -> { earned, possible, status }
 * `answer` is a choice index, NO_MARK for blank, or UNSCANNED.
 */
function scoreQuestion(test, q, answer, state, variant) {
  var r = ruleFor(test, q, variant);
  if (r.drop) return { earned: 0, possible: 0, status: STATUS.DROPPED };
  var pts = pointsFor(test, q, variant);
  if (r.credit) return { earned: pts, possible: pts, status: STATUS.CREDIT };
  if (answer === UNSCANNED) return { earned: 0, possible: pts, status: STATUS.UNSCANNED };
  if (state === 'multi') return { earned: 0, possible: pts, status: STATUS.MULTI };
  if (answer == null || answer === NO_MARK) return { earned: 0, possible: pts, status: STATUS.BLANK };
  var ok = acceptedFor(test, q, variant).indexOf(answer) >= 0;
  return { earned: ok ? pts : 0, possible: pts, status: ok ? STATUS.CORRECT : STATUS.WRONG };
}

/** Total points available for multiple choice, after drops and overrides. */
function mcPossible(test, variant) {
  var total = 0;
  for (var q = 0; q < test.mc.count; q++) {
    if (ruleFor(test, q, variant).drop) continue;
    total += pointsFor(test, q, variant);
  }
  return total;
}

function writtenPossible(test) {
  return (test.written || []).reduce(function (a, w) { return a + (w.max || 0); }, 0);
}

/* -------------------------------------------------------------- rubrics
 * A written answer can be marked against criteria instead of pulling a single
 * number out of the air. One shared set of levels applies to every criterion,
 * which is how most classroom rubrics are actually written, and keeps grading
 * to one keystroke per criterion.
 *
 * The resulting points still land in the same place as a hand-typed score, so
 * nothing downstream needs to know a rubric was involved.
 */
var DEFAULT_LEVELS = [
  { label: 'Not yet', pts: 0 },
  { label: 'Partly',  pts: 1 },
  { label: 'Fully',   pts: 2 }
];

function rubricOf(test, wi) {
  var w = (test.written || [])[wi];
  var r = w && w.rubric;
  if (!r || !r.criteria || !r.criteria.length || !r.levels || !r.levels.length) return null;
  return r;
}
function hasRubric(test, wi) { return !!rubricOf(test, wi); }

/** Highest points a rubric can award. */
function rubricMax(rubric) {
  if (!rubric) return 0;
  var top = rubric.levels.reduce(function (m, l) { return Math.max(m, l.pts || 0); }, 0);
  return top * rubric.criteria.length;
}
/** levels = one chosen level index per criterion; blanks score nothing. */
function rubricScore(rubric, levels) {
  if (!rubric) return 0;
  var total = 0;
  rubric.criteria.forEach(function (c, i) {
    var li = (levels || [])[i];
    var lv = li == null ? null : rubric.levels[li];
    if (lv) total += (lv.pts || 0);
  });
  return total;
}
/** True once every criterion has been given a level. */
function rubricComplete(rubric, levels) {
  if (!rubric) return false;
  return rubric.criteria.every(function (c, i) { return (levels || [])[i] != null; });
}

/**
 * scoreStudent(test, answers, states, wRecords) -> {
 *   correct, wrong, blank, multi, unscanned, credited, dropped,
 *   mcEarned, mcPossible, wEarned, wPossible, wGraded,
 *   total, max, pct, qStatus[]
 * }
 * pct is pre-curve; applyCurve() is a separate, explicit step.
 */
function scoreStudent(test, answers, states, wRecords, variant) {
  var out = {
    correct: 0, wrong: 0, blank: 0, multi: 0, unscanned: 0, credited: 0, dropped: 0,
    mcEarned: 0, mcPossible: 0, wEarned: 0, wPossible: 0, wGraded: 0, qStatus: []
  };
  for (var q = 0; q < test.mc.count; q++) {
    var s = scoreQuestion(test, q, answers[q], (states || {})[q], variant);
    out.qStatus[q] = s.status;
    out.mcEarned += s.earned;
    out.mcPossible += s.possible;
    if (s.status === STATUS.CORRECT) out.correct++;
    else if (s.status === STATUS.WRONG) out.wrong++;
    else if (s.status === STATUS.BLANK) out.blank++;
    else if (s.status === STATUS.MULTI) out.multi++;
    else if (s.status === STATUS.UNSCANNED) out.unscanned++;
    else if (s.status === STATUS.CREDIT) out.credited++;
    else if (s.status === STATUS.DROPPED) out.dropped++;
  }
  (test.written || []).forEach(function (wq, wi) {
    out.wPossible += (wq.max || 0);
    var rec = (wRecords || {})[wi];
    if (rec && typeof rec.p === 'number') { out.wEarned += rec.p; out.wGraded++; }
  });
  out.total = out.mcEarned + out.wEarned;
  out.max = out.mcPossible + out.wPossible;
  out.pct = out.max > 0 ? out.total / out.max : 0;
  return out;
}

/* ------------------------------------------------------------- curving */
/* `key` not `label`: this array is built at load time, before a language is
 * chosen, so the caller resolves the name when it draws it. */
var CURVES = [
  { id: 'none',       key: 'curve.none' },
  { id: 'addPoints',  key: 'curve.addPoints',  unit: 'curve.unit.points' },
  { id: 'addPercent', key: 'curve.addPercent', unit: 'curve.unit.percent' },
  { id: 'topIsFull',  key: 'curve.topIsFull' }
];

/**
 * curvedPct(test, pct, ctx) -> pct
 * ctx.topPct is the highest uncurved percent in the class, needed by topIsFull.
 * Always clamped to 0..1 — a curve may not invent more than full marks.
 */
function curvedPct(test, pct, ctx) {
  var c = test.curve || { kind: 'none' };
  var max = (ctx && ctx.max) || 0;
  var out = pct;
  if (c.kind === 'addPoints' && max > 0) out = pct + (c.value || 0) / max;
  else if (c.kind === 'addPercent') out = pct + (c.value || 0) / 100;
  else if (c.kind === 'topIsFull') {
    var top = (ctx && ctx.topPct) || 0;
    out = top > 0 ? pct / top : pct;
  }
  return out < 0 ? 0 : out > 1 ? 1 : out;
}
function curveLabel(test) {
  var c = test.curve || { kind: 'none' };
  if (c.kind === 'addPoints') return '+' + (c.value || 0) + ' points';
  if (c.kind === 'addPercent') return '+' + (c.value || 0) + '%';
  if (c.kind === 'topIsFull') return 'top score scaled to 100%';
  return '';
}
function hasCurve(test) { return !!(test.curve && test.curve.kind && test.curve.kind !== 'none'); }

/** Human summary of what has been changed about a question. */
function ruleSummary(test, q, variant) {
  var T = global.QG.T;
  var r = ruleFor(test, q, variant), bits = [];
  if (r.drop) return T('rule.dropped');
  if (r.credit) bits.push(T('rule.credit'));
  if (r.accept && r.accept.length) {
    bits.push(T('rule.accepts', { letters: r.accept.map(function (i) {
      return global.QG.Sheet.LETTERS[i];
    }).join(T('rule.and')) }));
  }
  if (r.points != null) bits.push(T('rule.worth', { n: r.points }));
  return bits.join(T('rule.join'));
}

global.QG = global.QG || {};
global.QG.Scoring = {
  STATUS: STATUS, UNSCANNED: UNSCANNED, NO_MARK: NO_MARK, CURVES: CURVES,
  ruleFor: ruleFor, rulesOf: rulesOf, isModified: isModified, keyOf: keyOf,
  formsOf: formsOf, hasForms: hasForms, formByCode: formByCode, variantOf: variantOf,
  pointsFor: pointsFor, acceptedFor: acceptedFor,
  scoreQuestion: scoreQuestion, scoreStudent: scoreStudent,
  mcPossible: mcPossible, writtenPossible: writtenPossible,
  curvedPct: curvedPct, curveLabel: curveLabel, hasCurve: hasCurve,
  DEFAULT_LEVELS: DEFAULT_LEVELS, rubricOf: rubricOf, hasRubric: hasRubric,
  rubricMax: rubricMax, rubricScore: rubricScore, rubricComplete: rubricComplete,
  ruleSummary: ruleSummary
};
})(window);
