// Vercel serverless function: the site's browser favicon, rotating hourly to
// match Dame's live Bluesky avatar. That avatar is regenerated every hour to
// track the sun in Eastern time (see the "automated dynamic avatar" blog
// post); here we serve the matching sky-gradient tile for the current Eastern
// hour so the tab icon drifts through the day in lockstep.
//
// Wired up in index.html as `<link rel="icon" href="/api/favicon">`. Static
// files under /images aren't reliably served in production (the SPA catch-all
// rewrite swallows them), so the art is embedded as base64 in og/assets and
// streamed from here instead.

import { ICONS } from '../og/assets/icons.js';
import { currentAvatarKey, secondsUntilNextHour } from '../og/time.js';

export default function handler(req, res) {
  const key = currentAvatarKey();
  const b64 = ICONS[key];
  if (!b64) {
    // Should never happen (24 keys, hour is 0–23) — fail loud but harmless.
    return res.status(500).json({ error: `no favicon for hour key ${key}` });
  }

  const png = Buffer.from(b64, 'base64');
  const maxAge = secondsUntilNextHour();
  res.setHeader('Content-Type', 'image/png');
  // Cache at the CDN + browser until the top of the next Eastern hour, when
  // the avatar turns over. stale-while-revalidate lets the swap happen off the
  // critical path.
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=60`);
  res.setHeader('Content-Length', String(png.length));
  return res.status(200).end(png);
}
