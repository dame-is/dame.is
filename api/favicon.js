// Vercel serverless function: the site's icons, all rotating hourly to match
// Dame's live Bluesky avatar. That avatar is regenerated every hour to track
// the sun in Eastern time (see the "automated dynamic avatar" blog post); here
// we serve the matching sky-gradient tile for the current Eastern hour so the
// tab icon — and the installed-app icon — drift through the day in lockstep.
//
//   /api/favicon            → 96px PNG  (browser tab; index.html <link rel=icon>)
//   /api/favicon?size=192   → 192px JPEG (PWA / apple-touch)
//   /api/favicon?size=512   → 512px JPEG (PWA)
//
// Static files under /images aren't reliably served in production (the SPA
// catch-all rewrite swallows them), so the art is embedded as base64 in
// og/assets and streamed from here. The larger PWA sizes are JPEG because a
// 512px PNG set would be ~15 MB (film grain); JPEG keeps it ~1 MB. See the web
// manifest in api/manifest.js.

import { ICONS } from '../og/assets/icons.js';
import { APP_ICONS } from '../og/assets/app-icons.js';
import { currentAvatarKey, secondsUntilNextHour } from '../og/time.js';

export default function handler(req, res) {
  const key = currentAvatarKey();
  const size = String((req.query && req.query.size) || '');

  let b64;
  let type;
  if (APP_ICONS[size] && APP_ICONS[size][key]) {
    b64 = APP_ICONS[size][key];
    type = 'image/jpeg';
  } else {
    b64 = ICONS[key];
    type = 'image/png';
  }

  if (!b64) {
    // Should never happen (24 keys, hour is 0–23) — fail loud but harmless.
    return res.status(500).json({ error: `no favicon for hour key ${key} size ${size || '96'}` });
  }

  const buf = Buffer.from(b64, 'base64');
  const maxAge = secondsUntilNextHour();
  res.setHeader('Content-Type', type);
  // Cache at the CDN + browser until the top of the next Eastern hour, when the
  // avatar turns over. stale-while-revalidate lets the swap happen off the
  // critical path.
  res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=60`);
  res.setHeader('Content-Length', String(buf.length));
  return res.status(200).end(buf);
}
