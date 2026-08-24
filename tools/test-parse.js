/* The answer-key parser has to accept whatever a teacher already has written
 * down. Each case below is a shape a real key actually arrives in. */
const { chromium } = require('playwright');
const BASE = process.env.QG_BASE || 'http://127.0.0.1:5200';

const KEY_CASES = [
  ['numbered with periods',      '1. B\n2. C\n3. A\n4. D\n5. E',            'BCADE'],
  ['numbered with parens',       '1) b\n2) c\n3) a\n4) d\n5) e',            'BCADE'],
  ['numbered with dashes',       '1 - B\n2 - C\n3 - A\n4 - D\n5 - E',       'BCADE'],
  ['numbered with colons',       '1: B\n2: C\n3: A\n4: D\n5: E',            'BCADE'],
  ['spreadsheet columns (tab)',  '1\tB\n2\tC\n3\tA\n4\tD\n5\tE',            'BCADE'],
  ['spreadsheet columns (comma)','1,B\n2,C\n3,A\n4,D\n5,E',                 'BCADE'],
  ['run of letters, spaced',     'B C A D E',                               'BCADE'],
  ['run of letters, jammed',     'BCADE',                                   'BCADE'],
  ['run of letters, grouped',    'BCADE BCADE',                             'BCADEBCADE'],
  ['one letter per line',        'B\nC\nA\nD\nE',                           'BCADE'],
  ['lower case',                 'b c a d e',                               'BCADE'],
  ['answer after question text', '1. What powers the cell?  B\n2. Which organelle folds protein? C\n3. Name the nucleus part A',
                                 'BCA'],
  ['answer letter then option',  '1. B) Mitochondria\n2. C) Ribosome\n3. A) Nucleus', 'BCA'],
  ['out of order numbering',     '3. A\n1. B\n2. C',                        'BCA'],
  ['true / false',               'T F T T F',                               'ABAAB'],
  ['true / false spelled out',   'True\nFalse\nTrue',                       'ABA'],
  ['numbered true/false',        '1. T\n2. F\n3. T',                        'ABA'],
  ['messy spacing and blanks',   '\n  1.   B  \n\n 2.  C \n\n\n3.A\n',      'BCA'],
  ['Word smart dashes',          '1 – B\n2 — C\n3 - A',                     'BCA'],
  ['26 questions',               Array.from({length:26},(_,i)=>`${i+1}. ${'ABCDE'[i%5]}`).join('\n'),
                                 Array.from({length:26},(_,i)=>'ABCDE'[i%5]).join('')]
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(BASE + '/index.html', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const out = await page.evaluate(({ KEY_CASES }) => {
    const P = QG.Parse, res = [];
    const asLetters = a => a.map(x => x == null ? '.' : P.LETTERS[x]).join('');

    KEY_CASES.forEach(([name, input, expect]) => {
      const r = P.parseAnswerKey(input);
      res.push({ name, pass: asLetters(r.answers) === expect,
        d: '"' + asLetters(r.answers) + '" via ' + r.mode +
           (r.maxChoice ? ', ' + r.maxChoice + ' choices' : '') });
    });

    // gaps are reported, not silently filled
    const gap = P.parseAnswerKey('1. A\n2. B\n5. C');
    res.push({ name: 'gaps are reported and left blank',
      pass: asLetters(gap.answers) === 'AB..C' && gap.warnings.some(w => /question/i.test(w)),
      d: asLetters(gap.answers) + ' | ' + (gap.warnings[0] || '') });

    // choice count is inferred from the letters used
    const four = P.parseAnswerKey('1. A\n2. D\n3. C');
    res.push({ name: 'number of choices inferred from the key', pass: four.maxChoice === 4,
      d: four.maxChoice + ' choices' });

    // prose must never be mistaken for a key
    const prose = P.parseAnswerKey('Please grade this test carefully and return it.');
    res.push({ name: 'prose is refused rather than guessed at',
      pass: prose.answers.length === 0 && prose.mode === 'unrecognised', d: prose.mode });

    const empty = P.parseAnswerKey('   ');
    res.push({ name: 'empty input is handled', pass: empty.mode === 'empty', d: empty.mode });

    // ---- written questions ----
    const w = P.parseWritten(
      'Explain osmosis in your own words. (5 points)\n' +
      'Name three organelles - 6 pts\n' +
      '3. Compare mitosis and meiosis\t8\n' +
      'Why does the cell need energy?');
    res.push({ name: 'written questions: labels parsed',
      pass: w.length === 4 && w[0].label === 'Explain osmosis in your own words.' &&
            w[2].label === 'Compare mitosis and meiosis',
      d: w.map(x => x.label).join(' | ') });
    res.push({ name: 'written questions: points parsed, default when absent',
      pass: w[0].max === 5 && w[1].max === 6 && w[2].max === 8 && w[3].max === 5,
      d: w.map(x => x.max).join(', ') });

    // ---- question text ----
    const qt = P.parseQuestionText('1. What is the powerhouse of the cell? B\n2. Which organelle folds protein? C');
    res.push({ name: 'question text extracted without the answer letter',
      pass: qt[1] === 'What is the powerhouse of the cell?' && !!qt[2],
      d: JSON.stringify(qt[1]) });
    return res;
  }, { KEY_CASES });

  let bad = 0;
  for (const r of out) { if (!r.pass) bad++; console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name.padEnd(38) + (r.d ? ' — ' + r.d : '')); }
  console.log('\n' + (bad ? bad + ' FAILED' : 'all ' + out.length + ' passed'));
  if (errs.length) console.log('page errors:', errs.slice(0, 4));
  await browser.close();
  process.exit(bad ? 1 : 0);
})();
