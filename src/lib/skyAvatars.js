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

/** Bundled asset URL for the sky-avatar frame of an hour 0–23 (null if
 *  the frame is missing, so callers can fall back to the live avatar). */
export function skyAvatarUrl(hour) {
  const key = KEYS[((hour % 24) + 24) % 24];
  return FRAMES[`../../images/sky-avatars/${key}.jpg`] || null;
}
