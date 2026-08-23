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

## The five-minute version

1. **Tests → + New test.** Title, class, how many multiple-choice questions,
   how many choices each. Click the answer key letters (or focus one and just
   type `A B D C…` — it advances on its own).
2. **Roster.** Make a class, paste your student names one per line. IDs are
   assigned automatically.
3. **Roster → Print personalized sheets.** Every student gets a sheet with their
   name printed and their ID bubbles already filled in. **Print at 100% / Actual
   size.**
4. Students take the test on those sheets.
5. **Scan.** Hold each sheet up to the camera. Green flash + rising beep = in.
   Keep going; you don't press anything between sheets.
6. **Grade.** Written answers come up one question at a time for the whole class.
   Press a number key, it saves and jumps to the next student.
7. **Export.** Gradebook to Excel/Sheets, top sheets to Word/Docs.

---

## How a sheet gets recognised

The four black squares in the corners tell the scanner where the page is, at any
angle, upside down, hand-held, under bad classroom light. Everything else is
read from fixed positions relative to those squares.

Identity comes from the **student ID bubbles**, not from handwriting — that's
what makes it instant and reliable. On personalized sheets those bubbles are
already printed, so identification is essentially perfect.

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

## Exports

**Gradebook** — `.xlsx` with a frozen header, autofilter, percent formatting, the
answer key as row 2, and per-question columns. Also plain CSV, and **Copy for
Sheets** which puts it on the clipboard ready to paste into cell A1.

**Graded top sheets** — one page per student in `.docx`: the score band, then
every question with what they answered, what was correct, and the points. Not
the test format — a table you can read at a glance.

You decide what else goes on that page. Toggles for: only the questions they
missed, question text, topic/standard, what percent of the class got each one
right, class average, rank, written-answer comments, a blank comment box,
teacher / parent / student-corrections signature lines, and a footer note of your
own. Set them under the test, or on the Export screen.

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

## Printing

Print at **100% / Actual size**, margins **None**. A uniform shrink is harmless —
the scanner calibrates from the corner squares — but *don't* let the printer add
a border, and don't write over the corner squares or fold across them.

- **Personalized sheets** — name and ID pre-printed. Fastest, most reliable.
- **Blank sheets** — students bubble their own ID. Use for a class without a roster.
- **Answer-key sheet** — pre-bubbled with ID `999999`. Scan it and QuickGrade
  fills in the answer key by itself. `999999` is reserved for this.

---

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
