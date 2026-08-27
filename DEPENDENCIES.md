# quickgrade — external dependencies

**None of this is declared in `package.json`, `Cargo.toml`, or any
other manifest in this repository.** If you are cleaning up this
machine, these look like unrelated clutter and are not.

Generated from the shared memory database. Edit there, not here:
`python C:\Users\Admin\dev\memory-db\mem.py dep quickgrade NAME --why "..."`

## Required

### CPython 3.13

- Location: `C:/Users/Admin/AppData/Local/Programs/Python/Python313`
- Why: build.py regenerates sw.js and the single-file QuickGrade.html, and the build check fails without it. No manifest names an interpreter, and the obvious names on PATH are Store aliases that execute nothing. The binary is python.exe inside this directory. See trap python-none-on-path.

### chromium browser cache (playwright)

- Location: `C:/Users/Admin/AppData/Local/ms-playwright`
- Source: https://playwright.dev
- Why: Where playwright keeps the browsers it downloads. Separate from node_modules and strippable independently of it: on 26 Aug 2026 icudtl.dat vanished from here and Chrome launched then died while --version still worked. Restore with npx playwright install chromium --force. See trap file-stripping.

### playwright (node package)

- Location: `C:/Users/Admin/Downloads/testgrader/tools/node_modules`
- Source: https://playwright.dev
- Why: The whole test harness is Playwright driving headless Chromium. tools/package.json names the package but nothing records that the browser binaries live in a separate machine-wide cache, listed as its own row. Both must be present.
