#!/usr/bin/env python3
"""
Inlines the stylesheet and every script into one portable file:

    python build.py   ->  QuickGrade.html

That single file has no side files to fail to load, so it survives being
emailed, dropped on a USB stick, or opened straight off the disk.
"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "QuickGrade.html")


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def guard(js):
    """A literal </script> inside the code would end the tag early."""
    return js.replace("</script", "<\\/script")


html = read("index.html")

# ---- stylesheet -> <style>
css = read("css", "app.css")
html = re.sub(
    r'<link rel="stylesheet" href="css/app\.css">',
    "<style>\n" + css + "\n</style>",
    html,
)

# ---- scripts -> inline, in their original order
scripts = re.findall(r'<script src="(js/[^"]+)"></script>', html)
if not scripts:
    raise SystemExit("no <script src> tags found in index.html")

bundle = []
for src in scripts:
    code = read(*src.split("/"))
    bundle.append("/* ===== %s ===== */\n%s" % (src, guard(code)))

html = re.sub(
    r'<script src="js/[^"]+"></script>\s*',
    "",
    html,
)
html = html.replace(
    "</body>",
    "<script>\n" + "\n".join(bundle) + "\n</script>\n</body>",
)

html = html.replace(
    "<title>",
    "<!-- QuickGrade single-file build. Source lives alongside this file;\n"
    "     rebuild with: python build.py -->\n<title>",
    1,
)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)

print("inlined %d script(s) + %d bytes of css" % (len(scripts), len(css)))
print("wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024))
for s in scripts:
    print("   +", s)
