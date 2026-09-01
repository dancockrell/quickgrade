#!/usr/bin/env python3
"""
Inlines the stylesheet and every script into one portable file:

    python build.py   ->  QuickGrade.html

That single file has no side files to fail to load, so it survives being
emailed, dropped on a USB stick, or opened straight off the disk.
"""
import base64
import hashlib
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
# A function replacement, not a string: CSS legitimately contains
# backslashes and re.sub would read those as group references.
html = re.sub(
    r'<link rel="stylesheet" href="css/app\.css">',
    lambda m: "<style>\n" + css + "\n</style>",
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

# ---- make the single file genuinely single ---------------------------------
# It claimed to be self-contained while still pointing at a manifest and two
# icon files. Emailed on its own those simply 404: no favicon, and a manifest
# that could not be installed from a file:// page anyway. The icon is small
# enough to carry inline, and the manifest belongs only to the hosted copy.
icon_b64 = base64.b64encode(open(os.path.join(ROOT, "icons", "icon-192.png"), "rb").read()).decode()
icon_uri = "data:image/png;base64," + icon_b64
html = re.sub(r'<link rel="manifest"[^>]*>\s*', "", html, count=1)
html = html.replace('href="icons/icon-192.png"', 'href="' + icon_uri + '"')

html = html.replace(
    "<title>",
    "<!-- QuickGrade single-file build. Source lives alongside this file;\n"
    "     rebuild with: python build.py -->\n<title>",
    1,
)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html)


# ---- keep the service worker honest ----------------------------------------
# Its cache name and its precache list used to be maintained by hand, with a
# comment asking whoever edited the app to remember. Nobody remembers. The
# consequence is real: a stale cache name ships an update that returning users
# never receive, and a precache list that has fallen behind means a file the
# app needs is simply absent offline. The language modules had gone missing
# from it, so an offline install would have rendered the entire interface as
# raw dotted keys.
#
# Both are derived from the actual files now, so they cannot drift.
def sync_service_worker(script_paths):
    sw_path = os.path.join(ROOT, "sw.js")
    if not os.path.exists(sw_path):
        return None
    sw = read("sw.js")

    shell = ["./", "./index.html", "./css/app.css"]
    shell += ["./" + p for p in script_paths]
    shell += ["./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"]

    # A content hash, so the cache name changes exactly when a cached file does.
    h = hashlib.sha256()
    for rel in shell:
        f = os.path.join(ROOT, rel[2:]) if rel != "./" else os.path.join(ROOT, "index.html")
        if os.path.exists(f):
            with open(f, "rb") as fh:
                data = fh.read()
            # Git may check text out as CRLF on Windows and LF in Actions.
            # Hash the logical source, not the platform-specific checkout,
            # or an otherwise identical CI rebuild creates a new cache name.
            if not f.lower().endswith(".png"):
                data = data.replace(b"\r\n", b"\n")
            h.update(rel.encode("utf-8") + b"\0" + data)
    version = "quickgrade-" + h.hexdigest()[:12]

    new_sw, n1 = re.subn(r"var CACHE = '[^']*';",
                         "var CACHE = '%s';" % version, sw, count=1)
    lines = ",\n".join("  '%s'" % r for r in shell)
    listing = "var SHELL = [\n" + lines + "\n];"
    # a function replacement, so backslashes in paths are never read as groups
    new_sw, n2 = re.subn(r"var SHELL = \[[^\]]*\];", lambda m: listing,
                         new_sw, count=1)
    if not (n1 and n2):
        raise SystemExit("build: could not update sw.js (CACHE=%d SHELL=%d)" % (n1, n2))
    if new_sw != sw:
        with open(sw_path, "w", encoding="utf-8") as f:
            f.write(new_sw)
    return version, len(shell)


sw_info = sync_service_worker(scripts)

print("inlined %d script(s) + %d bytes of css" % (len(scripts), len(css)))
if sw_info:
    print("service worker: %s, %d files precached" % sw_info)
print("wrote %s (%.0f KB)" % (OUT, os.path.getsize(OUT) / 1024))
for s in scripts:
    print("   +", s)
