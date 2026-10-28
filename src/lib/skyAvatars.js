// The 24 hourly sky-avatar frames (the same art the live Bluesky avatar
// cycles through — see the "automated dynamic avatar" blog post), keyed
// by Eastern hour. Bundled through Vite as hashed assets because bare
// /images paths aren't reliably served in production (the SPA catch-all
// rewrite swallows them — same reason api/favicon.js embeds its art).
// Only the frame actually displayed is ever fetched.
//
// This is the source of the chrome-bar brand mark: the mark renders the
// frame for useTheme's current hour rather than fetching the avatar off
// the Bluesky profile, so it turns over hourly in lockstep with the sky
// theme's palette (and steps with the temporary test chip's override).

import { avatarKeys } from '../../og/time.js';

const KEYS = avatarKeys();

const FRAMES = import.meta.glob('../../images/sky-avatars/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
});

// The brand mark draws its frame at about 23px, so it reads these 96px copies
// (scripts/gen-sky-marks.mjs) instead of the ~360 KB originals above. A
// separate glob, because `*.jpg` doesn't descend into mark/. `no-inline`
// because each one is about a kilobyte: under Vite's inline limit they would
// all be base64'd into the entry bundle, and every visitor would download all
// 24 to see one.
const MARKS = import.meta.glob('../../images/sky-avatars/mark/*.webp', {
  eager: true,
  query: '?url&no-inline',
  import: 'default',
});

function keyFor(hour) {
  return KEYS[((hour % 24) + 24) % 24];
}

/** Bundled asset URL for the sky-avatar frame of an hour 0–23 (null if
 *  the frame is missing, so callers can fall back to the live avatar). */
export function skyAvatarUrl(hour) {
  return FRAMES[`../../images/sky-avatars/${keyFor(hour)}.jpg`] || null;
}

/** The chrome mark's small copy of an hour's frame, falling back to the
 *  full frame if the small one hasn't been generated. */
export function skyMarkUrl(hour) {
  return (
    MARKS[`../../images/sky-avatars/mark/${keyFor(hour)}.webp`] ||
    skyAvatarUrl(hour)
  );
}
