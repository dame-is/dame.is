// The post card's geometry, read off the element tree rather than a rendered
// PNG: where the plates go, how many there are, and what the words column
// holds. The renders themselves are checked by eye (see api/og.js); these pin
// the arithmetic that has to stay true at every hour of the sky.

import { describe, it, expect } from 'vitest';
import { ogElement, THEMES, quoteLines, textWidth } from './design.js';

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

describe('the quote card', () => {
  // The column runs from the divider to the page guide.
  const COL = 1110 - 320;
  const quoteCard = (text, title = 'On Attie, atproto, and AI') =>
    ogElement({ quote: { text, title, section: 'blogging' }, nsid: 'site.standard.document', folio: '12,230', theme: THEMES.light });
  /** Every text leaf as { text, top, size }, top being the box's top edge. */
  const lines = (el) =>
    nodes(el)
      .filter((n) => typeof n.props?.children?.[0] === 'string' && n.props.style?.fontSize)
      .map((n) => ({ text: n.props.children[0], top: n.props.style.top, size: n.props.style.fontSize }));

  it('sets a line or two at nearly headline size, on the coarse rules', () => {
    const { size, pitch, lines: set } = quoteLines('Don’t miss the Atmosphere for the blue sky.', COL);
    expect(size).toBe(54);
    expect(pitch).toBe(70);
    expect(set.join(' ')).toBe('“Don’t miss the Atmosphere for the blue sky.”');
  });

  it('steps a paragraph down to body copy, seven lines at most, every one inside the column', () => {
    const para =
      'The contentious discussions from that week were in one way or another a continuation of the recurring “Bluesky is dying” discourse that has been popping up at least once a quarter. I think it’s worth slowing down and asking what people actually mean by that, because the protocol and the app are not the same thing, and conflating them leads us wrong.';
    const { size, pitch, lines: set } = quoteLines(para, COL);
    expect(pitch).toBe(35);
    expect(set.length).toBeLessThanOrEqual(7);
    for (const l of set) expect(textWidth(l, size)).toBeLessThanOrEqual(COL);
    // Nothing was cut: the whole passage is on the card.
    expect(set.join(' ')).toBe(`“${para}”`);
  });

  it('keeps the closing mark when a passage is too wide for any size', () => {
    const wide = Array.from({ length: 80 }, () => 'MMMM wwww').join(' ');
    const { lines: set, size } = quoteLines(wide, COL);
    expect(set).toHaveLength(7);
    expect(set[6].endsWith('…”')).toBe(true);
    for (const l of set) expect(textWidth(l, size)).toBeLessThanOrEqual(COL);
  });

  it('credits the essay one coarse row under the passage', () => {
    const el = quoteCard('Don’t miss the Atmosphere for the blue sky.');
    const set = lines(el);
    // The credit is a row (a rule, then the title), sized and placed as one.
    const row = nodes(el).find((n) =>
      (n.props?.children || []).some?.((c) => c?.props?.children?.[0] === 'On Attie, atproto, and AI'),
    );
    expect(row).toBeTruthy();
    const title = { top: row.props.style.top, size: row.props.style.fontSize };
    const last = set.filter((l) => l.text.startsWith('“') || l.text.endsWith('”')).pop();
    // Baselines, from the boxes' tops: two lines at 54 on rules 202 and 272,
    // the credit at 28 on 342.
    const baseline = (l) => Math.round(l.top + 0.752 * l.size);
    expect(baseline(last)).toBe(272);
    expect(baseline(title)).toBe(342);
    expect(texts(el)).toContain('blogging');
    expect(texts(el)).toContain('site.standard.document');
  });
});

describe('the newsletter card', () => {
  const letterCard = (letter) =>
    ogElement({
      letter,
      pathname: '/blogging/subscribe',
      nsid: 'site.standard.publication',
      folio: '12,230',
      theme: THEMES.light,
    });

  it('draws the email: its title, the From, an empty To and the latest post as Subject', () => {
    const words = texts(letterCard({ title: 'Letters from dame.is', subject: 'On Attie, atproto, and AI' }));
    for (const w of ['Letters from dame.is', 'from', 'to', 'subject', 'dame.is blogging', 'you@example.com', 'Subscribe', 'On Attie, atproto, and AI', 'site.standard.publication']) {
      expect(words).toContain(w);
    }
  });

  it('keeps a long subject to its one row', () => {
    const subject = 'Building an ATProto-based membership and feature gating system for Anisota, and everything that came after it';
    const words = texts(letterCard({ title: 'Letters', subject }));
    const line = words.find((w) => w.startsWith('Building an ATProto'));
    expect(line).not.toBe(subject);
    expect(line.endsWith('…')).toBe(true);
  });
});
