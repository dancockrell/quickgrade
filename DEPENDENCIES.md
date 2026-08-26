# quickgrade — external dependencies

**None of this is declared in `package.json`, `Cargo.toml`, or any
other manifest in this repository.** If you are cleaning up this
machine, these look like unrelated clutter and are not.

Generated from the shared memory database. Edit there, not here:
`python C:\Users\Admin\dev\memory-db\mem.py dep quickgrade NAME --why "..."`

## Required

### CPython 3.13

- Location: `AppData/Local/Programs/Python/Python313/python.exe`
- Why: build.py regenerates sw.js and the single-file QuickGrade.html, and the build test fails without it. No manifest names an interpreter, and the obvious names on PATH are Store aliases that do nothing. See trap python-none-on-path.

### playwright + chromium browser cache

- Location: `Downloads/testgrader/tools/node_modules and AppData/Local/ms-playwright`
- Source: https://playwright.dev
- Why: The whole 21-suite harness is Playwright driving headless Chromium. tools/package.json names playwright, but nothing records that the browser binaries live in a separate machine-wide cache that can be stripped independently of node_modules. Both have to be present: npm install, then npx playwright install chromium.
