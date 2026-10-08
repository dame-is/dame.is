// Plays the scrobbler logged that never happened.
//
// Every play on the site is written by piper, teal.fm's Apple Music scrobbler.
// Apple's API hands it a "recently played" list with no timestamps, so piper
// polls that list and writes a play stamped "now" whenever the list changes:
// `playedTime` matches the moment the record was written (its rkey TID) within
// seconds, and most plays land on :03 or :33 past the minute, which points to
// a 30-second poll. When Apple's list shuffles with nothing playing, piper reads
// that as listening too. Reading the whole archive (Dec 2025 to Oct 2026,
// about 4,800 plays) turned up two kinds of noise:
//
//  1. Doubles. The same song logged again before the first copy could have
//     finished: SOS (Sex on Sight), a 4:21 track, logged twice 30 seconds
//     apart, or two songs flip-flopping A, B, A, B a minute apart.
//
//  2. Echoes. A burst of one or two songs out of nowhere, made only of songs
//     from the last time anything played. Half of them land between 5 and 8am
//     Eastern, with a second cluster around 9 to 11pm, and about half of all
//     listening days have one: the evening ends on Money (Interlude), and at
//     7:24 and 7:36 the next morning DNA. and Money (Interlude) turn up again
//     with nobody listening.
//
// Nothing here touches the PDS. The plays stay in the repo and on their own
// /listening/{rkey} pages; they're only left out of the feeds and the stats.
//
// Both rules can catch a real listen: playing the same favourite once the
// morning after you last played it reads exactly like an echo. The thresholds
// below were tuned against the archive, and by construction a session of three
// or more songs, or with any song not heard recently, is never touched.

import { LISTEN_BATCH_GAP_MS } from './listenSessions.js';
import { playArtistLine, playTrackName } from './teal.js';

/**
 * A repeat counts as a double when it arrives less than the song's length
 * after the previous copy, minus one poll of slack: a song on repeat can be
 * noticed up to a poll late the first time and on time the second.
 */
export const DOUBLE_POLL_SLACK_MS = 30 * 1000;

/** Double window for a play whose record has no `duration`. */
export const DOUBLE_FALLBACK_MS = 60 * 1000;

/** An echo is at most this many distinct songs... */
export const ECHO_MAX_SONGS = 2;

/** ...arriving at least this long after the last real listening... */
export const ECHO_SILENCE_MS = 3 * 60 * 60 * 1000;

/**
 * ...made only of songs heard in this window before it, or among the last
 * `ECHO_RECENT_SONGS` distinct songs logged. The second half covers echoes
 * after a few quiet days, which otherwise fall outside the window.
 */
export const ECHO_LOOKBACK_MS = 72 * 60 * 60 * 1000;
export const ECHO_RECENT_SONGS = 4;

/**
 * The set of ghost plays among `items` (unified-feed listening items:
 * `{ createdAt, payload }`). Order of `items` doesn't matter. Items with no
 * usable time or track name are never flagged.
 */
export function findGhostPlays(items) {
  const ghosts = new Set();
  const plays = [];
  for (const item of items || []) {
    const at = Date.parse(item?.createdAt || '');
    const key = songKey(item?.payload);
    if (Number.isFinite(at) && key) plays.push({ item, at, key });
  }
  plays.sort((a, b) => a.at - b.at);

  // Doubles: compared with the most recent copy of the same song, flagged or
  // not, so a run of three copies 30 seconds apart keeps only the first.
  const lastCopy = new Map();
  const kept = [];
  for (const play of plays) {
    const prev = lastCopy.get(play.key);
    lastCopy.set(play.key, play);
    if (prev && play.at - prev.at < doubleWindowMs(play, prev)) {
      ghosts.add(play.item);
    } else {
      kept.push(play);
    }
  }

  // Echoes: the survivors, grouped into sessions the same way the feed
  // batches them, judged oldest first so each echo is measured against what
  // was really playing before it.
  const sessions = [];
  for (const play of kept) {
    const open = sessions[sessions.length - 1];
    const lastAt = open ? open[open.length - 1].at : null;
    if (lastAt !== null && play.at - lastAt <= LISTEN_BATCH_GAP_MS) {
      open.push(play);
    } else {
      sessions.push([play]);
    }
  }
  const history = [];
  let lastRealAt = null;
  for (const session of sessions) {
    if (isEcho(session, history, lastRealAt)) {
      for (const play of session) ghosts.add(play.item);
    } else {
      lastRealAt = session[session.length - 1].at;
    }
    // Echoes stay in the history: the next one replays the top of the same
    // Apple list, which they're part of.
    history.push(...session);
  }

  return ghosts;
}

/** `items` without its ghost plays, in their original order. */
export function dropGhostPlays(items) {
  const ghosts = findGhostPlays(items);
  if (!ghosts.size) return items || [];
  return items.filter((item) => !ghosts.has(item));
}

function songKey(value) {
  const track = playTrackName(value).toLowerCase();
  if (!track) return '';
  return `${track}\u0000${playArtistLine(value).toLowerCase()}`;
}

function doubleWindowMs(play, prev) {
  const seconds =
    Number(play.item.payload?.duration) || Number(prev.item.payload?.duration);
  if (!(seconds > 0)) return DOUBLE_FALLBACK_MS;
  return seconds * 1000 - DOUBLE_POLL_SLACK_MS;
}

function isEcho(session, history, lastRealAt) {
  if (!history.length) return false;
  const songs = new Set(session.map((play) => play.key));
  if (songs.size > ECHO_MAX_SONGS) return false;
  const start = session[0].at;
  if (lastRealAt !== null && start - lastRealAt < ECHO_SILENCE_MS) return false;

  const heard = new Set();
  const lastFew = new Set();
  for (let i = history.length - 1; i >= 0; i--) {
    const { key, at } = history[i];
    const inWindow = start - at <= ECHO_LOOKBACK_MS;
    if (!inWindow && lastFew.size >= ECHO_RECENT_SONGS) break;
    if (lastFew.size < ECHO_RECENT_SONGS) lastFew.add(key);
    heard.add(key);
  }
  for (const key of songs) if (!heard.has(key)) return false;
  return true;
}
