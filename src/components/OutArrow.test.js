import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Arrows that have an emoji form. A phone may draw any of them as a coloured
// tile in the middle of a line of text: iOS does it to U+2197, the "opens
// elsewhere" arrow, which is the one that kept being typed. The mark for that
// is components/OutArrow.jsx, which draws it. (U+2190 to U+2193, the plain
// left, up, right and down arrows, have no emoji form and are fine.)
const EMOJI_ARROWS = /[\u2194-\u2199\u21A9\u21AA\u2934\u2935]/;

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.(jsx?|css)$/.test(name) && !/\.test\.jsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** A source file without its comments: what can reach the screen. A comment
 *  is free to use any of these as shorthand, and several do. */
function withoutComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('arrows in the interface', () => {
  it('are never typed as a character a phone may turn into an emoji', () => {
    const offenders = sources('src').filter((path) =>
      EMOJI_ARROWS.test(withoutComments(readFileSync(path, 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  it('would catch one in a string or in markup, and lets a comment be', () => {
    expect(EMOJI_ARROWS.test(withoutComments("label: 'View on site \u2197',"))).toBe(true);
    expect(EMOJI_ARROWS.test(withoutComments('<span>Try it \u2197</span>'))).toBe(true);
    expect(EMOJI_ARROWS.test(withoutComments('// height 0 \u2194 auto'))).toBe(false);
    expect(EMOJI_ARROWS.test(withoutComments('/* the sheet\u2194bar seam */ a { b: c }'))).toBe(false);
    // An address is not a comment.
    expect(withoutComments("go('https://example.com/a')")).toBe("go('https://example.com/a')");
  });
});
