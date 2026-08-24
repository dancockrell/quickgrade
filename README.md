# QuickGrade

Scan paper tests with a webcam or phone camera, grade them, and export to
Excel / Sheets / Word / Docs. Runs entirely on your computer — no account, no
internet, no student data leaving the machine.

---

## Start it

**On your computer (webcam):** double-click **`Start QuickGrade.bat`**.
Your browser opens at `http://localhost:8080`. This is the way to run it.

**On your phone (phone camera):** double-click **`Start QuickGrade for Phone.bat`**,
then type the `https://192.168.x.x:8443` address it prints into your phone's browser.
Phone and computer must be on the same Wi-Fi. Your phone will warn that the
certificate isn't trusted — that's normal for a server on your own computer;
tap **Advanced → Proceed**.

> Why the fuss: browsers only allow camera access over `https://` or `localhost`.
> That's a browser rule, not a QuickGrade one. If you'd rather not deal with it,
> use **Import photos** instead — snap the sheets with your phone's normal camera
> app and drop the pictures in. Same accuracy, just not live.

### Put it on the web instead (recommended for a school)

QuickGrade is a static page. Upload this folder to any web host — a school web
server, GitHub Pages, Netlify, anything that serves files over `https://` — and
every launcher problem disappears:

- teachers open a **URL**, nothing to install, nothing to run
- the **camera works everywhere**, including phones, with no certificate warning
- it works on locked-down district laptops that block `.bat` files
- **Add to Home Screen** installs it, and it keeps working with no network

Student data still never leaves the device — there is no server side. The host
only ever sends the app's own files; scores, rosters and images stay in the
browser's storage on the teacher's machine.

### The single-file version

**`QuickGrade.html`** is the whole app — styles, code, everything — in one file
with nothing to load alongside it. Email it, put it on a USB stick, double-click
it anywhere. Rebuild it after editing the source with `python build.py`.

Double-clicking works, but with limits the app will tell you about in an amber
banner: **the camera cannot open** (browsers forbid it on `file://` pages) and
scanned images are dropped on reload. Scores, rosters, keys and answers still
save normally. Use it to set up tests, grade, and export; use the `.bat` when you
want to scan.

---

## See it working without a printer

Press **Sample class** on the Tests screen. QuickGrade builds a class of eight,
renders their answer sheets, photographs them in software and reads them back —
through exactly the same detection and scoring a camera feeds. Nothing is faked:
the scores, the flagged double-mark, the unmatched sheet and the mastery
breakdown all come out of the real reader. It takes about two seconds.

Delete the test afterwards and nothing is left behind.

## The first minute

Open it with nothing set up and it asks three things — what the test is called,
which class it is for, and your answer key — then hands you a sheet to
photocopy. Everything else stays out of the way until you need it.

## The five-minute version

1. **Tests → + New test.** Give it a title and a class, then press
   **Paste my answer key** and paste the key in whatever form you already have
   it. QuickGrade works out how many questions there are and how many choices
   each has, shows you what it read, and changes nothing until you accept it.
2. **Roster.** Make a class, paste your student names one per line. Each gets a
   short class number automatically.
3. **Roster → Print blank sheets.** Print **one** master, then run it through the
   copier for the whole class. Students bubble their class number and write their
   name. Print at **100% / Actual size**.
4. Students take the test.
5. **Scan.** Hold each sheet up to the camera. Green flash + rising beep = in.
   Keep going; you don't press anything between sheets.
6. **Review.** Anything the reader wasn't sure about is waiting there with a
   photo of the actual paper. Confirm or correct it in one click.
7. **Grade.** Written answers come up one question at a time for the whole class.
   Press a number key, it saves and jumps to the next student.
8. **Export.** Gradebook to Excel/Sheets, top sheets to Word/Docs.

### One master sheet, photocopied

Office printers are not made for classroom volume, so QuickGrade is built around
printing **one** blank master and copying it. That's why students bubble a short
class number rather than having their name pre-printed: a pre-printed sheet is a
unique page per student, which cannot be photocopied in bulk.

Class numbers are short on purpose — a 3-digit number is three bubbles and a few
seconds. You can set 2, 3, 4 or 6 digits per test under **Answer-sheet options**,
and rename the label (e.g. "SEAT NUMBER") to match whatever your class already
uses.

Pre-printing each student's ID is still available for small runs — it is the most
reliable option when you can afford a unique page per student — but it is off by
default.

## Making a test out of what you already have

You should never have to retype an answer key. Press **Paste my answer key** and
give it whatever you have:

```
1. B            1) b           1 - B         1,B          B C A D E
2. C            2) c           2 - C         2,C          BCADE
3. A            3) a           3 - A         3,A          B
                                                          C
1. What powers the cell?   B        True                  A
2. Which organelle folds protein? C False
```

All of those work, along with tabs pasted straight out of a spreadsheet, upper
or lower case, out-of-order numbering, and Word's curly dashes. It infers the
number of questions and the number of choices, warns about gaps and duplicates,
shows you exactly what it read, and only applies it when you say so. Prose is
refused rather than guessed at.

If you paste the questions along with the key, it offers to keep the wording too
and prints it on the graded sheet students get back.

**Paste my questions** does the same for written questions —
`Explain osmosis (5 points)`, `Name three organelles - 6 pts`, or a bare line
worth 5 by default.

## How a sheet gets recognised

The four black squares in the corners tell the scanner where the page is, at any
angle, upside down, hand-held, under bad classroom light. Everything else is
read from fixed positions relative to those squares.

Identity comes from the **ID bubbles**, not from handwriting — that's what makes
it instant and reliable. Handwriting is still captured, but as evidence for you
rather than as something the machine tries to read.

**If the ID can't be read**, QuickGrade does not guess: red flash, low buzzer,
`NAME NOT FOUND` on screen, and the sheet lands in **Review** with a photo of
whatever the student wrote in the name box, so you can look at it and assign the
sheet in one click.

Other things it warns about:

| What happens | Signal |
|---|---|
| Sheet accepted | green flash, rising two-note beep |
| Page 2, 3… accepted | green flash, soft click |
| That student is now complete | green flash, three-note chime |
| No ID / unreadable ID | **red flash, low buzzer**, sheet queued in Review |
| ID not on your roster | **red flash, low buzzer**, sheet queued in Review |
| Sheet already scanned | amber flash, single tone, newest scan replaces the old |
| Sheet is for a different test | red pill, sheet is *not* stored |

Turn on **Speak** to have it read each student's name aloud — useful when you're
feeding sheets and not looking at the screen.

---

## Multiple pages

A test is as many pages as it needs — multiple choice flows across pages, then
written questions get their own pages. Every page carries the same ID block plus
its own page-number bubble, so **pages can be scanned in any order**, mixed
between students, whenever. QuickGrade reassembles each student's test and tells
you which pages are still missing.

---

## Grading written answers

After scanning, **Grade** shows one question at a time across the entire class —
Q1 for everyone, then Q2. That's the fast way: you stay in one mental frame
instead of re-reading the question 30 times.

| Key | Does |
|---|---|
| `0`–`9` | award that many points, save, next student |
| `.` | half point |
| `F` / `Z` | full credit / zero |
| `Enter` | save and next |
| `←` | back |
| `S` | skip, leave ungraded |

**Blind** is on by default, hiding names while you grade. Quick-comment chips
save you retyping the same feedback; add your own with **+ add**.

---

## Marking against a rubric

A written question can be marked against criteria instead of pulling a number
out of the air. In the test editor press **Rubric** on any written question,
set the levels once — *Not yet / Partly / Fully* by default — and list the
criteria one per line. The question total follows automatically.

Marking is then one keystroke per criterion: press `1`, `2` or `3` and it fills
the next unmarked criterion, moving to the next student when the last one is
done. `Backspace` takes back the last mark. The running total is shown as you go.

The points land in exactly the same place as a hand-typed mark, so nothing else
changes — and the student's graded sheet shows which level they got on each
criterion, so they can see where the marks went.

## What the class has not got

Tag each question with what it tests — a standard, an objective, a topic — and
a percentage turns into something you can act on.

Press **Paste my objectives** in the test editor and give it whichever form you
keep them in:

```
Cells: 1-8              1-8  Cells           1. Cells
Transport: 9-16         9-16 Transport       2. Cells
Energy: 17-24, 30       17-24, 30 Energy     3. Transport
```

Bare lines in question order work too. It tells you how many questions were
tagged and which were missed, and changes nothing until you accept it.

Then:

- **Review** lists every objective, weakest first, with how many students are
  secure, developing or not yet there.
- Each student's **graded sheet** gains a short table of what they have and
  haven't got, and a "worth another look" line.
- The **item-analysis workbook** gains a Mastery sheet: a column per objective,
  a class row, and each student's weakest area.

A question that has been dropped stops counting toward its objective, so
correcting a bad question never makes an objective look worse than it was.

## Two versions of the same test

Scramble the question order in your own test document, save it as version B,
then in the test editor press **+ Add a second version** and paste that version's
answer key. Each version gets its own printed code and prints its own sheets
with a large **A** or **B** in the corner.

That is all the setup. When you scan, **the printed code tells QuickGrade which
key to use** — you can feed a shuffled pile of A and B sheets through in any
order and never say which is which. Scores are directly comparable, and Review
gains a column showing which version each student sat.

Every version can be corrected independently: dropping a bad question on
version B leaves version A untouched.

## Fixing a bad question, after the test

Question 7 turns out to be ambiguous. Nobody has to rescan anything.

**Review** lists every question with how the class did on it, worst first to the
eye — a red bar means most of the class missed it. Click any question and choose:

- **Drop it** — it stops counting for everyone and the test is out of less.
- **Accept another answer** — both letters now score.
- **Give everyone the points** — regardless of what they put.
- **Change what it is worth** — one question can be worth more than the others.

Every score in the class updates immediately, and the dialog tells you how many
students the change affects before you commit to it. It is all stored as a rule
on the test, so the answers themselves are never touched and you can undo any of
it later.

A **curve** sits on the Export screen — add points, add percentage points, or
scale so the top score is 100%. The uncurved score is always kept.

## Deleting things

Deleting scans is reversible. They move to a recoverable list at the top of
Review until you empty it, and the images are kept so a restore is complete.

## Exports

### Getting scores into your gradebook

On the Export screen, tell QuickGrade **which gradebook you use**. It remembers,
and lays the columns out the way that program expects. Then one button:

- **Download for my gradebook** — an `.xlsx` file. Import it from your
  gradebook's own upload screen.
- **Copy — paste into Google Sheets** — open a sheet, click the first cell,
  paste. Nothing to install, nothing to authorise, no add-on. This is also the
  practical route to Google Classroom, which does not accept a grade file
  directly: land the scores in Sheets first.

Starting points are included for LMS-style (Canvas, Schoology, Moodle),
SIS-style (PowerSchool, Infinite Campus, Skyward), Google Classroom / Sheets,
a name-and-percent minimum, per-question analysis, and the full gradebook.

They are honestly labelled as *starting points*. Gradebook import screens are
configured per district and we will not pretend to know yours. Which is why the
next part exists.

### If your gradebook wants something different

Under **More options ▸ Change the columns** you can add, remove, reorder and
rename any column, watch a live preview of your real data, and save the result
as your own layout. It is then picked automatically forever after.

Nobody has to wait for us to ship support for their software. A tech coach can
set it up once and share the layout with a department via **Export backup**.

Also there, and genuinely optional: **Send to a web address** posts the same rows
as JSON to an endpoint your school controls. Most schools will never touch this.

### Other files

**Graded top sheets** — one page per student in `.docx`: the score band, then
every question with what they answered, what was correct, and the points. Not
the test format — a table you can read at a glance.

You decide what else goes on that page. Toggles for: only the questions they
missed, question text, topic/standard, what percent of the class got each one
right, class average, rank, written-answer comments, a blank comment box,
teacher / parent / student-corrections signature lines, and a footer note of your
own.

**Roster import** — Roster ▸ *Import CSV file* takes a gradebook export as-is:
a header row, extra columns, quoted fields, `Last, First` and an email column are
all handled. It fills the paste box so you can check it before saving.

**Item analysis** — `.xlsx` with per-question difficulty, which wrong answer
attracted people, plus raw responses and all written scores.

### Will they open properly?

Yes — and this is checked, not assumed. The `.xlsx` and `.docx` writers here are
hand-built, and the self-test opens every generated file the way Excel and Word
do: it walks the ZIP central directory, verifies every CRC, parses every XML
part, and confirms the internal relationships resolve. Word gets a paragraph in
every table cell and a proper `sectPr`; Excel gets a real styles part with
matching counts, legal unique sheet names, and no dangling style references.

For Google: upload the `.xlsx` and open with Sheets, or the `.docx` and open with
Docs. For CSV in Sheets use **File ▸ Import ▸ Upload**. Names beginning with
`=` or `+` are escaped so a spreadsheet can't turn one into a formula.

---

## Outside the United States

Set **Paper size** on the test to **A4** and the whole sheet is rebuilt for it —
corner squares, bubble grid and answer columns all reposition, and the scanner
adapts automatically because both read the same geometry. US Legal is there too.
A4 fits 87 multiple-choice questions on a page, Letter 104, Legal 152.

Every word printed on the sheet is editable per test: the NAME and CLASS box
labels, the ID heading, the PAGE row, the "how to fill this in" heading, the
three bubble examples and the advice line. Set them once and duplicate the test
as a template. Student names are captured as an image, so any script — accented,
Cyrillic, CJK — works without configuration.

Letter geometry is unchanged from earlier versions, so sheets printed before
paper support existed still scan correctly. There is an automated test asserting
exactly that.

## One test, several periods

List the classes separated by commas — `Biology P1, Biology P3, Biology P5` — and
the test covers all of them: one answer key, one test code, one master sheet.
The roster is the union, sheets print grouped by class, and the gradebook and
review table gain a Class column so you can filter or hand back period by period.

## Printing

**Check it once.** Scan ▸ *Check my printing* (or Roster ▸ *Check my printing*)
reads one freshly printed blank sheet and tells you whether your printer, paper
and lighting are good — it verifies the pre-printed test code and page number
read back correctly and that no blank bubble is being read as filled. Nothing is
recorded. Do this the first time you print on a new copier and you will never
wonder whether a bad scan was the printer.

Print at **100% / Actual size**, margins **None**. A uniform shrink is harmless —
the scanner calibrates from the corner squares — but *don't* let the printer add
a border, and don't write over the corner squares or fold across them.

- **Blank sheets** — the default. Print one, photocopy the rest.
- **Personalized sheets** — name and ID pre-printed. Most reliable, but it is a
  unique page per student, so only practical for small runs.
- **Answer-key sheet** — pre-bubbled with ID `999999`. Scan it and QuickGrade
  fills in the answer key by itself. `999999` is reserved for this.

---

## For the person who has to approve it

- **No account, no backend, no telemetry.** The app is static files. Nothing is
  transmitted anywhere — there is nowhere for it to go.
- **Student data stays on the teacher's device**, in that browser's storage.
  Names, scores and scanned images never leave it.
- **Works fully offline** once loaded.
- **No per-scan or per-teacher licensing.** Nothing expires.
- Scan results are announced to screen readers, every control is labelled, and
  status is never conveyed by colour alone.

The trade-off to be explicit about: because there is no backend, there is also
no central gradebook, no cross-teacher reporting, and no recovery if a teacher
wipes their browser. Regular **Export backup** is the mitigation, and the app
nags if it has been more than a week.

## How big does this get

Measured, not guessed. A full secondary load — 150 students, three pages each,
450 scanned sheets with images, a 50-question test:

| | |
|---|---|
| decode one sheet | 22 ms (fast enough for ~46 camera frames a second) |
| open the test, loading every sheet | 49 ms |
| rescore the whole class | 2 ms |
| draw the review screen | 157 ms |
| build the Excel gradebook | 11 ms |
| build 150 graded top sheets | 45 ms |
| storage used | 96 MB of the ~6 GB the browser allows |

The scanned images are the only large thing, and they stop being useful once a
test is handed back. **Review** shows how much space a test's images take and
offers to reclaim it — every score, answer and comment is kept.

## Where the data lives

In this browser, on this computer (IndexedDB). Nothing is uploaded.

That also means: clearing browser data wipes it, and a different browser or
computer won't see it. Use **Export backup** on the Tests screen for a portable
`.json` of tests, rosters, scans and grades. Scanned images stay local and are
not in the backup — scores and answers are.

---

## Files

```
QuickGrade.html            single-file build - everything inlined
index.html                 the app (loads css/ and js/)
build.py                   regenerates QuickGrade.html from the source
serve.py                   launcher (http, or --https for phones)
Start QuickGrade.bat       double-click to run
Start QuickGrade for Phone.bat
selftest.html              open it to verify everything still works
selftest-storage.html      verifies the file:// storage fallback
css/app.css                the interface
js/sheet.js                sheet geometry - printer and scanner share it
js/vision.js               corner detection, perspective, bubble reading
js/scan.js                 camera loop and accept/reject feedback
js/ooxml.js                ZIP + xlsx/docx writers
js/lib.js                  storage, audio, dom helpers
js/app.js                  state, editors, grading, exports
js/synth.js                test-only sheet/camera simulator
```

Edit files under `js/` and `css/`, then run `python build.py` to refresh
`QuickGrade.html`. Both stay in sync that way.

### The tests

`selftest.html` — 26 checks. Renders answer sheets from the shared geometry,
photographs them in software at five angles (including upside down and steep
perspective), decodes them through the real pipeline, confirms the printed HTML
sheet lines up with what the scanner samples to within 0.0002", checks nothing
printed encroaches on the corner squares, and validates every generated Office
file by walking its ZIP directory and CRCs the way Excel and Word do.

`selftest-storage.html` — 11 checks. Turns IndexedDB off, the way a `file://`
page does, and confirms the fallback still reads and writes correctly.

Both should be all green.

---

## If something goes wrong

**Camera won't start.** You're probably on `http://` and not `localhost`. Use the
phone launcher, or use **Import photos**.

**Sheet won't lock on.** Get all four corner squares in frame with a little
margin. Avoid glare across the page — tilt it rather than the camera. Move
closer if the sheet is small in the frame.

**Reads the wrong answer.** Students should fill bubbles solidly and erase
cleanly. Two marks on one question is reported as a double-mark and scored
incorrect, not guessed at; it's flagged in Review and on the top sheet.

**"Wrong test — sheet is code NNN".** That sheet belongs to a different test.
Each test has its own 3-digit code printed on the sheet; QuickGrade refuses to
mix them.

**Numbers look off.** Check the answer key is complete — the key is row 2 of the
gradebook export, so it's easy to eyeball.
