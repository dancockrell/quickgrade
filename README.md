# QuickGrade

**A paper-test grader built around the way teachers actually use paper.**

QuickGrade scans paper tests with a webcam, phone camera, or imported photos. It grades multiple choice, collects written answers for fast marking, and exports to Excel, Sheets, Word or Docs.

It needs no account, subscription, backend, or live internet connection after it loads. Student records stay on the teacher's device unless the teacher deliberately exports or sends them somewhere.

The interface speaks **English, العربية, हिन्दी, Tagalog, Русский, ไทย and 한국어**. The language reaches the printed paper, graded student sheets, and exports as well as the interface.

---

## The physical workflow

QuickGrade is designed for schools where an office printer can make a master but a photocopier does the classroom volume.

1. Create the test and paste the answer key.
2. Print **one master** at 100% / Actual size.
3. Photocopy that master for the class.
4. Students answer the test. They do **not** have to bubble a student ID for QuickGrade.
5. Collect one student's physical test packet.
6. Scan page 1, then the rest of that student's pages.
7. Move to the next student's packet.
8. If QuickGrade cannot determine whose packet it is, it keeps the whole packet together and you assign it once in **Review**.

The paper has one small machine mark: a **QR code in the bottom-left corner**. There are no scanner corner squares, registration border, page-number bubbles, or student-ID bubble matrix on new sheets.

The QR identifies the document, not the child. It contains the test/version code, page number, total pages, paper/layout revision and an integrity check. The QR's known physical position also gives the scanner its geometry.

That separation is deliberate: one photocopied master cannot contain a different printed student identity on every copy. QuickGrade never pretends otherwise.

---

## Start it

### Computer with webcam

Double-click **`Start QuickGrade.bat`**. The browser opens at `http://localhost:8080`.

### Phone camera

Double-click **`Start QuickGrade for Phone.bat`**, then open the `https://192.168.x.x:8443` address it prints on a phone connected to the same Wi-Fi.

The browser may warn about the local certificate. That is normal for a server running on your own computer. You can also avoid the live-camera path entirely: photograph the tests with the phone's normal camera app and use **Import photos**.

### Hosted HTTPS — recommended for a school

QuickGrade is a static app. Put the folder on a school web server, GitHub Pages, Netlify, or another HTTPS static host.

That gives teachers a normal URL, removes launcher/certificate friction, allows camera access on phones, works on locked-down laptops, and can be installed as a PWA. Once cached, the app keeps working offline.

Hosting does **not** create a QuickGrade backend. The host serves the application files; rosters, scans, scores and comments remain in the teacher's browser storage.

### Single-file version

`QuickGrade.html` is a generated, self-contained build. Rebuild it after source changes with:

```bash
python build.py
```

The source version is preferred for development and hosted use. The single-file build is useful for USB drives, email and offline grading. Browsers do not permit live camera access from ordinary `file://` pages, so use imported photos or the local/hosted version when scanning.

---

## The first minute

On an empty install QuickGrade asks only:

1. What is the test called?
2. Which class is it for?
3. What is the answer key?

Paste the key in the form you already have. QuickGrade infers question count and choice count, shows what it understood, and creates the photocopy master.

It does not require a roster before you can create or print a test.

---

## Five-minute version

1. **Tests → + New test.** Enter a title/class and use **Paste my answer key**.
2. Add a roster if you want names in Review/exports. Roster import accepts pasted names or messy gradebook CSVs.
3. **Roster → Print the answer sheet.** Print one master and photocopy it for the class.
4. Students take the test normally.
5. **Scan.** Pick up one student's packet. Scan page 1 and then every other page from that same packet.
6. If another page 1 appears before the current packet is complete, QuickGrade warns which pages are still missing.
7. **Review.** Uncertain marks and unassigned packets are grouped for correction. Assigning an anonymous multi-page packet assigns every page together.
8. **Grade.** Mark written answers one question across the class at a time.
9. **Export.** Send scores to your gradebook or produce student hand-back sheets.

---

## One master, photocopied

The normal QuickGrade workflow never requires unique per-student printing.

Every copy of page 1 is intentionally identical when it leaves the photocopier. Every copy of page 2 is identical, and so on. The QR therefore contains only facts that are genuinely known before the test is handed out:

- QuickGrade geometry/layout revision
- test/version code
- page number
- total pages
- paper size family
- normal sheet vs answer-key sheet
- checksum

Student ownership is established at the **packet level while scanning**, not by adding machine bureaucracy for the student.

If a student writes a usable name, that is useful human evidence. If they write nothing, QuickGrade still captures the complete packet. It does not discard later pages and does not silently invent a student. The packet waits in Review until the teacher assigns it once.

---

## How the QR is used

New sheets place one copier-safe QR near the **bottom-left** corner. Bottom-left avoids the common page-number/header area used by existing tests.

The scanner finds the QR first, which identifies and orients the sheet. It then fits the natural paper edges near the QR-derived prediction, using the QR as an independent geometry check. That full-page fit gives QuickGrade the coordinate system for answer bubbles and written-response regions without a printed registration border.

The QR also provides a known high-contrast object for quality checks. A readable QR is not automatically enough to grade a page: QuickGrade can reject the capture if the projected page leaves the camera frame or the QR/page is too small for trustworthy answer sampling.

The QR payload has an integrity check. A damaged code should either decode correctly or fail; it must not quietly become a plausible different test/page.

Old QuickGrade sheets that used the previous registration-border/ID system remain supported through the legacy scanner path. New paper uses the QR path first.

---

## Scanning packets

For a multi-page test, think in terms of a physical packet rather than independent loose sheets.

**Normal flow**

```text
Student A: page 1 → page 2 → page 3
Student B: page 1 → page 2 → page 3
Student C: page 1 → page 2 → page 3
```

Pages inside the current packet do not have to be perfectly ordered. If page 3 arrives before page 2, QuickGrade can accept it and continue to show that page 2 is still missing.

What should not happen silently is starting another student's page 1 while pages from the current packet are missing. QuickGrade warns before the teacher loses track of the physical packet.

A continuation page from another test/version is also refused as a continuation of the active packet. A valid QR for version B does not get filed into an open version A packet simply because both versions belong to the same test.

### If the student identity is unknown

That is a valid state, not a scanning failure.

QuickGrade gives the physical packet a temporary internal identity, keeps its pages together, and shows **one** unresolved packet in Review. The temporary identifier is not presented as though it were a student number.

Assign that Review item to a roster student once and every page in the packet moves together.

---

## Scan feedback

The teacher should not have to understand computer vision. Feedback is about what to do next.

Typical states are:

| Situation | What QuickGrade does |
|---|---|
| Page accepted | green feedback / success sound |
| Packet complete | completion chime |
| Still missing pages | shows the page numbers still needed |
| New page 1 before current packet is complete | warns before moving on |
| Different test/version continuation | refuses automatic packet ownership and sends it to Review |
| Packet student unknown | keeps packet together for one Review assignment |
| Duplicate page | keeps/replaces according to the existing duplicate-scan rule |
| QR/page too small or page cropped | does not grade optimistically |
| Different test | refuses to mix it into the selected test |

**Speak** can announce useful scan feedback when the teacher is looking at the paper rather than the screen.

---

## Making a test out of what you already have

You should not have to retype an answer key. **Paste my answer key** accepts common forms such as:

```text
1. B            1) b           1 - B         1,B          B C A D E
2. C            2) c           2 - C         2,C          BCADE
3. A            3) a           3 - A         3,A          B
                                                          C
1. What powers the cell? B      True
2. Which organelle folds protein? C  False
```

It also accepts tabs copied from a spreadsheet, upper/lower case, numbered T/F, Word punctuation and other ordinary formatting. It warns about gaps/duplicates and rejects prose it cannot confidently interpret rather than guessing.

If question wording is included, QuickGrade can keep it for graded student sheets.

**Paste my questions** handles written questions and point values, for example:

```text
Explain osmosis. (5 points)
Name three organelles - 6 pts
Compare mitosis and meiosis
```

A written question without an explicit value defaults to 5 points.

---

## Two versions of the same test

Create version B by rearranging the questions in your own test document, then use **+ Add a second version** and paste version B's key.

Each version has its own QR test/version code. The scanner uses the code in the QR to select the correct answer key automatically.

Packets from version A and B can be interleaved between students. What QuickGrade will not do is silently splice a continuation page from version B into an already-open version A packet.

Version-specific scoring rules remain independent: dropping or correcting a bad question on version B does not alter version A.

---

## Reviewing uncertain marks

QuickGrade saves crops of marks it could not read cleanly. Review shows the actual paper rather than only a confidence number.

Typical reasons include:

- more than one answer bubble appears filled
- a mark is faint or partly erased
- a nominally blank answer looks suspicious
- a packet has not yet been assigned to a student
- a page conflicts with the currently open packet/version

Confirm or correct the result once and it stops asking.

Review can also show missing pages before an incomplete test is exported as a confident low score.

---

## Grading written answers

**Grade** shows one written question across the class before moving to the next question. That keeps the teacher in one marking frame instead of repeatedly switching rubrics.

Common keys:

| Key | Action |
|---|---|
| `0`–`9` | award points, save, next |
| `.` | half point |
| `F` / `Z` | full credit / zero |
| `Enter` | save and next |
| `←` | previous |
| `S` | skip |

**Blind** hides student names while marking. Quick-comment chips reduce repetitive typing.

Written questions can also use a rubric with criterion levels; the resulting points feed the same grading/export pipeline.

---

## Objectives and item analysis

Questions can be tagged with standards/objectives/topics. Paste mappings such as:

```text
Cells: 1-8
Transport: 9-16
Energy: 17-24, 30
```

QuickGrade reports weak objectives, can include mastery information on graded sheets, and adds objective-level information to item-analysis exports.

Dropping a bad question removes it from both scoring and its objective statistics.

---

## Fixing a bad question after the test

Nothing needs rescanning. In Review a question can be changed to:

- drop the question
- accept another answer
- give everyone credit
- change its point value

The app previews how many students are affected. The original student responses remain unchanged; only the scoring rule changes, so the adjustment is reversible.

Curves are available on Export: add raw points, add percentage points, or scale the top score to 100%.

---

## Exports

### Gradebook

Choose a gradebook format once and QuickGrade remembers it.

- **Download for my gradebook** — `.xlsx`
- **Copy — paste into Google Sheets** — tabular clipboard output
- `.csv` is also available

Built-in layouts are starting points for common LMS/SIS workflows. District import formats vary, so column order/headings can be changed and saved as a custom layout.

An optional **Send to a web address** action posts rows as JSON to an endpoint explicitly configured by the school. It is off unless a teacher enters an address and uses it.

### Graded student sheets

Export one hand-back page per student to `.docx` or print/PDF. Options include missed questions only, question text, objective, class statistics, written comments, signatures and footer notes.

### Item analysis

The workbook includes per-question results, response distributions, raw answers, written scores and mastery information where configured.

The hand-built `.xlsx`/`.docx` writers are tested by validating their ZIP/XML structure, CRCs, relationships and required Office document parts.

---

## Roster import

Roster entry is optional for creating/printing/scanning a test but useful for assigning anonymous packets and exporting grades.

Paste one student per line or import a gradebook CSV/TSV. QuickGrade tolerates header rows, extra columns, quoted `Last, First` names, IDs and email columns, and lets you inspect the parsed result before saving it.

---

## Paper sizes and languages

QuickGrade supports US Letter, A4 and US Legal. The renderer and scanner share the same geometry source, so answer positions adapt to the selected paper.

The QG3 QR payload includes the paper/layout family so the printed document carries the geometry information the scanner needs.

Printed wording can be localized or overridden per test. Student handwriting is stored as image evidence rather than requiring OCR, so names/scripts do not need special scanner support.

Legacy sheets remain readable through the old geometry path.

---

## Printing

Print at **100% / Actual size**. Make one good master, then use the photocopier for classroom volume.

The one machine mark to protect is the **bottom-left QR**. Do not crop it, cover it with a staple, or fold directly through it.

The QR is deliberately inset from the physical page edge and includes a copier-safe white quiet zone around the black modules.

### Check my printing

Use **Check my printing** with a fresh blank copy when changing printer/copier settings. The check verifies that the document QR/page can be read and that blank answer bubbles are not being mistaken for filled answers.

If a capture is too distant, cropped or geometrically implausible, the scanner should reject it rather than grading from a weak transform.

### Answer-key sheet

The answer-key sheet uses the same bottom-left QR. A field inside the QR marks it as a key sheet; it no longer depends on a magic student-ID bubble value.

---

## Sample class

**Sample class** generates a small roster, renders answer sheets, photographs them in software, and sends the images through the real scanner/scoring path.

It exists so a teacher or reviewer can exercise the product without a printer/camera. The synthetic camera path is also used heavily by automated QA.

Because normal QG3 paper contains no printed student identity, the demo resolves its own synthetic packets to its known synthetic roster after scanning. That shortcut is demo-only; real packets are assigned through the normal Review workflow when ownership is unknown.

---

## What happens to student data

- **No account, backend or telemetry.** QuickGrade is static application files.
- **Student data stays in the browser** on the teacher's device.
- **Nothing is transmitted by default.** The optional explicit “send scores to a web address” export is the exception and has no destination until the teacher supplies one.
- **Works offline** after the hosted/PWA copy has been cached.
- **Exports are deliberate.** Files go to the teacher's Downloads folder like ordinary files.
- **Deleting is real.** Removing tests/scans removes their stored records/images according to the app's delete/recovery workflow.
- **The source is public**, so the behavior can be inspected rather than taken on trust.

There is a trade-off: no backend means no automatic cross-device sync or server recovery. Use **Export backup** regularly. Clearing browser site data or losing the device can otherwise remove local records.

Scanned images are the largest storage item. Review can reclaim image storage after the paper has been dealt with while retaining answers, scores and comments.

---

## Deleting scans

Deleting scans is reversible initially: they move to the recoverable area in Review and keep their image data so a restore is complete. Permanent purge removes the scan and associated blobs.

---

## Files

```text
QuickGrade.html            generated single-file build
index.html                 source app shell
build.py                   rebuilds QuickGrade.html and service-worker cache
serve.py                   local launcher
Start QuickGrade.bat
Start QuickGrade for Phone.bat
selftest.html              legacy geometry + file/export self-test
selftest-storage.html      file:// storage fallback test
css/app.css                interface styles
js/sheet.js                canonical answer-sheet geometry
js/vision.js               legacy detection + perspective + bubble reading
js/qrpacket.js             QG3 QR geometry, packet continuity, Review grouping
js/scan.js                 camera/import loop and feedback
js/scoring.js              scoring/version logic
js/ooxml.js                xlsx/docx writer
js/app.js                  state, editors, grading, exports
js/synth.js                synthetic paper/camera generator
```

`selftest.html` intentionally exercises the legacy sheet geometry. That is useful: QG3 can evolve while previously printed QuickGrade sheets continue to have a dedicated compatibility test.

---

## Checking a change

Install Playwright dependencies in `tools/`, start QuickGrade on port 5200, then:

```bash
cd tools
npm test
```

or from the repository root:

```bash
node tools/check.js
```

The runner discovers `test-*.js` suites, reports suites that assert nothing, and distinguishes hardware-required skips from passing tests.

Scanner work has a fast regression gate in GitHub Actions before the longer full suite. It covers QR geometry/corruption, packet continuity, anonymous packet assignment, paper sizes, versions and first-run workflow.

Useful focused tools include:

```bash
node tools/walkthrough.js <outDir> [lang] [width]
node tools/test-slowphone.js [throttle...]
node tools/test-android.js
```

`test-slowphone.js` checks the scanner and teacher interactions under CPU throttling. `test-android.js` uses a real/emulated Android Chrome through adb when hardware is available.

GitHub Actions also runs `build.py` so `QuickGrade.html`, `sw.js`, the service-worker cache hash and precache list cannot silently drift from source.

---

## If something goes wrong

**Camera won't start.** Use localhost/HTTPS or import photos. Browsers restrict live camera access on insecure/file pages.

**Sheet won't read.** Keep the bottom-left QR visible, include the whole page in frame, flatten severe bends and move closer if the page is tiny in the camera view.

**Wrong test/version warning.** The QR belongs to a different test or version. QuickGrade refuses to splice it into the current packet.

**Missing pages warning.** Finish scanning the current student's physical packet before starting the next one, or deliberately set the incomplete packet aside and resolve it in Review.

**Student unknown.** Nothing has been lost. The whole packet is kept together. Assign the single unresolved packet in Review.

**Reads the wrong answer.** Students should fill answer bubbles solidly and erase changes cleanly. Multiple/faint marks are flagged rather than silently guessed where confidence is poor.

---

## Licence

MIT — see [LICENSE](LICENSE). Use it, change it, translate it, host it for a school, or adapt it to another education system.
