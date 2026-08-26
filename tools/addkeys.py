# -*- coding: utf-8 -*-
"""Add or replace keys in the language packs, in place.

  python tools/addkeys.py keys.json

keys.json is { "<lang>": { "<key>": "<value>", ... }, ... }. A key that already
exists is replaced; a new one is appended in its own block at the end of the
object. The packs are the source of truth — there is no intermediate file to
fall out of step with them.
"""
import io, json, re, sys, os

def esc(v):
    return v.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n')

def apply(lang, pairs):
    path = os.path.join('js', 'lang', '%s.js' % lang)
    s = io.open(path, encoding='utf-8').read()
    added, replaced = [], []
    for k, v in pairs.items():
        # an existing entry keeps its place in the file
        pat = re.compile(r"^(\s*)'" + re.escape(k) + r"':\s*'(?:[^'\\]|\\.)*',?\s*$", re.M)
        m = pat.search(s)
        if m:
            trailing = ',' if s[m.end():m.end() + 40].lstrip().startswith("'") or \
                              not s[m.end():].lstrip().startswith('}') else ''
            s = s[:m.start()] + "%s'%s': '%s'%s" % (m.group(1), k, esc(v), trailing) + s[m.end():]
            replaced.append(k)
        else:
            added.append((k, v))
    if added:
        anchor = '\n};\n})(window.QG.I18N);'
        if anchor not in s:
            sys.exit('MISS closing brace in %s' % path)
        block = '\n'.join("  '%s': '%s'," % (k, esc(v)) for k, v in added)
        s = s.replace(anchor, ',\n' + block.rstrip(',') + anchor, 1)
    io.open(path, 'w', encoding='utf-8').write(s)
    print('  %-16s +%d new, %d replaced' % (path, len(added), len(replaced)))

data = json.load(io.open(sys.argv[1], encoding='utf-8'))
for lang in sorted(data):
    apply(lang, data[lang])
