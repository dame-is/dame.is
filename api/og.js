// Vercel serverless function: dynamic Open Graph card generator, powered by
// @vercel/og (satori + resvg). Renders the 1200×630 "notebook / design-layout"
// card defined in og/design.js, with the current Eastern-hour sky-avatar baked
// in beside the breadcrumb so cards drift through the day like the favicon and
// the live avatar.
//
// Usage (from the per-page meta injected by middleware.js):
//   /api/og?page=/blogging          → looks up copy + NSID from og/pages.js
//   /api/og?title=Foo&subtitle=Bar  → ad-hoc copy
//   /api/og?theme=dark              → dark (green-black) variant
//   /api/og                         → the home "index" card
//
// Node runtime (matches the rest of /api). @vercel/og runs fine here; we pull
// the PNG bytes off the ImageResponse and stream them through `res`.

import { ImageResponse } from '@vercel/og';
import { FONTS } from '../og/assets/fonts.js';
import { ICONS } from '../og/assets/icons.js';
import { currentAvatarKey, secondsUntilNextHour, folio } from '../og/time.js';
import { ogElement } from '../og/design.js';
import { pageMeta, segsFor, cleanPath, HOME_INDEX, DEFAULT } from '../og/pages.js';

// The card uses two families: Crimson Pro (serif) for the breadcrumb / title /
// description and IBM Plex Mono for the folio + NSID marginalia.
const crimson = (id, weight, style = 'normal') => ({ name: 'Crimson Pro', data: Buffer.from(FONTS[id], 'base64'), weight, style });
const plex = (id, weight) => ({ name: 'IBM Plex Mono', data: Buffer.from(FONTS[id], 'base64'), weight, style: 'normal' });

const FONT_SET = [
  crimson('300', 300),
  crimson('400', 400),
  crimson('600', 600),
  crimson('700', 700),
  crimson('400i', 400, 'italic'),
  crimson('600i', 600, 'italic'),
  plex('mono400', 400),
  plex('mono500', 500),
];

export default async function handler(req, res) {
  try {
    const q = req.query || {};
    const theme = q.theme === 'dark' ? 'dark' : 'light';

    // Copy + routing: an explicit `page` wins (canonical per-page card),
    // otherwise ad-hoc title/subtitle params, otherwise the home index card.
    let pathname = '/';
    let label = '';
    let subtitle = '';
    let nsid = DEFAULT.nsid;
    if (q.page) {
      pathname = cleanPath(String(q.page));
      const meta = pageMeta(pathname);
      label = meta.label;
      subtitle = meta.desc;
      nsid = meta.nsid;
    } else if (q.title || q.subtitle) {
      label = String(q.title || '');
      subtitle = String(q.subtitle || '');
      pathname = label ? `/${label.toLowerCase().replace(/\s+/g, '-')}` : '/';
    }

    const key = currentAvatarKey();
    const avatarUri = ICONS[key] ? `data:image/png;base64,${ICONS[key]}` : null;

    const element = ogElement({
      pathname,
      label,
      subtitle,
      nsid,
      segs: segsFor(pathname),
      avatarUri,
      folio: folio(),
      theme,
      homeIndex: HOME_INDEX,
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
