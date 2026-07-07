// Vercel serverless function: dynamic Open Graph card generator, powered by
// @vercel/og (satori + resvg). Renders the 1200×630 paper/book card defined in
// og/design.js, with the current Eastern-hour sky-avatar baked into the top
// chrome bar so cards drift through the day like the favicon and live avatar.
//
// Usage (from the per-page meta injected by middleware.js):
//   /api/og?page=/blogging          → looks up copy from og/pages.js
//   /api/og?title=Foo&subtitle=Bar  → ad-hoc copy
//   /api/og?theme=dark              → dark (green-black) variant
//   /api/og                         → the default home card
//
// Node runtime (matches the rest of /api). @vercel/og runs fine here; we pull
// the PNG bytes off the ImageResponse and stream them through `res`.

import { ImageResponse } from '@vercel/og';
import { FONTS } from '../og/assets/fonts.js';
import { ICONS } from '../og/assets/icons.js';
import { currentAvatarKey, secondsUntilNextHour } from '../og/time.js';
import { ogElement } from '../og/design.js';
import { pageMeta, SITE } from '../og/pages.js';

const font = (id, weight, style = 'normal') => ({
  name: 'Crimson Pro',
  data: Buffer.from(FONTS[id], 'base64'),
  weight,
  style,
});

const FONT_SET = [
  font('300', 300),
  font('400', 400),
  font('600', 600),
  font('700', 700),
  font('400i', 400, 'italic'),
];

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const theme = q.theme === 'dark' ? 'dark' : 'light';

    // Copy: an explicit `page` wins (canonical per-page card), otherwise fall
    // back to ad-hoc title/subtitle params, otherwise the home default.
    let label = '';
    let subtitle = '';
    if (q.page) {
      const meta = pageMeta(String(q.page));
      label = meta.label;
      subtitle = meta.desc;
    } else if (q.title || q.subtitle) {
      label = String(q.title || '');
      subtitle = String(q.subtitle || '');
    } else {
      const meta = pageMeta('/');
      label = meta.label;
      subtitle = meta.desc;
    }

    const key = currentAvatarKey();
    const avatarUri = ICONS[key] ? `data:image/png;base64,${ICONS[key]}` : null;

    const element = ogElement({
      label,
      subtitle,
      avatarUri,
      theme,
      tagline: SITE.tagline.replace(/\.$/, ''),
    });

    const image = new ImageResponse(element, {
      width: 1200,
      height: 630,
      fonts: FONT_SET,
    });
    const png = Buffer.from(await image.arrayBuffer());

    const maxAge = secondsUntilNextHour();
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', `public, max-age=${maxAge}, s-maxage=${maxAge}, stale-while-revalidate=86400`);
    res.setHeader('Content-Length', String(png.length));
    return res.status(200).end(png);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'og render failed' });
  }
}
