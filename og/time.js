// Which sky-avatar is "current"?
//
// Dame's Bluesky avatar is regenerated every hour to track the sun in her
// timezone — Eastern (see the blog post
// writing/blogs/how-i-made-an-automated-dynamic-avatar-for-my-bluesky-profile.md).
// The favicon and the OG cards reuse that same set of 24 hourly sky gradients
// so the whole site drifts through the day in lockstep with the real avatar.
//
// We resolve the hour in `America/New_York` (not a fixed UTC offset) so it
// follows EST/EDT across daylight-saving changes, exactly like the phone
// automation that drives the live avatar.

const ZONE = 'America/New_York';

// Avatar files are named on a 12-hour clock: 12am, 1am … 11am, 12pm, 1pm …
// 11pm — matching images/sky-avatars/<key>.jpg and the embedded asset keys.
const KEYS = [
  '12am', '1am', '2am', '3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am',
  '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm',
];

/** Current hour (0–23) in Eastern time, DST-aware. `now` overridable for tests. */
export function easternHour(now = new Date()) {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hour: 'numeric',
    hour12: false,
  }).format(now);
  // Intl can emit "24" for midnight in hour12:false — normalise to 0.
  return Number(h) % 24;
}

/** The sky-avatar key ("6pm", "12am", …) for the current Eastern hour. */
export function currentAvatarKey(now = new Date()) {
  return KEYS[easternHour(now)];
}

/** All 24 keys, in clock order. */
export function avatarKeys() {
  return KEYS.slice();
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
