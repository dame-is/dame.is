// The post card's geometry, read off the element tree rather than a rendered
// PNG: where the plates go, how many there are, and what the words column
// holds. The renders themselves are checked by eye (see api/og.js); these pin
// the arithmetic that has to stay true at every hour of the sky.

import { describe, it, expect } from 'vitest';
import { ogElement, THEMES } from './design.js';

const SRC = 'data:image/jpeg;base64,AAAA';

/** Every node in the tree, depth first. */
function nodes(el, out = []) {
  if (!el || typeof el !== 'object') return out;
  out.push(el);
  const kids = el.props?.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) nodes(k, out);
  return out;
}

/** The text of every leaf that holds a string. */
const texts = (el) =>
  nodes(el)
    .map((n) => n.props?.children)
    .flatMap((c) => (Array.isArray(c) ? c : [c]))
    .filter((c) => typeof c === 'string');

/** The boxes that hold a picture, as { left, top, width, height }. */
const plates = (el) =>
  nodes(el)
    .filter((n) => n.type === 'div' && (n.props.children || []).some((c) => c?.type === 'img' && c.props.src === SRC))
    .map((n) => ({ left: n.props.style.left, top: n.props.style.top, width: n.props.style.width, height: n.props.style.height }));

const card = (post, verb = 'posting') =>
  ogElement({ post, verb, nsid: 'app.bsky.feed.post', folio: '12,227', theme: THEMES.light });

describe('the post card', () => {
  it('rules a single photo onto the grid, right edge on the page guide', () => {
    const [plate] = plates(card({ text: 'gm from cooper', photos: [{ src: SRC, aspect: 4 / 3 }] }));
    // 2½P to 7P, and 4:3 at that height is 420 wide: the widest a plate goes.
    expect(plate).toEqual({ left: 1110 - 420, top: 175, width: 420, height: 315 });
  });

  it('keeps a tall screenshot from becoming a sliver', () => {
    const [plate] = plates(card({ text: 'x', photos: [{ src: SRC, aspect: 0.4 }] }));
    expect(plate.width).toBe(210);
    expect(plate.left + plate.width).toBe(1110);
  });

  it('lays out two, three and four photos the way the app does', () => {
    const photos = (n) => Array.from({ length: n }, () => ({ src: SRC, aspect: 1 }));
    const two = plates(card({ text: 'x', photos: photos(2) }));
    expect(two.map((p) => p.height)).toEqual([315, 315]);
    const three = plates(card({ text: 'x', photos: photos(3) }));
    // The first fills the left half; the other two stack on the right.
    expect(three[0].height).toBe(315);
    expect(three[1].top).toBe(175);
    expect(three[2].top + three[2].height).toBe(490);
    // Every cell's outer edges land on the guide and the rule, to the pixel.
    const four = plates(card({ text: 'x', photos: photos(4) }));
    expect(four).toHaveLength(4);
    for (const p of [...two, ...three, ...four]) {
      expect(p.top).toBeGreaterThanOrEqual(175);
      expect(p.top + p.height).toBeLessThanOrEqual(490);
      expect(p.left + p.width).toBeLessThanOrEqual(1110);
    }
    expect(Math.max(...four.map((p) => p.left + p.width))).toBe(1110);
    expect(Math.max(...four.map((p) => p.top + p.height))).toBe(490);
  });

  it('draws no plate at all for a post without photos', () => {
    expect(plates(card({ text: 'True.', photos: [], author: { name: 'Anisota', handle: 'anisota.net' } }, 'reposting'))).toEqual([]);
  });

  it('quotes somebody else’s words under their name and handle', () => {
    const t = texts(
      card({ text: 'new dispatch!', photos: [], author: { name: 'Poe', handle: 'poe.atpota.to', avatar: null } }, 'reposting'),
    );
    expect(t).toContain('Poe');
    expect(t).toContain('@poe.atpota.to');
    expect(t).toContain('“new dispatch!”');
    expect(t).toContain('reposting');
  });

  it('leaves Dame’s own words unquoted', () => {
    expect(texts(card({ text: 'gm from cooper', photos: [{ src: SRC, aspect: 1 }] }))).toContain('gm from cooper');
  });

  it('sets a name written in fancy letters in the card’s own face', () => {
    const t = texts(card({ text: 'hi', photos: [], author: { name: '𝕮𝖍𝖆𝖗𝖑𝖎𝖊 ✨', handle: 'charliewil.co' } }, 'reposting'));
    expect(t).toContain('Charlie ✨');
  });

  it('captions a photo-only post by its alt text, and a bare one plainly', () => {
    expect(texts(card({ text: '', caption: 'a sunset', photos: [{ src: SRC, aspect: 1 }] }))).toContain('a sunset');
    expect(texts(card({ text: '', standIn: 'A photo', photos: [{ src: SRC, aspect: 1 }] }))).toContain('A photo');
  });
});
