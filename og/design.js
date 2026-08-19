// The dynamic Open Graph card design, shared by the /api/og serverless
// function and the local sample renderer. Framework-free: builds a satori
// element tree with a tiny hyperscript helper so it works the same in a plain
// Node script and inside @vercel/og.
//
// The look is a "notebook / design-layout" page drawn straight from the site's
// own system (src/styles/theme.css, the ruled home hero in src/styles/app.css):
//   • warm paper ground, Crimson Pro serif throughout, moss accent
//   • a VISIBLE baseline grid — coarse rules for headings, half-pitch rules for
//     body copy — with every line locked so its baseline rests on a rule
//     (descenders dip below, like writing on ruled paper)
//   • "dame.is" leads a spaced breadcrumb; the big text is just the page's
//     gerund (accent italic). No repeated wordmarks.
//   • marginalia instead of a footer: the day-of-life "folio" (a notebook page
//     number) and the page's AT-Protocol NSID
//   • the current sky-avatar rides beside the breadcrumb as a graphic that
//     crosses the top rule, so cards drift through the day like the favicon
//
// The home card is a table-of-contents "index" of the site's surfaces, each
// paired with its lexicon, cascading and fading down the page.

// ── which layout ships ──────────────────────────────────────────────────────
// SUBPAGE: 's4' (day-of-life gutter, content flush to a divider) | 's0' (clean)
// HOME:    'h4' (index of surfaces)                              | 'h1' (hero)
const SUBPAGE_LAYOUT = 's4';
const HOME_LAYOUT = 'h4';
const SHOW_AVATAR = true;

// ── palettes (light + dark, from theme.css) ─────────────────────────────────
// These fixed warm-paper palettes are the fallback / debug themes; the live
// cards derive their palette from the current hour's SKY theme instead (see
// themeFromSky below and api/og.js), so a card drifts through the day in
// lockstep with the site, the favicon, and the baked-in sky-avatar.
export const THEMES = {
  light: { page: '#f1ead4', ink: '#1d2419', inkSoft: '#364034', inkMuted: '#6f6e58', inkFaint: '#9d9784', rule: '#cabf9f', accent: '#5e7a47', tan: '#a88c5f', grid: 'rgba(29,36,25,0.14)', gridStrong: 'rgba(29,36,25,0.24)', gridFine: 'rgba(29,36,25,0.09)' },
  dark: { page: '#1d2419', ink: '#ece4cb', inkSoft: '#d2c9ac', inkMuted: '#9a9377', inkFaint: '#6a6450', rule: '#3a4232', accent: '#a3b486', tan: '#c9a87a', grid: 'rgba(236,228,203,0.12)', gridStrong: 'rgba(236,228,203,0.22)', gridFine: 'rgba(236,228,203,0.09)' },
};

// Map a sky-theme palette (src/lib/skyTheme.js → paletteForHour) onto the card's
// design tokens, so the OG card uses the exact same hour-derived colors the app
// paints with. The sky palette already ships hex tokens for page/ink/accent/…;
// the visible baseline grid is drawn from the ink color at the same alphas the
// fixed themes use (a touch stronger by day, when the page is light).
export function themeFromSky(palette) {
  const v = (palette && palette.vars) || {};
  const ink = v['--sky-ink'] || '#1d2419';
  const [ir, ig, ib] = hexRgb(ink);
  const inkA = (a) => `rgba(${ir},${ig},${ib},${a})`;
  const day = Boolean(palette && palette.day);
  return {
    page: v['--sky-page'] || THEMES.light.page,
    ink,
    inkSoft: v['--sky-ink-soft'] || THEMES.light.inkSoft,
    inkMuted: v['--sky-ink-muted'] || THEMES.light.inkMuted,
    inkFaint: v['--sky-ink-faint'] || THEMES.light.inkFaint,
    rule: v['--sky-rule'] || THEMES.light.rule,
    accent: v['--sky-accent'] || THEMES.light.accent,
    tan: v['--sky-tan'] || THEMES.light.tan,
    grid: inkA(day ? 0.14 : 0.12),
    gridStrong: inkA(day ? 0.24 : 0.22),
    gridFine: inkA(0.09),
  };
}

// ── geometry ────────────────────────────────────────────────────────────────
const W = 1200, H = 630;
const P = 70;    // coarse baseline unit (9 rows)
const HP = 35;   // half-pitch — an exact subdivision, so tighter body rules
                 // always coincide with the coarse grid (nothing drifts)
const PAD = 90;  // page margin (vertical guides live here)
const R = 0.752; // baseline ratio for line-height:1 Crimson Pro (calibrated)
const LE = 6;    // "edge" lift — breadcrumb / folio / nsid sit close to the rule

// satori requires every <div> with >1 child to declare an explicit display —
// default divs to flex and drop nullish children so callers can use `cond &&`.
const h = (type, props = {}, ...children) => {
  const kids = children.flat().filter((c) => c !== null && c !== undefined && c !== false);
  const style = { ...(props.style || {}) };
  if (type === 'div' && style.display === undefined) style.display = 'flex';
  return { type, props: { ...props, style, children: kids } };
};

const hexRgb = (x) => { x = x.replace('#', ''); return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)); };
// blend two hex colors; used for the home index's cascade-fade toward paper.
const mix = (a, b, tt) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * tt)).join(',')})`; };

// The visible grid: coarse rules across the whole card + optional half-pitch
// rules within given y-bands (only where they don't already fall on a coarse
// rule) + vertical guides.
function gridLayer(t, { halfBands = [], verticals = [PAD, W - PAD] } = {}) {
  const kids = [];
  for (let y = P; y < H; y += P) kids.push(h('div', { style: { position: 'absolute', left: 0, top: y, width: W, height: 1, background: t.grid } }));
  for (const b of halfBands) for (let y = b.from; y < b.to + 0.5; y += HP) if (y % P !== 0) kids.push(h('div', { style: { position: 'absolute', left: 0, top: y, width: W, height: 1, background: t.gridFine } }));
  for (const v of verticals) {
    const x = typeof v === 'object' ? v.x : v;
    kids.push(h('div', { style: { position: 'absolute', left: x, top: 0, width: 1, height: H, background: (typeof v === 'object' && v.strong) ? t.gridStrong : t.grid } }));
  }
  return h('div', { style: { position: 'absolute', left: 0, top: 0, width: W, height: H, display: 'flex' } }, ...kids);
}

// A single line of text whose BASELINE sits at `by` (line-height:1, so the
// baseline is `R*size` below the box top — we back that out here).
function at(text, { size, by, left = PAD, right, weight = 600, italic = false, color, ls }) {
  const style = { position: 'absolute', top: by - R * size, fontSize: size, lineHeight: 1, fontWeight: weight, fontStyle: italic ? 'italic' : 'normal', color, fontFamily: 'Crimson Pro' };
  if (ls) style.letterSpacing = ls;
  if (right !== undefined) style.right = right; else style.left = left;
  return h('div', { style }, text);
}

// A baseline-aligned flex row (mixed colors, e.g. the breadcrumb). Same size
// throughout so all children share one baseline at `by`.
function rowAt(children, { size, by, left = PAD, gap = 16 }) {
  return h('div', { style: { position: 'absolute', left, top: by - R * size, height: size, display: 'flex', alignItems: 'baseline', gap, fontSize: size, lineHeight: 1, fontFamily: 'Crimson Pro' } }, ...children);
}

// The sky-avatar as a graphic: vertically centered on the breadcrumb text so
// it crosses the top rule rather than sitting on it.
function avatarMark(t, avatarUri, { textBaseline, size = 28, left = PAD, box = 46 }) {
  if (!avatarUri) return null;
  const capCenter = textBaseline - 0.36 * size;
  return h('img', { src: avatarUri, width: box, height: box, style: { position: 'absolute', left, top: capCenter - box / 2, border: `1px solid ${t.rule}` } });
}

// dame.is / seg / seg — spaced breadcrumb, last segment emphasized.
function breadcrumbParts(t, segs) {
  const parts = [h('div', { style: { color: t.inkFaint } }, 'dame.is')];
  segs.forEach((s, i) => {
    parts.push(h('div', { style: { color: t.inkFaint } }, '/'));
    parts.push(h('div', { style: { color: i === segs.length - 1 ? t.inkSoft : t.inkMuted, fontWeight: i === segs.length - 1 ? 600 : 400 } }, s));
  });
  return parts;
}

// Rough word-wrap to a pixel width (Crimson Pro avg advance ≈ 0.49·size). Good
// enough for the short, known page descriptions; each resulting line is then
// placed on its own half-rule so the body copy sits on ruled paper.
function wrapText(text, size, maxWidth) {
  const per = size * 0.49;
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length * per > maxWidth && line) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Join as many of `items` as fit on ONE line at `size`, separated by ' · ',
 * ending in an ellipsis when some are left out. Cutting between items rather
 * than mid-word is the point: where this is used the items are the names of
 * the moths pictured above it, and half a name identifies nothing.
 */
function joinToWidth(items, size, maxWidth, sep = ' · ') {
  const per = size * 0.49; // Crimson Pro's average advance, as in wrapText
  let line = '';
  for (let i = 0; i < items.length; i += 1) {
    const next = line ? `${line}${sep}${items[i]}` : String(items[i]);
    // Reserve room for the ' …' — unless this is the last one, which leaves
    // nothing out and so needs none.
    const reserve = i < items.length - 1 ? 2 : 0;
    if ((next.length + reserve) * per > maxWidth) {
      return line ? `${line} …` : wrapText(next, size, maxWidth)[0];
    }
    line = next;
  }
  return line;
}

// The big gerund shrinks for longer labels so it never runs past the column.
function titleSize(label, base, maxChars) {
  const n = (label || '').length;
  return n <= maxChars ? base : Math.max(70, Math.round(base * (maxChars / n)));
}

// A record card's title is a real headline (a full sentence, not a one-word
// gerund), so it wraps across lines. Shrink the size until it fits within
// `maxLines`, then hard-truncate with an ellipsis if it still overflows.
function fitHeadline(text, maxWidth, maxLines, base = 58, min = 40) {
  let size = base;
  let lines = wrapText(text, size, maxWidth);
  while (lines.length > maxLines && size > min) {
    size -= 2;
    lines = wrapText(text, size, maxWidth);
  }
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    const last = lines[maxLines - 1].replace(/\s+\S*$/, '');
    lines[maxLines - 1] = `${last}…`;
  }
  return { size, lines };
}

function shell(t, children, opts) {
  return h('div', { style: { position: 'relative', display: 'flex', width: W, height: H, background: t.page, fontFamily: 'Crimson Pro' } },
    gridLayer(t, opts), ...children.flat().filter(Boolean));
}

// ── SUB-PAGE: S0 (clean) ────────────────────────────────────────────────────
function subCardS0(t, { segs, label, subtitle, nsid, avatarUri, folio }) {
  const bcBy = P - LE;
  const size = titleSize(label, 116, 11);
  const descLines = wrapText(subtitle, 26, 620).slice(0, 4);
  const bandTo = 5 * P + descLines.length * HP;
  return shell(t, [
    avatarMark(t, avatarUri, { textBaseline: bcBy, left: PAD }),
    rowAt(breadcrumbParts(t, segs), { size: 28, by: bcBy, left: avatarUri ? PAD + 46 + 18 : PAD }),
    at(label, { size, by: 4 * P - 10, italic: true, color: t.accent }),
    ...descLines.map((l, i) => at(l, { size: 26, by: 5 * P + i * HP - 8, color: t.inkSoft, weight: 400 })),
    at(folio, { size: 22, by: 8 * P - LE, left: PAD, color: t.inkFaint, ls: '0.04em' }),
    at(nsid, { size: 22, by: 8 * P - LE, right: PAD, color: t.inkMuted }),
  ], { halfBands: [{ from: 4 * P + HP, to: bandTo }] });
}

// ── SUB-PAGE: S4 (day-of-life gutter, content flush to a divider) ───────────
function subCardS4(t, { segs, label, subtitle, nsid, avatarUri, folio }) {
  const DIV = 320, CX = DIV, bcBy = P - LE;
  const size = titleSize(label, 106, 11);
  const descLines = wrapText(subtitle, 25, 560).slice(0, 4);
  const bandTo = 5 * P + descLines.length * HP;
  return shell(t, [
    at('day', { size: 23, by: 3 * P - LE, left: PAD, color: t.inkFaint, ls: '0.12em' }),
    at(folio, { size: 44, by: 4 * P - 10, left: PAD, color: t.inkSoft }),
    avatarMark(t, avatarUri, { textBaseline: bcBy, left: CX }),
    rowAt(breadcrumbParts(t, segs), { size: 28, by: bcBy, left: avatarUri ? CX + 46 + 18 : CX }),
    at(label, { size, by: 4 * P - 10, left: CX, italic: true, color: t.accent }),
    ...descLines.map((l, i) => at(l, { size: 25, by: 5 * P + i * HP - 8, left: CX, color: t.inkSoft, weight: 400 })),
    at(nsid, { size: 22, by: 8 * P - LE, left: CX, color: t.inkMuted }),
  ], { verticals: [PAD, { x: DIV, strong: true }, W - PAD], halfBands: [{ from: 4 * P + HP, to: bandTo }] });
}

// ── RECORD: a single blog post / creative work / channel ────────────────────
// Same gutter+divider frame as S4, but the big accent gerund is replaced by
// the record's own title as a wrapped serif headline (mirroring the site's
// .page-title: serif 600, roman ink, with only the section term accent-italic
// in the breadcrumb — the .gerund treatment). The description sits below on the
// half-pitch rules, exactly like a section card.
function recordCard(t, { segs, title, subtitle, nsid, avatarUri, folio, body }) {
  const DIV = 320, CX = DIV, bcBy = P - LE;
  const colW = W - PAD - CX; // content column width
  // Breadcrumb "dame.is / {section}" with the section term echoing .gerund.
  const section = segs[segs.length - 1] || '';
  const crumb = [
    h('div', { style: { color: t.inkFaint } }, 'dame.is'),
    h('div', { style: { color: t.inkFaint } }, '/'),
    h('div', { style: { color: t.accent, fontStyle: 'italic', fontWeight: 600 } }, section),
  ];

  let content;
  let bandTo;
  if (body) {
    // A post / status: no title of its own, so `title` IS the text. Render it
    // as wrapped body copy — more lines, smaller, all on the fine rules, like
    // writing on ruled paper — rather than a giant headline.
    const size = 30;
    const all = wrapText(title || '', size, colW);
    const lines = all.slice(0, 7);
    if (all.length > lines.length && lines.length) {
      const last = lines[lines.length - 1].replace(/\s+\S*$/, '');
      lines[lines.length - 1] = `${last}…`;
    }
    const top = 3 * P - 8;
    bandTo = top + lines.length * HP;
    content = lines.map((l, i) => at(l, { size, by: top + i * HP, left: CX, weight: 400, color: t.ink }));
  } else {
    // A titled record: big serif headline (rows 3+, coarse pitch), then a short
    // description a coarse row below, on the half-pitch rules.
    const { size, lines } = fitHeadline(title || '', colW, 3);
    const descAll = wrapText(subtitle || '', 24, colW);
    const descLines = descAll.slice(0, 3);
    if (descAll.length > descLines.length && descLines.length) {
      const last = descLines[descLines.length - 1].replace(/\s+\S*$/, '');
      descLines[descLines.length - 1] = `${last}…`;
    }
    const headBase = 3 * P - 8;
    const descBase = (3 + lines.length) * P - 8;
    bandTo = descBase + descLines.length * HP;
    content = [
      ...lines.map((l, i) => at(l, { size, by: headBase + i * P, left: CX, weight: 600, color: t.ink, ls: '-0.01em' })),
      ...descLines.map((l, i) => at(l, { size: 24, by: descBase + i * HP, left: CX, color: t.inkSoft, weight: 400 })),
    ];
  }

  return shell(t, [
    at('day', { size: 23, by: 3 * P - LE, left: PAD, color: t.inkFaint, ls: '0.12em' }),
    at(folio, { size: 44, by: 4 * P - 10, left: PAD, color: t.inkSoft }),
    avatarMark(t, avatarUri, { textBaseline: bcBy, left: CX }),
    rowAt(crumb, { size: 28, by: bcBy, left: avatarUri ? CX + 46 + 18 : CX }),
    ...content,
    at(nsid, { size: 22, by: 8 * P - LE, left: CX, color: t.inkMuted }),
  ], { verticals: [PAD, { x: DIV, strong: true }, W - PAD], halfBands: [{ from: 3 * P + HP, to: bandTo }] });
}

// ── RECORD: one Ratioed piece ───────────────────────────────────────────────
// A piece has a shape, and a title-plus-blurb card throws it away. What it is,
// is a line with a cut in it: the seconds a post stood, every record that
// landed on it while it did, and the threadgate that ended it.
//
// So the card draws the line, and draws it ON the notebook rule the rest of the
// layout is ruled by, rather than floating a chart above the paper. Left of the
// cut is linear time, at the scale the piece actually ran at. Right of it is
// log-scaled, because the afterlife runs to years and pieces keep accruing it.
//
// The gutter carries "take 13" where every other card carries the day-of-life
// folio, which is the same joke: a notebook page number for a numbered work.

/** Where a post-seal second sits in the log-scaled tail, as a 0–1 fraction. */
const tailPos = (sec, maxSec) =>
  Math.log10(Math.max(sec, 1) + 1) / Math.log10(Math.max(maxSec, 1) + 1);

/**
 * Every record pointing at a piece, placed on the card's 0–2 track: the first
 * unit is the piece's life, the second its afterlife.
 *
 * Two event shapes, because a piece carries its log two ways. A record measured
 * by the admin panel has its own `events`, in milliseconds. The first eleven
 * predate that field and are drawn from the bundled harvest, which stores
 * seconds. The artist's own records are dropped, as they are in every count.
 */
export function pieceMarks(value, bundled) {
  const life = Math.max((value?.lifespanMs || 0) / 1000, 0.001);
  const raw = value?.events?.length ? value.events : bundled || [];
  const events = raw
    .filter((e) => e && !e.self)
    .map((e) => ({ k: e.k, pre: Boolean(e.pre), sec: typeof e.offMs === 'number' ? e.offMs / 1000 : e.off }))
    .filter((e) => typeof e.sec === 'number');
  if (!events.length) return [];
  let maxTail = 1;
  for (const e of events) if (!e.pre) maxTail = Math.max(maxTail, e.sec - life);
  return events.map((e) => ({
    k: e.k,
    at: e.pre ? Math.min(1, Math.max(0, e.sec / life)) : 1 + tailPos(e.sec - life, maxTail),
  }));
}

/** `48832` → `49s`; `1763900` → `29m24s`. Sized for the gutter figure. */
function shortDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/**
 * `2026-08-13T18:21:16Z` → `August 13, 2026`, in the artist's own clock.
 *
 * Eastern rather than UTC for the reason the week grid is: the pieces were made
 * at a particular time of day in a particular place, and four of them cross a
 * date boundary when read in UTC.
 */
function longDate(iso) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    }).format(d);
  } catch {
    return String(iso).slice(0, 10);
  }
}


// The block under the line: label over figure, the same marginalia pattern the
// gutter uses, rather than a sentence. Four facts, and none of them a repeat of
// what the marks already say.
//
// `ratio` is the project's own figure and its own name — non-like engagement
// against likes — set the way the essay's summary sets it: the count big, the
// `:likes` small beside it. It reads `56 :0` for a piece whose breaking like
// was deleted, which is not a division error but the finding.
function factBlock(t, { b, measured, piece, CX }) {
  const who = `@${b.currentHandle || b.handle}`;
  const pre = piece.preSeal || {};
  const nonLike = (pre.threadPosts || 0) + (pre.reposts || 0) + (pre.quotes || 0);
  // Columns are unequal because a handle is not a number: dame has recorded
  // breakers as long as @bolsonarosex.myatproto.social.
  const X = [CX, CX + 330, CX + 500, CX + 660];
  const label = (text, i) =>
    at(text, { size: 19, by: 6 * P + HP - 8, left: X[i], color: t.inkFaint, weight: 400, ls: '0.1em' });
  const value = (text, i, size = 30) =>
    at(text, { size, by: 7 * P - 8, left: X[i], color: t.ink, weight: 600 });

  return [
    label('ended by', 0),
    // Shrink rather than truncate: the name is the one thing on this card that
    // belongs to somebody else.
    value(who, 0, Math.max(19, Math.min(30, Math.floor(310 / (who.length * 0.49))))),
    label('reaction', 1),
    value(measured ? `${(b.reactionMs / 1000).toFixed(1)}s` : 'deleted', 1),
    label('ratio', 2),
    value(String(nonLike), 2),
    at(`:${pre.likes || 0}`, {
      size: 20,
      by: 7 * P - 8,
      left: X[2] + String(nonLike).length * 17 + 6,
      color: t.inkMuted,
      weight: 400,
    }),
    label('people', 3),
    value(String(pre.participants || 0), 3),
  ];
}

function ratioedCard(t, { piece, marks, scale, avatarUri }) {
  const CX = 320, bcBy = P - LE;
  const trackL = CX;
  const trackR = W - PAD;
  const trackW = trackR - trackL;
  // The alive window gets the larger share: it's the part with a story in it.
  const aliveW = Math.round(trackW * 0.6);
  const gap = 10; // clearance either side of the seal rule
  const afterL = trackL + aliveW + gap;
  const afterW = trackR - afterL;
  const y = 5 * P; // the coarse rule the line is drawn on

  const b = piece.breaker || {};
  const measured = typeof b.reactionMs === 'number';

  const dot = (m) => {
    const alive = m.at <= 1;
    const size = 13;
    const x = alive ? trackL + m.at * aliveW : afterL + (m.at - 1) * afterW;
    return h('div', {
      style: {
        position: 'absolute',
        left: Math.round(x - size / 2),
        top: y - Math.round(size / 2),
        width: size,
        height: size,
        // The like keeps the square the charts give it: it's the one mark that
        // ends something.
        borderRadius: m.k === 'like' ? 0 : size / 2,
        background: scale[m.k] || t.inkMuted,
        opacity: alive ? 1 : 0.5,
      },
    });
  };

  return shell(
    t,
    [
      // The gutter carries how long it stood, where every other card carries
      // the day-of-life folio. It's the piece's one number.
      at('alive', { size: 23, by: 3 * P - LE, left: PAD, color: t.inkFaint, ls: '0.12em' }),
      at(shortDuration(piece.lifespanMs), { size: 44, by: 4 * P - 10, left: PAD, color: t.inkSoft }),
      avatarMark(t, avatarUri, { textBaseline: bcBy, left: CX }),
      // The real path, since a piece genuinely sits two levels down.
      rowAt(breadcrumbParts(t, ['creating', 'ratioed']), {
        size: 28,
        by: bcBy,
        left: avatarUri ? CX + 46 + 18 : CX,
      }),

      // The project's name at the size every other card gives its section. A
      // card that only named it in the breadcrumb made the work anonymous at a
      // glance, which is the one thing a share card cannot be. Roman rather
      // than the gerund's italic: this is a title, not a verb.
      at('Ratioed', { size: 104, by: 3 * P - 10, left: CX, color: t.accent }),

      // Which one of them, under the name.
      at(`take ${String(piece.take).padStart(2, '0')}`, {
        size: 46,
        by: 4 * P - 8,
        left: CX,
        weight: 600,
        color: t.ink,
        ls: '-0.01em',
      }),

      // The line itself, laid over the rule.
      h('div', { style: { position: 'absolute', left: trackL, top: y - 1, width: aliveW, height: 3, background: t.inkSoft } }),
      // Mixed toward the page rather than taken from t.rule, which at some
      // hours of the sky palette is close enough to the paper to vanish.
      h('div', { style: { position: 'absolute', left: afterL, top: y, width: afterW, height: 2, background: mix(t.inkSoft, t.page, 0.62) } }),
      // The threadgate. The heaviest mark on the card, as it is on the page.
      h('div', { style: { position: 'absolute', left: trackL + aliveW + gap / 2 - 1, top: y - 17, width: 3, height: 34, background: scale.like } }),
      ...marks.map(dot),

      // Not "alive" — the gutter says that. What this end of the line is, is
      // the moment the post went up.
      at('posted', { size: 21, by: 5 * P + HP - 6, left: CX, color: t.inkMuted, weight: 400 }),
      at('after the seal', { size: 21, by: 5 * P + HP - 6, right: PAD, color: t.inkFaint, weight: 400 }),

      ...factBlock(t, { b, measured, piece, CX }),

      // Where the other cards put their NSID. The lexicon name is on the page
      // itself and in the head; what a card wants at the bottom of a work that
      // ran across more than a year is when it happened.
      at(longDate(piece.postedAt), { size: 22, by: 8 * P - LE, left: CX, color: t.inkMuted }),
    ],
    { verticals: [PAD, { x: 320, strong: true }, W - PAD], halfBands: [{ from: 6 * P, to: 7 * P }] },
  );
}

// ── RECORD: one mothing night ───────────────────────────────────────────────
// A night at the light is a set of photographs, so the card is the
// photographs: the first few of them ruled into the page as a strip — top and
// bottom edges landing on coarse rules, so they sit ON the paper rather than
// floating over it — with what was caught named underneath.
//
// The gutter carries the session's number where every other card carries the
// day-of-life folio. Same joke the piece card makes: a notebook page number,
// for a numbered night.
function nightCard(t, { night, avatarUri, nsid }) {
  const CX = 320, bcBy = P - LE;
  const colW = W - PAD - CX; // content column
  const BOX = 2 * P; // a square exactly two coarse rules tall
  const SLOTS = 5; // five of them span the column with even gaps
  const GAP = (colW - SLOTS * BOX) / (SLOTS - 1);
  const photos = (night.photos || []).slice(0, SLOTS);
  const stripTop = 5 * P;

  // One line, always: the date is short and the card has one thing to say.
  const { size, lines } = fitHeadline(night.title || '', colW, 1, 72, 44);

  // The three facts the page's own session header carries, set as marginalia
  // columns rather than a sentence. Columns are unequal because a clock span
  // is much wider than a count.
  const FX = [CX, CX + 180, CX + 340];
  const facts = [
    ['moths', night.moths == null ? '' : String(night.moths)],
    ['species', night.species ? String(night.species) : ''],
    ['at the light', night.span || ''],
  ];

  // What is actually pictured, in the strip's own order — a card that only
  // counted them would say nothing about what came to the light.
  const nameLine = joinToWidth(photos.map((p) => p.name).filter(Boolean), 21, colW);

  return shell(t, [
    at('night', { size: 23, by: 3 * P - LE, left: PAD, color: t.inkFaint, ls: '0.12em' }),
    at(`#${night.number}`, { size: 44, by: 4 * P - 10, left: PAD, color: t.inkSoft }),
    avatarMark(t, avatarUri, { textBaseline: bcBy, left: CX }),
    rowAt(
      [
        h('div', { style: { color: t.inkFaint } }, 'dame.is'),
        h('div', { style: { color: t.inkFaint } }, '/'),
        h('div', { style: { color: t.accent, fontStyle: 'italic', fontWeight: 600 } }, 'mothing'),
      ],
      { size: 28, by: bcBy, left: avatarUri ? CX + 46 + 18 : CX },
    ),
    at(lines[0] || '', { size, by: 3 * P - 8, left: CX, weight: 600, color: t.ink, ls: '-0.01em' }),

    ...facts.flatMap(([label, value], i) =>
      value
        ? [
            at(label, { size: 19, by: 4 * P - 8, left: FX[i], color: t.inkFaint, weight: 400, ls: '0.1em' }),
            at(value, { size: 30, by: 4 * P + HP - 8, left: FX[i], color: t.ink, weight: 600 }),
          ]
        : [],
    ),

    ...photos.map((p, i) =>
      h(
        'div',
        {
          style: {
            position: 'absolute',
            left: CX + i * (BOX + GAP),
            top: stripTop,
            width: BOX,
            height: BOX,
            overflow: 'hidden',
            border: `1px solid ${t.rule}`,
          },
        },
        h('img', { src: p.src, width: BOX, height: BOX, style: { objectFit: 'cover' } }),
      ),
    ),

    nameLine && at(nameLine, { size: 21, by: 7 * P + HP - 8, left: CX, color: t.inkMuted, weight: 400 }),
    at(nsid, { size: 22, by: 8 * P - LE, left: CX, color: t.inkMuted }),
  ], {
    verticals: [PAD, { x: CX, strong: true }, W - PAD],
    halfBands: [{ from: 4 * P, to: 4 * P + HP }, { from: 7 * P, to: 7 * P + HP }],
  });
}

// ── HOME: H4 (index of surfaces, cascade-fade, tighter half-pitch rows) ─────
function homeCardH4(t, { avatarUri, folio, homeIndex, nsid }) {
  const bcBy = P - LE, top0 = 2 * P + HP, sz = 32;
  const rows = homeIndex && homeIndex.length ? homeIndex : [];
  const items = [];
  rows.forEach((r, i) => {
    const by = top0 + i * HP - 8;
    const tt = rows.length > 1 ? 0.08 + (i / (rows.length - 1)) * 0.72 : 0.08;
    items.push(h('div', { style: { position: 'absolute', left: PAD, top: by - R * sz, height: sz, display: 'flex', alignItems: 'baseline', gap: 11, fontSize: sz, lineHeight: 1 } },
      h('div', { style: { color: mix(t.tan, t.page, tt), fontWeight: 600 } }, 'dame.is'),
      h('div', { style: { color: mix(t.ink, t.page, tt), fontStyle: 'italic', fontWeight: 600 } }, r.label),
    ));
    items.push(at(r.nsid, { size: 20, by, right: PAD, color: mix(t.inkMuted, t.page, tt) }));
  });
  return shell(t, [
    avatarMark(t, avatarUri, { textBaseline: bcBy, left: PAD }),
    rowAt([h('div', { style: { color: t.inkFaint } }, 'dame.is')], { size: 28, by: bcBy, left: avatarUri ? PAD + 46 + 18 : PAD }),
    ...items,
    at(`day ${folio}`, { size: 21, by: 8 * P - LE, left: PAD, color: t.inkFaint }),
    at(nsid, { size: 21, by: 8 * P - LE, right: PAD, color: t.inkMuted }),
  ], { halfBands: [{ from: 2 * P, to: top0 + rows.length * HP }] });
}

// ── HOME: H1 (the live three-tone hero sentence, on the grid) ───────────────
function homeCardH1(t, { avatarUri, folio, nsid, hero }) {
  const bcBy = P - LE;
  const lines = hero && hero.length ? hero : [
    { text: 'dame.is', color: t.inkFaint },
    { text: 'a design engineer', color: t.ink },
    { text: 'who makes social software', color: t.accent },
    { text: 'with open protocols', color: t.accent },
  ];
  return shell(t, [
    avatarMark(t, avatarUri, { textBaseline: bcBy, left: PAD }),
    ...lines.map((l, i) => at(l.text, { size: 76, by: (3 + i) * P - 18, color: l.color, weight: 600, ls: '-0.015em' })),
    at(folio, { size: 22, by: 8 * P - LE, left: PAD, color: t.inkFaint, ls: '0.04em' }),
    at(nsid, { size: 22, by: 8 * P - LE, right: PAD, color: t.inkMuted }),
  ]);
}

/**
 * Build the OG card element.
 * @param {object} o
 * @param {string}  o.pathname   request path ('/blogging', '/'); drives home vs sub + breadcrumb
 * @param {string}  o.label      gerund shown big (''=home)
 * @param {string}  o.subtitle   one-line description
 * @param {string}  o.nsid       AT-Protocol lexicon for the margin
 * @param {string[]} [o.segs]    breadcrumb segments (derived from pathname if omitted)
 * @param {string|null} [o.avatarUri] data: URI for the current sky-avatar tile
 * @param {string}  o.folio      day-of-life string ('12,115')
 * @param {'light'|'dark'|object} [o.theme] palette key, or a resolved token map (e.g. themeFromSky)
 * @param {boolean} [o.record]   render the per-record card (title = o.label as a wrapped headline)
 * @param {object}  [o.night]    render the mothing-night card
 *                               ({number,title,moths,species,span,photos:[{src,name}]})
 * @param {Array}   [o.homeIndex] [{label,nsid}] for the home index card
 * @param {Array}   [o.hero]      [{text,color}] for the home hero card
 */
export function ogElement(o = {}) {
  const t = (o.theme && typeof o.theme === 'object') ? o.theme : (THEMES[o.theme] || THEMES.light);
  const pathname = (o.pathname || '/').replace(/\/+$/, '') || '/';
  const segs = o.segs || pathname.split('/').filter(Boolean);
  const avatarUri = SHOW_AVATAR ? (o.avatarUri || null) : null;
  const folio = o.folio || '';
  // A piece card carries no label of its own — its headline is a duration —
  // so it has to be picked before the "no label means home" fallback.
  if (o.piece) {
    return ratioedCard(t, { piece: o.piece, marks: o.marks || [], scale: o.scale || {}, avatarUri });
  }
  // A night's headline is a date and its gutter is a session number, so it
  // carries no label either — same reason it is picked before the fallback.
  if (o.night) {
    return nightCard(t, { night: o.night, avatarUri, nsid: o.nsid || '' });
  }

  const isHome = pathname === '/' || !o.label;

  if (isHome) {
    if (HOME_LAYOUT === 'h1') return homeCardH1(t, { avatarUri, folio, nsid: o.nsid || 'is.dame.page', hero: o.hero });
    return homeCardH4(t, { avatarUri, folio, nsid: o.nsid || 'is.dame.page', homeIndex: o.homeIndex || [] });
  }
  if (o.record) {
    return recordCard(t, { segs, title: o.label, subtitle: o.subtitle || '', nsid: o.nsid || '', avatarUri, folio, body: o.body });
  }
  const args = { segs, label: o.label, subtitle: o.subtitle || '', nsid: o.nsid || '', avatarUri, folio };
  return SUBPAGE_LAYOUT === 's0' ? subCardS0(t, args) : subCardS4(t, args);
}
