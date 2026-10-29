// Which sky-avatar is "current"?
//
// Dame's Bluesky avatar is regenerated every hour to track the sun in her
// timezone — Eastern (see the blog post
// writing/blogs/how-i-made-an-automated-dynamic-avatar-for-my-bluesky-profile.md).
// The favicon and the OG cards reuse that same set of 24 hourly sky gradients
// so the whole site drifts through the day in lockstep with the real avatar.
//
// The hour is read on Dame's clock, America/New_York (not a fixed UTC
// offset), so it follows EST/EDT across daylight-saving changes, exactly like
// the phone automation that drives the live avatar.
//
// That clock, and the day-of-life count below, live in src/lib (time.js and
// dayOfLife.js) and are re-exported here rather than restated. The site's
// chrome, its ledger headers and these cards print the same day number; when
// this file kept a copy of the count, the chrome said 12,228 beside a card's
// 12,227. Both modules are plain functions with no browser APIs, so the edge
// middleware and the serverless card renderer run them as the page does.

import { easternHour } from '../src/lib/time.js';
import { dayOfLife } from '../src/lib/dayOfLife.js';

export { easternHour, easternDate } from '../src/lib/time.js';
export { dayOfLife } from '../src/lib/dayOfLife.js';

// Avatar files are named on a 12-hour clock: 12am, 1am … 11am, 12pm, 1pm …
// 11pm — matching images/sky-avatars/<key>.jpg and the embedded asset keys.
const KEYS = [
  '12am', '1am', '2am', '3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am',
  '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm',
];

/** The sky-avatar key ("6pm", "12am", …) for the current Eastern hour. */
export function currentAvatarKey(now = new Date()) {
  return KEYS[easternHour(now)];
}

/** All 24 keys, in clock order. */
export function avatarKeys() {
  return KEYS.slice();
}

// The OG cards print a notebook "folio" — the current day-of-life — in the
// bottom margin, so every card is quietly stamped with which day of the
// life/project it was made on. dayOfLife (src/lib/dayOfLife.js) counts
// calendar days on Dame's clock: an instant is read as the date it fell on in
// New York, a 'YYYY-MM-DD' string as the day it names (a night's date, for
// one). Counted in UTC instead, the folio turned over at 8pm Eastern, and a
// card made in the evening carried tomorrow's number while the site showed
// today's.

/** The folio string for the card margin, with thousands separators. */
export function folio(at = new Date()) {
  return dayOfLife(at).toLocaleString('en-US');
}

/**
 * Seconds remaining until the top of the next hour (Eastern minutes/seconds
 * track UTC minutes/seconds, so we can compute this from UTC). Used to set
 * Cache-Control max-age so a cached favicon / card expires right as the avatar
 * turns over. Clamped to a small floor so we never emit max-age=0.
 */
export function secondsUntilNextHour(now = new Date()) {
  const secsIntoHour = now.getUTCMinutes() * 60 + now.getUTCSeconds();
  return Math.max(60, 3600 - secsIntoHour);
}
