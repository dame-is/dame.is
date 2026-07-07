// The dynamic Open Graph card design, shared by the /api/og serverless
// function and the local sample renderer. Framework-free: builds a satori
// element tree with a tiny hyperscript helper so it works the same in a plain
// Node script and inside @vercel/og.
//
// The look is a "notebook / design-layout" page drawn straight from the site's
// own system (src/styles/theme.css, the ruled home hero in src/styles/app.css):
//   • warm paper ground, Crimson Pro serif, moss accent, IBM Plex Mono meta
//   • a VISIBLE baseline grid — coarse rules for headings, half-pitch rules for
//     body copy — with every line locked so its baseline rests on a rule
//     (descenders dip below, like writing on ruled paper)
//   • "dame.is" leads a spaced breadcrumb; the big text is just the page's
//     gerund (accent italic). No repeated wordmarks.
//   • marginalia instead of a footer: the day-of-life "folio" (a notebook page
//     number) and the page's AT-Protocol NSID, both in mono
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
export const THEMES = {
  light: { page: '#f1ead4', ink: '#1d2419', inkSoft: '#364034', inkMuted: '#6f6e58', inkFaint: '#9d9784', rule: '#cabf9f', accent: '#5e7a47', tan: '#a88c5f', grid: 'rgba(29,36,25,0.14)', gridStrong: 'rgba(29,36,25,0.24)', gridFine: 'rgba(29,36,25,0.09)' },
  dark: { page: '#1d2419', ink: '#ece4cb', inkSoft: '#d2c9ac', inkMuted: '#9a9377', inkFaint: '#6a6450', rule: '#3a4232', accent: '#a3b486', tan: '#c9a87a', grid: 'rgba(236,228,203,0.12)', gridStrong: 'rgba(236,228,203,0.22)', gridFine: 'rgba(236,228,203,0.09)' },
};

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
function at(text, { size, by, left = PAD, right, weight = 600, italic = false, color, mono = false, ls }) {
  const style = { position: 'absolute', top: by - R * size, fontSize: size, lineHeight: 1, fontWeight: weight, fontStyle: italic ? 'italic' : 'normal', color, fontFamily: mono ? 'IBM Plex Mono' : 'Crimson Pro' };
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

// The big gerund shrinks for longer labels so it never runs past the column.
function titleSize(label, base, maxChars) {
  const n = (label || '').length;
  return n <= maxChars ? base : Math.max(70, Math.round(base * (maxChars / n)));
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
    at(folio, { size: 22, by: 8 * P - LE, left: PAD, mono: true, color: t.inkFaint, ls: '0.04em' }),
    at(nsid, { size: 22, by: 8 * P - LE, right: PAD, mono: true, color: t.inkMuted }),
  ], { halfBands: [{ from: 4 * P + HP, to: bandTo }] });
}

// ── SUB-PAGE: S4 (day-of-life gutter, content flush to a divider) ───────────
function subCardS4(t, { segs, label, subtitle, nsid, avatarUri, folio }) {
  const DIV = 320, CX = DIV, bcBy = P - LE;
  const size = titleSize(label, 106, 11);
  const descLines = wrapText(subtitle, 25, 560).slice(0, 4);
  const bandTo = 5 * P + descLines.length * HP;
  return shell(t, [
    at('day', { size: 23, by: 3 * P - LE, left: PAD, mono: true, color: t.inkFaint, ls: '0.12em' }),
    at(folio, { size: 44, by: 4 * P - 10, left: PAD, mono: true, color: t.inkSoft }),
    avatarMark(t, avatarUri, { textBaseline: bcBy, left: CX }),
    rowAt(breadcrumbParts(t, segs), { size: 28, by: bcBy, left: avatarUri ? CX + 46 + 18 : CX }),
    at(label, { size, by: 4 * P - 10, left: CX, italic: true, color: t.accent }),
    ...descLines.map((l, i) => at(l, { size: 25, by: 5 * P + i * HP - 8, left: CX, color: t.inkSoft, weight: 400 })),
    at(nsid, { size: 22, by: 8 * P - LE, left: CX, mono: true, color: t.inkMuted }),
  ], { verticals: [PAD, { x: DIV, strong: true }, W - PAD], halfBands: [{ from: 4 * P + HP, to: bandTo }] });
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
    items.push(at(r.nsid, { size: 20, by, right: PAD, mono: true, color: mix(t.inkMuted, t.page, tt) }));
  });
  return shell(t, [
    avatarMark(t, avatarUri, { textBaseline: bcBy, left: PAD }),
    rowAt([h('div', { style: { color: t.inkFaint } }, 'dame.is')], { size: 28, by: bcBy, left: avatarUri ? PAD + 46 + 18 : PAD }),
    ...items,
    at(`day ${folio}`, { size: 21, by: 8 * P - LE, left: PAD, mono: true, color: t.inkFaint }),
    at(nsid, { size: 21, by: 8 * P - LE, right: PAD, mono: true, color: t.inkMuted }),
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
    at(folio, { size: 22, by: 8 * P - LE, left: PAD, mono: true, color: t.inkFaint, ls: '0.04em' }),
    at(nsid, { size: 22, by: 8 * P - LE, right: PAD, mono: true, color: t.inkMuted }),
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
 * @param {'light'|'dark'} [o.theme]
 * @param {Array}   [o.homeIndex] [{label,nsid}] for the home index card
 * @param {Array}   [o.hero]      [{text,color}] for the home hero card
 */
export function ogElement(o = {}) {
  const t = THEMES[o.theme] || THEMES.light;
  const pathname = (o.pathname || '/').replace(/\/+$/, '') || '/';
  const segs = o.segs || pathname.split('/').filter(Boolean);
  const avatarUri = SHOW_AVATAR ? (o.avatarUri || null) : null;
  const folio = o.folio || '';
  const isHome = pathname === '/' || !o.label;

  if (isHome) {
    if (HOME_LAYOUT === 'h1') return homeCardH1(t, { avatarUri, folio, nsid: o.nsid || 'is.dame.page', hero: o.hero });
    return homeCardH4(t, { avatarUri, folio, nsid: o.nsid || 'is.dame.page', homeIndex: o.homeIndex || [] });
  }
  const args = { segs, label: o.label, subtitle: o.subtitle || '', nsid: o.nsid || '', avatarUri, folio };
  return SUBPAGE_LAYOUT === 's0' ? subCardS0(t, args) : subCardS4(t, args);
}
