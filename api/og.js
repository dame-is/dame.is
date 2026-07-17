// Vercel serverless function: dynamic Open Graph card generator, powered by
// @vercel/og (satori + resvg). Renders the 1200×630 "notebook / design-layout"
// card defined in og/design.js, with the current Eastern-hour sky-avatar baked
// in beside the breadcrumb so cards drift through the day like the favicon and
// the live avatar.
//
// Usage (from the per-page meta injected by middleware.js):
//   /api/og?page=/blogging          → looks up copy + NSID from og/pages.js
//   /api/og?title=Foo&subtitle=Bar  → ad-hoc copy
//   /api/og?theme=dark              → dark (green-black) variant
//   /api/og                         → the home "index" card
//
// Node runtime (matches the rest of /api). @vercel/og runs fine here; we pull
// the PNG bytes off the ImageResponse and stream them through `res`.

import { ImageResponse } from '@vercel/og';
import { FONTS } from '../og/assets/fonts.js';
import { ICONS } from '../og/assets/icons.js';
import { easternHour, avatarKeys, secondsUntilNextHour, folio } from '../og/time.js';
import { ogElement, themeFromSky } from '../og/design.js';
import { paletteForHour } from '../src/lib/skyTheme.js';
import { pageMeta, segsFor, cleanPath, HOME_INDEX, DEFAULT } from '../og/pages.js';

// One family throughout: Crimson Pro (serif) — breadcrumb, title, description,
// and the folio + NSID marginalia (which used to be IBM Plex Mono).
const crimson = (id, weight, style = 'normal') => ({ name: 'Crimson Pro', data: Buffer.from(FONTS[id], 'base64'), weight, style });

const FONT_SET = [
  crimson('300', 300),
  crimson('400', 400),
  crimson('600', 600),
  crimson('700', 700),
  crimson('400i', 400, 'italic'),
  crimson('600i', 600, 'italic'),
];

// Attacker-controlled free-text query params are rendered into the card, so
// clamp their length before they reach Satori — an unbounded `?title=…` is a
// denial-of-wallet / layout-abuse vector. 200 chars is well past any real
// title/subtitle/label the site emits.
const MAX_TEXT = 200;
const clampText = (v) => String(v ?? '').slice(0, MAX_TEXT);

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const now = new Date();

    // Which hour drives the card. Normally the current Eastern hour (in
    // lockstep with the live avatar + favicon); an explicit `hour=0..23`
    // param lets us preview any point in the day (used by the sample renderer).
    const hourParam = q.hour != null && q.hour !== '' ? Number(q.hour) : NaN;
    const hour = Number.isFinite(hourParam) ? ((hourParam % 24) + 24) % 24 : easternHour(now);

    // The day-of-life "folio" is normally today's, but a record card stamps the
    // record's OWN day (its `date`), so a blog post shows the day it was made
    // rather than the day the card was rendered. The avatar + palette still
    // track the current hour — only the day number is pinned to the record.
    let folioAt = now;
    if (q.date) {
      const d = new Date(String(q.date));
      if (!Number.isNaN(d.getTime())) folioAt = d;
    }

    // Palette: the dynamic SKY theme for this hour by default, so cards match
    // the site's own hour-tracking palette. `theme=light|dark` forces the
    // fixed warm-paper fallbacks (handled inside ogElement).
    const theme = q.theme === 'light' || q.theme === 'dark'
      ? q.theme
      : themeFromSky(paletteForHour(hour));

    // Copy + routing: an explicit `page` wins (canonical per-page card), then a
    // `section`+`label` record card, then ad-hoc title/subtitle, else the home
    // index card.
    let pathname = '/';
    let label = '';
    let subtitle = '';
    let nsid = DEFAULT.nsid;
    let record = false;
    let body = false;
    if (q.page) {
      pathname = cleanPath(clampText(q.page));
      const meta = pageMeta(pathname);
      label = meta.label;
      // Middleware injects a `subtitle` resolved from the live / snapshotted
      // is.dame.page record; a direct hit with no subtitle uses the static copy.
      const passed = q.subtitle != null ? clampText(q.subtitle).trim() : '';
      subtitle = passed || meta.desc;
      nsid = meta.nsid;
    } else if (q.section) {
      // Per-record card: breadcrumb = /{section}, headline = the record title.
      const sectionSeg = clampText(q.section).replace(/^\/+|\/+$/g, '');
      pathname = `/${sectionSeg}`;
      label = clampText(q.label);
      subtitle = clampText(q.subtitle);
      nsid = clampText(q.nsid || DEFAULT.nsid);
      record = true;
      // `body=1` renders the label as wrapped body copy (a post/status quote)
      // instead of a big headline.
      body = q.body === '1' || q.body === 'true';
    } else if (q.title || q.subtitle) {
      label = clampText(q.title);
      subtitle = clampText(q.subtitle);
      pathname = label ? `/${label.toLowerCase().replace(/\s+/g, '-')}` : '/';
    }

    const key = avatarKeys()[hour];
    const avatarUri = ICONS[key] ? `data:image/png;base64,${ICONS[key]}` : null;

    const element = ogElement({
      pathname,
      label,
      subtitle,
      nsid,
      record,
      body,
      segs: segsFor(pathname),
      avatarUri,
      folio: folio(folioAt),
      theme,
      homeIndex: HOME_INDEX,
    });

    const image = new ImageResponse(element, {
      width: 1200,
      height: 630,
      fonts: FONT_SET,
    });
    const png = Buffer.from(await image.arrayBuffer());

    const maxAge = secondsUntilNextHour();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`);
    res.setHeader('Content-Length', String(png.length));
    return res.status(200).end(png);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'og render failed' });
  }
}
