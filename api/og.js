// Vercel serverless function: dynamic Open Graph card generator, powered by
// @vercel/og (satori + resvg). Renders the 1200×630 "notebook / design-layout"
// card defined in og/design.js, with the current Eastern-hour sky-avatar baked
// in beside the breadcrumb so cards drift through the day like the favicon and
// the live avatar.
//
// Usage (from the per-page meta injected by middleware.js):
//   /api/og?page=/blogging          → looks up copy + NSID from og/pages.js
//   /api/og?night=2026-08-18        → one mothing night, with its own moths on it
//   /api/og?title=Foo&subtitle=Bar  → ad-hoc copy
//   /api/og?theme=dark              → dark (green-black) variant
//   /api/og                         → the home "index" card
//
// Node runtime (matches the rest of /api). @vercel/og runs fine here; we pull
// the PNG bytes off the ImageResponse and stream them through `res`.

import { ImageResponse } from '@vercel/og';
import { FONTS } from '../og/assets/fonts.js';
import { ICONS } from '../og/assets/icons.js';
import { easternHour, easternDate, avatarKeys, secondsUntilNextHour, folio } from '../og/time.js';
import { ogElement, themeFromSky, pieceMarks } from '../og/design.js';
import { paletteForHour } from '../src/lib/skyTheme.js';
import { ratioedScale } from '../src/lib/ratioedPalette.js';
import { resolveSkyTuning } from '../og/skyTuning.js';
import { pageMeta, segsFor, cleanPath, HOME_INDEX, DEFAULT } from '../og/pages.js';
import { pieceRecord, nightSession } from '../og/records.js';
import { photoUrl } from '../src/lib/inaturalist.js';
import { formatNightDate, nightSpan, photographed, mothName } from '../src/lib/mothing.js';
import { MOTHING_OBSERVATION_NSID } from '../src/config.js';
import { createRequire } from 'node:module';

// The first eleven pieces were measured before records carried their own event
// log and are drawn from this harvest — 27kB, and the only way those cards get
// their marks at all. Required rather than imported so the file traces into the
// serverless bundle without an import attribute; if it doesn't make it, those
// cards lose their marks and keep everything else.
let RATIOED_EVENTS = {};
try {
  RATIOED_EVENTS = createRequire(import.meta.url)('../src/data/ratioedEvents.json');
} catch {
  /* the eleven bundled logs are unavailable; newer pieces carry their own */
}

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

// How many of a night's moths reach its card, and how long any one photo gets
// to answer before the card goes without it.
const NIGHT_PHOTOS = 5;
const PHOTO_TIMEOUT_MS = 4000;

/**
 * One iNaturalist photo as a data: URI, or null.
 *
 * Satori will happily fetch a remote <img> itself, but then a single dead
 * photo throws and takes the whole card down with it, and nothing bounds how
 * long it waits. Pulling the bytes here means a photo that 404s or hangs is
 * simply dropped and the card draws the ones that answered. `small` is a
 * ~240px variant — a comfortable 2× for the 140px squares the card sets them
 * in, and a fraction of the bytes of the full-size file.
 */
async function inlinePhoto(url) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!/^image\//.test(type)) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return `data:${type};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Everything the night card draws, read back off the session itself so no
 * free text ever reaches the renderer — the URL only ever carries a date.
 * Each photo keeps the name of the moth in it, so the caption line under the
 * strip can't drift out of step with the pictures when one fails to load.
 */
async function nightCardData(session) {
  const shown = photographed(session).slice(0, NIGHT_PHOTOS);
  const photos = await Promise.all(
    shown.map(async (o) => {
      const src = await inlinePhoto(photoUrl(o.photos[0], 'small'));
      return src ? { src, name: mothName(o) } : null;
    }),
  );
  return {
    // Not drawn — the card's headline is the formatted date. This is the raw
    // one, so the handler can tell a night still in progress from a finished
    // one when it sets the cache headers.
    date: session.date,
    number: session.number,
    title: `Night of ${formatNightDate(session.date)}`,
    moths: session.observationCount,
    species: session.speciesCount,
    span: nightSpan(session),
    photos: photos.filter(Boolean),
  };
}

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
    // the site's own hour-tracking palette — INCLUDING any per-hour tuning saved
    // from the admin "Sky theme studio" (is.dame.sky/self). That override is
    // only installed client-side (useTheme.jsx), so resolve it here from the
    // same snapshot + live PDS the SPA reads and pass it to paletteForHour;
    // otherwise cards render the untuned palette and drift from the live site —
    // most visibly at dawn/dusk, whose raw page derivation is a muddy warm color
    // that reads as an accent wash rather than the tuned background.
    // `theme=light|dark` forces the fixed warm-paper fallbacks (in ogElement).
    const fixed = q.theme === 'light' || q.theme === 'dark';
    const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'dame.is'}`;
    const tuning = fixed ? null : await resolveSkyTuning(origin);
    const theme = fixed ? q.theme : themeFromSky(paletteForHour(hour, tuning));

    // Copy + routing: an explicit `page` wins (canonical per-page card), then a
    // `section`+`label` record card, then ad-hoc title/subtitle, else the home
    // index card.
    let pathname = '/';
    let label = '';
    let subtitle = '';
    let nsid = DEFAULT.nsid;
    let record = false;
    let body = false;
    // A Ratioed piece gets its own card. Only the take (or record key) comes in
    // on the query — everything drawn is read from the record itself, so no
    // free text reaches the renderer and the URL stays short.
    let piece = null;
    let marks = [];
    if (q.piece) {
      const found = await pieceRecord(clampText(q.piece), origin);
      if (found?.value?.take) {
        piece = found.value;
        const rkey = String(found.uri || '').split('/').pop();
        marks = pieceMarks(piece, RATIOED_EVENTS[rkey]);
      }
    }
    // A mothing night gets its own card too — the moths that came to the
    // light, which a title and a blurb can't carry either.
    let night = null;
    if (!piece && q.night) {
      const found = await nightSession(clampText(q.night), origin);
      if (found?.session) night = await nightCardData(found.session);
    }
    if (piece) {
      // Fall through to the render with `piece` set; nothing else applies.
    } else if (night) {
      // Same: the night card reads everything off the session.
      pathname = '/mothing';
      nsid = MOTHING_OBSERVATION_NSID;
    } else if (q.page) {
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
      piece,
      night,
      marks,
      // The same categorical scale the charts derive for this hour, so a card
      // and the page it links to agree about which colour a like is.
      scale: piece ? ratioedScale(hour) : null,
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

    // Cards are drawn in the hour's own palette, so they are good until the sky
    // changes. A card for a piece that is STILL RUNNING is good for about as
    // long as the piece is: it draws a clock, a lifeline and a breaker, all of
    // which are wrong the moment somebody likes it. The URL carries a version
    // stamp now (see records.js: cardVersion) so the sealed card is a separate
    // resource anyway — this is the belt to that braces, for every crawler that
    // fetched the live URL before there was anything else to fetch.
    // A night still at the light can gain moths, exactly as a running piece can
    // gain likes, so its card is only good briefly. Today's date OR yesterday's
    // counts as in progress: a session opens at 8pm and runs past midnight, so
    // for three hours of every night the live one is dated the day before.
    const liveNight = Boolean(night) && night.date >= easternDate(new Date(now.getTime() - 86_400_000));
    const live = (piece && !piece.sealedAt) || liveNight;
    const maxAge = live ? Math.min(60, secondsUntilNextHour()) : secondsUntilNextHour();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader(
      'Cache-Control',
      live
        ? `public, max-age=${maxAge}, s-maxage=${maxAge}`
        : `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`,
    );
    res.setHeader('Content-Length', String(png.length));
    return res.status(200).end(png);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'og render failed' });
  }
}
