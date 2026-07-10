// The 24 hourly sky-avatar frames (the same art the live Bluesky avatar
// cycles through — see the "automated dynamic avatar" blog post), keyed
// by Eastern hour. Bundled through Vite as hashed assets because bare
// /images paths aren't reliably served in production (the SPA catch-all
// rewrite swallows them — same reason api/favicon.js embeds its art).
// Only the frame actually displayed is ever fetched.
//
// Used by the chrome-bar brand mark while the TEMPORARY sky-theme hour
// chip is overriding the clock: the mark swaps from the live Bluesky
// avatar to the frame matching the overridden hour, so avatar + palette
// step through the day together. Remove alongside the chip.

import { avatarKeys } from '../../og/time.js';

const KEYS = avatarKeys();

const FRAMES = import.meta.glob('../../images/sky-avatars/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** Bundled asset URL for the sky-avatar frame of an hour 0–23 (null if
 *  the frame is missing, so callers can fall back to the live avatar). */
export function skyAvatarUrl(hour) {
  const key = KEYS[((hour % 24) + 24) % 24];
  return FRAMES[`../../images/sky-avatars/${key}.jpg`] || null;
}
