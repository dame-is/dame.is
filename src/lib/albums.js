// Albums, derived.
//
// teal.fm scrobbles TRACKS. There is no album record anywhere — not on the PDS,
// not in either play lexicon — so an album on this site is what a run of plays
// adds up to, the same way a mothing night is what a run of observations adds
// up to (src/lib/mothing.js). Everything below derives that grouping, and
// derives it identically wherever it runs: the browser builds it from the live
// play history, the build writes it into public/data/albums.json, and the edge
// middleware + the OG renderer read it back. One function, so a page and the
// card that links to it can never disagree about what an album contains.
//
// Grouping is on the DISPLAYED text — release name plus the primary artist —
// not on MusicBrainz ids, for the reason ListeningStats gives: a release id
// comes and goes scrobble to scrobble, which would split one album into two
// identical-looking rows. The artist is part of the key so two records called
// "Home" by two different people stay two albums.
//
// Import-light on purpose (teal.js and nothing else): this module is read from
// the Edge runtime, from a plain Node build script, and from the browser.

import { playArtistNames, playTrackName, playedAtOf } from './teal.js';

/** How many of an album's tracks the snapshot carries. Past this it's a box set
 *  compilation, and the page's own live pull has the rest. */
export const SNAPSHOT_TRACK_CAP = 40;

const lower = (s) => String(s ?? '').trim().toLowerCase();
const instant = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : null;
};

/**
 * Read a play in whichever shape the caller has it: a raw PDS record
 * (`{ uri, value }`, what listTealPlays and the listening snapshot give), or a
 * unified-feed item (`{ atUri, payload, createdAt }`, what the pages carry).
 * Null when there's no record value to read.
 */
function normalizePlay(entry) {
  const value = entry?.value || entry?.payload || null;
  if (!value || typeof value !== 'object') return null;
  const uri = entry?.uri || entry?.atUri || null;
  const at = entry?.createdAt || playedAtOf(value) || value.createdAt || null;
  return { uri, value, at, ms: instant(at) };
}

/**
 * The album a play belongs to — `{ key, title, artist }` — or null when the
 * scrobble named no release. A play with no `releaseName` is a single as far as
 * this site can tell, and inventing an album for it would put a made-up page on
 * the map.
 */
export function albumIdentity(value) {
  const title = String(value?.releaseName ?? '').trim();
  if (!title) return null;
  const artist = playArtistNames(value)[0] || '';
  return { key: `${lower(title)}|${lower(artist)}`, title, artist };
}

/** djb2, base 36. Not a checksum — a short, stable tail for a slug that would
 *  otherwise be empty (a title written entirely in a non-Latin script). */
function hash36(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** One slug segment: folded to ASCII, lowercased, hyphenated, bounded. */
function slugPart(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // drop the combining marks NFKD split off
    .replace(/[&+]/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
}

/**
 * The address an album answers to: `raven-by-kelela`.
 *
 * Deterministic — the same title and artist always produce the same slug, so
 * the URL survives a rebuild, and nothing has to be stored to keep a link
 * working. It is lossy, though: two albums CAN fold onto one slug (an album
 * actually called "X by Y" is the obvious way), so `findAlbum` resolves a slug
 * by comparing computed slugs across the index rather than trusting it to be
 * unique, and the most-played album wins a tie.
 */
export function albumSlug(title, artist) {
  const t = slugPart(title);
  const a = slugPart(artist);
  const base = t && a ? `${t}-by-${a}` : t || a;
  if (base) return base;
  const key = `${lower(title)}|${lower(artist)}`;
  return key === '|' ? '' : `album-${hash36(key)}`;
}

/**
 * Every album a set of plays adds up to, most-played first.
 *
 * Each album is plain JSON so the build can write it straight into a snapshot:
 *
 *   { key, slug, title, artist, artists[], plays, seconds, tracks,
 *     firstPlayed, lastPlayed, lastUri, sample, trackList[] }
 *
 * `sample` is one play's record value, kept so a cover can be looked up later
 * (the art ladder needs an ISRC / Apple id / track+artist, none of which an
 * album has of its own). `trackList` is `{ name, plays, seconds, lastPlayed,
 * lastUri }` per track, most-played first.
 */
export function buildAlbums(plays, { maxTracks = 0 } = {}) {
  const byKey = new Map();

  for (const entry of plays || []) {
    const play = normalizePlay(entry);
    if (!play) continue;
    const id = albumIdentity(play.value);
    if (!id) continue;

    let album = byKey.get(id.key);
    if (!album) {
      album = {
        key: id.key,
        slug: albumSlug(id.title, id.artist),
        title: id.title,
        artist: id.artist,
        artists: [],
        plays: 0,
        seconds: 0,
        firstPlayed: null,
        lastPlayed: null,
        lastUri: null,
        sample: null,
        tracks: new Map(),
      };
      byKey.set(id.key, album);
    }

    album.plays += 1;
    const seconds = Number(play.value.duration);
    if (Number.isFinite(seconds) && seconds > 0) album.seconds += seconds;
    for (const name of playArtistNames(play.value)) {
      if (!album.artists.includes(name)) album.artists.push(name);
    }
    if (play.ms != null) {
      const firstMs = instant(album.firstPlayed);
      const lastMs = instant(album.lastPlayed);
      if (firstMs == null || play.ms < firstMs) album.firstPlayed = play.at;
      if (lastMs == null || play.ms >= lastMs) {
        album.lastPlayed = play.at;
        album.lastUri = play.uri;
      }
    }
    // The cover is looked up from one play, so prefer the play carrying the
    // strongest identifier — an ISRC resolves exactly, a text search guesses.
    album.sample = betterSample(album.sample, play.value);

    const name = playTrackName(play.value);
    if (name) {
      const trackKey = lower(name);
      let track = album.tracks.get(trackKey);
      if (!track) {
        // No per-track `firstPlayed`: the album carries the span, and a track
        // list is read as a ranking rather than a history. One more timestamp
        // per track is a third of the build's albums snapshot for a line
        // nothing draws.
        track = { name, plays: 0, seconds: 0, lastPlayed: null, lastUri: null };
        album.tracks.set(trackKey, track);
      }
      track.plays += 1;
      if (Number.isFinite(seconds) && seconds > 0) track.seconds += seconds;
      if (play.ms != null) {
        const lastMs = instant(track.lastPlayed);
        if (lastMs == null || play.ms >= lastMs) {
          track.lastPlayed = play.at;
          track.lastUri = play.uri;
        }
      }
    }
  }

  // `tracks` counts them and `trackList` is them, so the accumulator's Map
  // (which is neither, and doesn't survive JSON) is dropped here.
  const albums = Array.from(byKey.values()).map(({ tracks: byTrack, ...album }) => {
    const trackList = Array.from(byTrack.values()).sort(compareTracks);
    return {
      ...album,
      sample: artSample(album.sample),
      tracks: trackList.length,
      trackList: maxTracks > 0 ? trackList.slice(0, maxTracks) : trackList,
    };
  });

  return albums.sort(compareAlbums);
}

/** Most played, then most recent, then alphabetical — a total order, so two
 *  builds of the same plays list the same albums in the same places. */
export function compareAlbums(a, b) {
  return (
    (b.plays || 0) - (a.plays || 0) ||
    (instant(b.lastPlayed) || 0) - (instant(a.lastPlayed) || 0) ||
    String(a.title).localeCompare(String(b.title))
  );
}

function compareTracks(a, b) {
  return (
    (b.plays || 0) - (a.plays || 0) ||
    (instant(b.lastPlayed) || 0) - (instant(a.lastPlayed) || 0) ||
    String(a.name).localeCompare(String(b.name))
  );
}

/** Which of two play values is the better basis for an artwork lookup. */
function betterSample(held, candidate) {
  if (!held) return candidate;
  const rank = (v) => (v?.isrc ? 2 : playArtistNames(v).length && playTrackName(v) ? 1 : 0);
  return rank(candidate) > rank(held) ? candidate : held;
}

/**
 * The sample, cut down to what a cover lookup actually reads (see
 * src/lib/musicIds.js): a recording identifier, an origin URL an Apple song id
 * can be picked out of, and a track and artist to fall back to searching on.
 *
 * A whole play record is four times the size and the rest of it — MusicBrainz
 * ids, the submitting client, when it was played — answers no question this
 * field exists to answer. Across a couple of hundred albums that is most of the
 * build's albums snapshot, which every visit to the shelf downloads.
 */
function artSample(value) {
  if (!value) return null;
  const sample = {};
  if (value.isrc) sample.isrc = value.isrc;
  const origin = value.originUri || value.originUrl;
  if (origin) sample.originUri = origin;
  const track = playTrackName(value);
  if (track) sample.trackName = track;
  const artists = playArtistNames(value);
  if (artists.length) sample.artists = artists.map((artistName) => ({ artistName }));
  return sample;
}

/** Most recently played first — the other way the index reads. */
export function compareAlbumsRecent(a, b) {
  return (
    (instant(b.lastPlayed) || 0) - (instant(a.lastPlayed) || 0) ||
    (b.plays || 0) - (a.plays || 0) ||
    String(a.title).localeCompare(String(b.title))
  );
}

/**
 * The album a `/listening/albums/{slug}` path names, or null.
 *
 * Matched on the slug each album computes for itself rather than on a stored
 * one, so nothing has to be written down for an address to keep working; see
 * `albumSlug` for why the most-played album wins a collision.
 */
export function findAlbum(albums, slug) {
  const want = String(slug ?? '').trim().toLowerCase();
  if (!want) return null;
  let best = null;
  for (const album of albums || []) {
    const has = album?.slug || albumSlug(album?.title, album?.artist);
    if (has !== want) continue;
    if (!best || compareAlbums(album, best) < 0) best = album;
  }
  return best;
}

/** `/listening/albums/raven-by-kelela` for an album, or null if it has no slug. */
export function albumPath(album) {
  const slug = album?.slug || albumSlug(album?.title, album?.artist);
  return slug ? `/listening/albums/${encodeURIComponent(slug)}` : null;
}

/**
 * The literal segment under /listening that is not a play's record key.
 *
 * `/listening/{rkey}` is a play, so `/listening/albums` would otherwise be read
 * as a play keyed `albums` — a lookup that can only ever miss, which at the
 * edge means a 404 on a real page and in the app means advertising an at:// URI
 * for a record that isn't there. Everywhere that resolves a record from a path
 * checks this first, from one constant so they cannot drift.
 *
 * (Same split `/mothing` makes between a date and an observation id, except a
 * date can be told apart by its shape and `albums` cannot: a teal rkey is a
 * TID, and nothing stops one spelling a word.)
 */
export const ALBUMS_SEGMENT = 'albums';

/** True when a path addresses an album surface — the index or one album. */
export function isAlbumPath(pathname) {
  const segs = String(pathname || '').split('/').filter(Boolean);
  if (segs[0] !== 'listening' || segs[1] !== ALBUMS_SEGMENT) return false;
  return segs.length === 2 || segs.length === 3;
}

/** "42 plays, 11 tracks, 2 hr 14 min" — the album in three parts. */
export function albumSummaryParts(album) {
  if (!album) return [];
  const parts = [plural(album.plays || 0, 'play')];
  if (album.tracks) parts.push(plural(album.tracks, 'track'));
  const listened = formatListenTime(album.seconds);
  if (listened) parts.push(listened);
  return parts;
}

/** Whole hours and minutes; nothing under a minute is worth a line. */
export function formatListenTime(seconds) {
  const total = Math.round(Number(seconds) || 0);
  if (total < 60) return '';
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

function plural(n, word) {
  return `${Number(n || 0).toLocaleString('en-US')} ${word}${Number(n) === 1 ? '' : 's'}`;
}

/**
 * `{ title, description }` for an album's <head> and its card — the copy a
 * crawler reads and the copy a share preview carries, from one place so they
 * say the same thing.
 */
export function albumCardCopy(album) {
  const title = album?.title || 'Album';
  const by = album?.artist ? ` by ${album.artist}` : '';
  const summary = albumSummaryParts(album).join(', ');
  const since = album?.firstPlayed ? ` Played here since ${monthYear(album.firstPlayed)}.` : '';
  return {
    title,
    description: `${title}${by} on dame.is — ${summary}.${since}`,
  };
}

/** "March 2026". Plain Intl, so it reads the same at the edge and in a build. */
export function monthYear(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Albums out of whatever `/data/albums.json` holds, or `[]`. Written as
 * `{ builtAt, plays, albums }` — the wrapper carries the build's own reach, so
 * a reader can tell "no albums" from "the snapshot didn't load".
 */
export function albumsFromSnapshot(json) {
  const albums = Array.isArray(json?.albums) ? json.albums : Array.isArray(json) ? json : [];
  return albums.filter((a) => a && a.title);
}
