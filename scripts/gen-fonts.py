#!/usr/bin/env python3
# Builds the self-hosted webfonts in src/assets/fonts/ from upstream sources.
# Run manually whenever a font changes, and commit the output:
#
#   pip install 'fonttools[woff]'
#   git clone --depth 1 https://github.com/Fonthausen/CrimsonPro /tmp/CrimsonPro
#   python3 scripts/gen-fonts.py /tmp/CrimsonPro
#
# Why not Google Fonts: its build of Crimson Pro drops the oldstyle figures
# (`onum`) and the ❧ the site uses as its ornament, and its stylesheet is a
# render-blocking request to a third party before any text can paint. The
# upstream Fonthausen release carries both, and serving it from /assets puts
# it on the same immutable cache as the bundle.
#
# Each face is split the way Google splits it: a "latin" file that nearly
# every page needs and a "latin-ext" file the browser fetches only when a
# character from it appears (a name with a háček, Vietnamese). Every OpenType
# feature is kept. The weight axis is trimmed to 300–700, the range the CSS
# asks for; nothing on the site sets a heavier or lighter weight.
#
# IBM Plex Mono is copied, not built: IBM's own Latin-1 web files from its
# @ibm/plex-mono release, byte for byte. Plex's licence reserves the name
# "Plex", so a subset made here would be a modified font that couldn't keep
# it; IBM's split files are the font as IBM ships it. Latin-1 is all the site
# needs of a mono face: at:// URIs, CIDs and code.
#
# The script prints the unicode-range for each Crimson file; fonts.css
# carries those ranges, and IBM's own for Plex. Both licences are copied in
# beside the files.

import io
import subprocess
import sys
import tarfile
import urllib.request
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'assets' / 'fonts'

# Google's "latin" range, plus the two hederas (☙ ❧) the site sets as its
# ornament, so the fleuron renders in Crimson rather than a fallback font.
LATIN = (
    'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,'
    'U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,'
    'U+2619,U+2767,U+FEFF,U+FFFD'
)

PLEX_VERSION = '2.5.0'
PLEX = f'https://registry.npmjs.org/@ibm/plex-mono/-/plex-mono-{PLEX_VERSION}.tgz'


def codepoints(spec):
    out = set()
    for part in spec.split(','):
        part = part.strip().removeprefix('U+')
        lo, _, hi = part.partition('-')
        out.update(range(int(lo, 16), int(hi or lo, 16) + 1))
    return out


def ranges(cps):
    cps = sorted(cps)
    spans, start, prev = [], cps[0], cps[0]
    for cp in cps[1:]:
        if cp == prev + 1:
            prev = cp
            continue
        spans.append((start, prev))
        start = prev = cp
    spans.append((start, prev))
    return ', '.join(
        f'U+{a:04X}' if a == b else f'U+{a:04X}-{b:04X}' for a, b in spans
    )


def subset(src, unicodes, out):
    subprocess.run(
        [
            sys.executable, '-m', 'fontTools.subset', str(src),
            f'--unicodes={unicodes}',
            '--layout-features=*',
            '--flavor=woff2',
            f'--output-file={out}',
        ],
        check=True,
    )
    print(f'  {out.name}: {out.stat().st_size / 1024:.1f} KB')


def crimson(repo):
    variable = Path(repo) / 'fonts' / 'variable'
    latin = codepoints(LATIN)
    for style, name in (('CrimsonPro[wght]', 'roman'), ('CrimsonPro-Italic[wght]', 'italic')):
        trimmed = OUT / f'.{name}.ttf'
        subprocess.run(
            [
                sys.executable, '-m', 'fontTools.varLib.instancer',
                str(variable / f'{style}.ttf'), 'wght=300:700',
                '-o', str(trimmed), '-q',
            ],
            check=True,
        )
        covered = set(TTFont(trimmed).getBestCmap())
        ext = covered - latin
        print(f'crimson-pro-{name}')
        subset(trimmed, LATIN, OUT / f'crimson-pro-{name}-latin.woff2')
        subset(trimmed, ranges(ext).replace(' ', ''), OUT / f'crimson-pro-{name}-latin-ext.woff2')
        print(f'  latin-ext unicode-range: {ranges(ext)}')
        trimmed.unlink()
    (OUT / 'OFL-CrimsonPro.txt').write_bytes((Path(repo) / 'OFL.txt').read_bytes())


def plex():
    tgz = tarfile.open(fileobj=io.BytesIO(urllib.request.urlopen(PLEX).read()))
    for weight, file in ((400, 'Regular'), (500, 'Medium')):
        member = tgz.extractfile(f'package/fonts/split/woff2/IBMPlexMono-{file}-Latin1.woff2')
        out = OUT / f'ibm-plex-mono-{weight}-latin1.woff2'
        out.write_bytes(member.read())
        print(f'  {out.name}: {out.stat().st_size / 1024:.1f} KB')
    (OUT / 'OFL-IBMPlexMono.txt').write_bytes(tgz.extractfile('package/LICENSE.txt').read())


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: gen-fonts.py <path to a Fonthausen/CrimsonPro checkout>')
    OUT.mkdir(parents=True, exist_ok=True)
    crimson(sys.argv[1])
    plex()
