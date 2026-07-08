// Vercel Edge Middleware: give crawlers page-specific Open Graph cards.
//
// dame.is is a client-rendered SPA — every route is served the same static
// index.html, so social crawlers (which don't run JS) would otherwise see one
// generic card for the whole site. For the main page surfaces we intercept the
// request, fetch that shell, and rewrite the <head> meta to point at a
// page-specific dynamic card from /api/og. Everything else (dynamic record
// routes, the SPA itself) falls through untouched and uses the baseline tags
// already in index.html.
//
// The matcher below is deliberately limited to exact page paths, so the busy
// home route and all nested/dynamic routes stay fully static — no middleware
// cost, no risk of breaking client-side navigation.

import { pageMeta, SITE, cleanPath, segsFor } from './og/pages.js';
import { recordMeta } from './og/records.js';

const ORIGIN = 'https://dame.is';

export const config = {
  matcher: [
    '/themself',
    '/for-hire',
    '/blogging',
    '/blogging/:slug',
    '/creating',
    '/creating/:slug',
    '/curating',
    '/curating/:slug',
    '/listening',
    '/posting',
    '/logging',
    '/mothing',
    '/sharing',
  ],
};

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Replace the content="…" of a single <meta> identified by property/name.
function setMeta(html, keyAttr, keyVal, content) {
  const esc = escapeAttr(content);
  const re = new RegExp(
    `(<meta\\s+${keyAttr}="${keyVal}"\\s+content=")[^"]*(")`,
    'i',
  );
  if (re.test(html)) return html.replace(re, `$1${esc}$2`);
  // Not present in the baseline — inject before </head> as a fallback.
  return html.replace(/<\/head>/i, `    <meta ${keyAttr}="${keyVal}" content="${esc}" />\n  </head>`);
}

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const path = cleanPath(url.pathname);
    const segs = segsFor(path);

    // Two title conventions:
    //   • top-level surfaces → the page's own "dame.is {label}" (from pages.js)
    //   • record/leaf pages   → "{record title} — dame.is", resolved live from
    //     the PDS; the OG image falls back to the parent section's card.
    // A record route whose record can't be fetched degrades to the section's
    // own card + title, so crawlers never see the generic home card there.
    let title;
    let desc;
    let ogImage;
    if (segs.length === 2) {
      const sectionPath = `/${segs[0]}`;
      const section = pageMeta(sectionPath);
      const rec = await recordMeta(path);
      title = rec ? `${rec.title} — ${SITE.domain}` : section.title;
      desc = (rec && rec.description) || section.desc;
      ogImage = `${ORIGIN}/api/og?page=${encodeURIComponent(sectionPath)}`;
    } else {
      const meta = pageMeta(path);
      title = meta.title;
      desc = meta.desc;
      ogImage = `${ORIGIN}/api/og?page=${encodeURIComponent(path)}`;
    }

    // Pull the built SPA shell. The matcher never matches /index.html, so this
    // subrequest can't loop back through the middleware.
    const shellRes = await fetch(new URL('/index.html', url.origin), {
      headers: { 'x-og-shell': '1' },
    });
    if (!shellRes.ok) return undefined; // fall through to normal serving
    let html = await shellRes.text();

    const canonical = `${ORIGIN}${path}`;

    html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeAttr(title)}</title>`);
    html = setMeta(html, 'name', 'description', desc);
    html = setMeta(html, 'property', 'og:url', canonical);
    html = setMeta(html, 'property', 'og:title', title);
    html = setMeta(html, 'property', 'og:description', desc);
    html = setMeta(html, 'property', 'og:image', ogImage);
    html = setMeta(html, 'property', 'og:image:alt', title);
    html = setMeta(html, 'name', 'twitter:title', title);
    html = setMeta(html, 'name', 'twitter:description', desc);
    html = setMeta(html, 'name', 'twitter:image', ogImage);

    return new Response(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // Cache the rendered shell at the edge; it only changes when the build
        // or the page copy changes.
        'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return undefined; // never block the page on a meta-injection hiccup
  }
}
