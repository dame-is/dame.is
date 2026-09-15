// Vercel serverless function: dynamic Open Graph card generator, powered by
// @vercel/og (satori + resvg). Renders the 1200×630 "notebook / design-layout"
// card defined in og/design.js, with the current Eastern-hour sky-avatar baked
// in beside the breadcrumb so cards drift through the day like the favicon and
// the live avatar.
//
// Usage (from the per-page meta injected by middleware.js):
//   /api/og?page=/blogging          → looks up copy + NSID from og/pages.js
//   /api/og?night=2026-08-18        → one mothing night, with its own moths on it
//   /api/og?play=3msrio…            → one teal.fm play, with its album cover on it
//   /api/og?album=raven-by-kelela   → one album, likewise
//   /api/og?albums=1                → the albums index, as a shelf of covers
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
import {
  pieceRecord,
  nightSession,
  participantCard,
  participantsCard,
  playRecord,
  albumBySlug,
  albumsIndex,
} from '../og/records.js';
import { lookupArtwork } from './_lib/itunes.js';
import { photoUrl } from '../src/lib/inaturalist.js';
import { nightSpan, photographed } from '../src/lib/mothing.js';
import { formatListenTime, monthYear } from '../src/lib/albums.js';
import { artLookupFor, upscaleArtwork } from '../src/lib/musicIds.js';
import { playArtistLine, playTrackName, playedAtOf } from '../src/lib/teal.js';
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

// The dated follower table, for the same reason and by the same route. Without
// it a participant card loses its audience figure and keeps everything else —
// the breakers whose like was deleted are in no event log at all, so the table
// is the only place their audience is written down.
let RATIOED_AUDIENCE = null;
try {
  RATIOED_AUDIENCE = createRequire(import.meta.url)('../src/data/ratioedAudience.json');
} catch {
  /* the dated table is unavailable; recorded figures still come off the logs */
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

// How many of a night's moths reach its card, and how long any one image gets
// to answer before the card goes without it.
const NIGHT_PHOTOS = 5;
const PHOTO_TIMEOUT_MS = 4000;

// Album art, at the resolutions the cards actually set it in. The renderer
// rasterises at exactly 1200×630, so anything much past the drawn size is bytes
// nobody sees: a play/album card gives a cover 280px and the shelf gives each
// of five 140px. Apple serves whatever size the URL asks for.
const COVER_SIZE = 400;
const SHELF_COVER_SIZE = 200;
// How many covers reach the albums index card. Five spans the column; past that
// they stop being recognisable at the size a card gets looked at.
const SHELF_COVERS = 5;

/**
 * One remote image as a data: URI, or null.
 *
 * Satori will happily fetch a remote <img> itself, but then a single dead
 * image throws and takes the whole card down with it, and nothing bounds how
 * long it waits. Pulling the bytes here means one that 404s or hangs is simply
 * dropped and the card draws whatever answered.
 */
async function inlineImage(url) {
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
 * The cover for a play, inlined, or null.
 *
 * An album has no artwork of its own anywhere in the play record — the ladder
 * needs a recording (an ISRC, an Apple song id, or a track and an artist to
 * search on), which is why an album's cover is resolved from one of its plays.
 * Every step is allowed to come up empty: a card with no cover is a card, and a
 * card that failed to render is nothing.
 */
async function inlineCover(payload, size = COVER_SIZE) {
  const lookup = artLookupFor(payload);
  if (!Object.keys(lookup).length) return null;
  try {
    const hit = await lookupArtwork(lookup);
    return inlineImage(upscaleArtwork(hit?.artworkUrl100, size));
  } catch {
    return null;
  }
}

/**
 * Everything the night card draws, read back off the session itself so no
 * free text ever reaches the renderer — the URL only ever carries a date.
 */
async function nightCardData(session) {
  const shown = photographed(session).slice(0, NIGHT_PHOTOS);
  const photos = await Promise.all(
    shown.map(async (o) => {
      // `small` is a ~240px variant — a comfortable 2× for the 140px squares
      // the card sets them in, and a fraction of the full-size file's bytes.
      const src = await inlineImage(photoUrl(o.photos[0], 'small'));
      return src ? { src } : null;
    }),
  );
  return {
    // Not drawn. It's here so the handler can stamp the folio with the night's
    // own day, and tell a night still in progress from a finished one when it
    // sets the cache headers.
    date: session.date,
    // The work and which one of it, the way the piece card names a take. The
    // date is the <title>'s job (see og/records.js) and the folio's.
    title: `Mothing, session ${session.number}`,
    moths: session.observationCount,
    species: session.speciesCount,
    span: nightSpan(session),
    photos: photos.filter(Boolean),
  };
}

/**
 * Everything one play's card draws, read back off the record so no free text
 * ever reaches the renderer — the URL only ever carries a record key.
 */
async function playCardData(record) {
  const v = record?.value;
  if (!v) return null;
  const track = playTrackName(v);
  if (!track) return null;
  return {
    track,
    artist: playArtistLine(v),
    album: String(v.releaseName || '').trim(),
    cover: await inlineCover(v),
    // Neither of these is drawn by the card itself. `date` stamps the folio
    // with the day the song was played; `nsid` is the lexicon chip in the
    // margin, read off the record rather than assumed, so a play still held in
    // teal.fm's alpha namespace is labelled as one.
    date: playedAtOf(v) || v.createdAt || null,
    nsid: String(record.uri || '').match(/^at:\/\/[^/]+\/([^/]+)\//)?.[1] || null,
  };
}

/** Everything one album's card draws, off the album index. */
async function albumCardData(album) {
  if (!album?.title) return null;
  return {
    title: album.title,
    artist: album.artist || '',
    plays: album.plays || 0,
    tracks: album.tracks || 0,
    listened: formatListenTime(album.seconds),
    since: monthYear(album.firstPlayed),
    cover: await inlineCover(album.sample),
  };
}

/** Everything the albums index card draws: the totals, and the first few
 *  covers off the shelf. A cover that won't resolve is simply left out. */
async function shelfCardData(index) {
  if (!index?.total) return null;
  const covers = await Promise.all(
    index.albums
      .slice(0, SHELF_COVERS)
      .map((album) => inlineCover(album.sample, SHELF_COVER_SIZE)),
  );
  return {
    total: index.total,
    artists: index.artists,
    plays: index.plays,
    listened: formatListenTime(index.albums.reduce((n, a) => n + (a.seconds || 0), 0)),
    covers: covers.filter(Boolean),
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
    // The roster cards. Neither takes free text: `participant` carries a
    // handle, which has to match somebody in the roster before anything is
    // drawn, and `board` carries nothing at all.
    const bundles = { bundled: RATIOED_EVENTS, audience: RATIOED_AUDIENCE };
    let participant = null;
    let board = null;
    if (!piece && q.participant) {
      participant = await participantCard(clampText(q.participant), origin, bundles);
    }
    if (!piece && !participant && (q.board === '1' || q.board === 'true')) {
      board = await participantsCard(origin, bundles);
    }
    // A mothing night gets its own card too — the moths that came to the
    // light, which a title and a blurb can't carry either.
    let night = null;
    if (!piece && !participant && !board && q.night) {
      const found = await nightSession(clampText(q.night), origin);
      if (found?.session) night = await nightCardData(found.session);
      // Stamp the folio with the night's own day, exactly as a record card is
      // stamped with the record's — the notebook page number is what dates
      // this card now that its headline names the session instead.
      if (night && !q.date) folioAt = new Date(`${night.date}T00:00:00Z`);
    }
    // The listening cards. None of the three takes free text either: `play`
    // carries a record key, `album` a slug that has to match something in the
    // index before anything is drawn, and `albums` carries nothing at all.
    let play = null;
    let album = null;
    let shelf = null;
    const takenAlready = piece || participant || board || night;
    if (!takenAlready && q.play) {
      play = await playCardData(await playRecord(clampText(q.play), origin));
      if (play?.date && !q.date) {
        const d = new Date(play.date);
        if (!Number.isNaN(d.getTime())) folioAt = d;
      }
    }
    if (!takenAlready && !play && q.album) {
      album = await albumCardData(await albumBySlug(clampText(q.album), origin));
    }
    if (!takenAlready && !play && !album && (q.albums === '1' || q.albums === 'true')) {
      shelf = await shelfCardData(await albumsIndex(origin));
    }
    // A handle nobody in the roster answers to, or a roster that could not be
    // read: draw the work's own card rather than the site's home index, which
    // is what a bare fall-through would give. The middleware marks that path
    // noindex anyway; this is only about what a human sees if they open the
    // image URL by hand.
    if (!piece && !participant && !board && (q.participant || q.board)) {
      const meta = pageMeta('/creating');
      pathname = '/creating';
      label = meta.label;
      subtitle = meta.desc;
      nsid = meta.nsid;
    }
    // A record key no play answers to, or an album the index doesn't hold:
    // the listening surface's own card, for the same reason. (`albums=1` needs
    // no clause — the middleware sends `page=/listening/albums` alongside it,
    // so an unreadable index falls through to that page's ordinary card.)
    if (!takenAlready && !play && !album && (q.play || q.album)) {
      const meta = pageMeta('/listening');
      pathname = '/listening';
      label = meta.label;
      subtitle = meta.desc;
      nsid = meta.nsid;
    }
    if (piece || participant || board) {
      // Fall through to the render with one of them set; nothing else applies.
    } else if (night) {
      // Same: the night card reads everything off the session.
      pathname = '/mothing';
      nsid = MOTHING_OBSERVATION_NSID;
    } else if (play || album || shelf) {
      // Same again: the listening cards read everything off the record, or off
      // the album index. A play names the lexicon it was actually written to,
      // which is not always the production one — teal.fm's alpha archive is
      // still addressable and the margin should say so when it's what's drawn.
      pathname = play ? '/listening' : '/listening/albums';
      nsid = play?.nsid || pageMeta(pathname).nsid;
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
      participant,
      board,
      night,
      play,
      album,
      shelf,
      marks,
      // The same categorical scale the charts derive for this hour, so a card
      // and the page it links to agree about which colour a like is.
      scale: piece || participant || board ? ratioedScale(hour) : null,
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
