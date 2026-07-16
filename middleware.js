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
import { pageContentMeta } from './og/pageContent.js';
import { ME_DID, COLLECTIONS, BLOG_PUBLICATION, PORTFOLIO_PUBLICATION } from './src/config.js';

const ORIGIN = 'https://dame.is';

// site.standard.document is the lexicon Bluesky renders as a Standard Site
// embed. Its section homes map to the publication the docs belong to.
const STANDARD_DOC_NSID = 'site.standard.document';
const SECTION_PUBLICATION = {
  '/blogging': BLOG_PUBLICATION,
  '/creating': PORTFOLIO_PUBLICATION,
};

// Top-level surfaces backed by an is.dame.page record (keyed by rkey), mirroring
// the client's src/hooks/useAtUri.js `pageRkeyForPath`. Used to give crawlers
// the same canonical at:// URI the SPA advertises via <AtUriHead>.
const TOP_LEVEL_PAGE_RKEY = {
  '/blogging': 'blogging',
  '/creating': 'creating',
  '/posting': 'posting',
  '/logging': 'logging',
  '/sharing': 'sharing',
  '/listening': 'listening',
};

/** The at:// URI backing a top-level surface, or null. */
function topLevelAtUri(path) {
  const rkey = TOP_LEVEL_PAGE_RKEY[path];
  if (rkey) return `at://${ME_DID}/${COLLECTIONS.page}/${rkey}`;
  if (path === '/themself') return `at://${ME_DID}/${COLLECTIONS.profile}/self`;
  return null;
}

export const config = {
  matcher: [
    '/themself',
    '/available',
    '/blogging',
    '/blogging/:slug',
    '/creating',
    '/creating/:slug',
    '/curating',
    '/curating/:slug',
    '/listening',
    '/listening/:rkey',
    '/posting',
    '/posting/:rkey',
    '/logging',
    '/logging/:rkey',
    '/mothing',
    '/mothing/:rkey',
    '/sharing',
    '/welcoming',
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

// Inject the atmospheric <head> hints that let AT clients discover the record(s)
// backing this view — the crawler-facing mirror of <AtUriHead> (which only runs
// client-side, so JS-less crawlers never saw it). Marked data-atproto="ssr" so
// the client strips these on boot and stays the single source of truth in-app.
function injectAtprotoHead(html, atUri, cid) {
  const uri = escapeAttr(atUri);
  let tags =
    `    <link rel="alternate" type="application/at-record+json" href="${uri}" data-atproto="ssr" />\n` +
    `    <meta name="atproto:uri" content="${uri}" data-atproto="ssr" />\n`;
  if (cid) tags += `    <meta name="atproto:cid" content="${escapeAttr(cid)}" data-atproto="ssr" />\n`;
  return html.replace(/<\/head>/i, `${tags}  </head>`);
}

// Standard Site link tags: what Bluesky (and other AT clients) read to render a
// site.standard.document as a rich "Standard Site" embed instead of a plain OG
// card. Their crawler runs no JS, so these must be server-side. `document` goes
// on an article page, `publication` on both articles and the publication home.
// Verification is against the publication's own domain (its record `url` +
// /.well-known/site.standard.publication), so a re-render like dame.is only
// needs to declare the refs here. See https://standard.site/docs/verification/.
function injectStandardSiteHead(html, { document: documentUri, publication: publicationUri }) {
  let tags = '';
  if (documentUri) tags += `    <link rel="site.standard.document" href="${escapeAttr(documentUri)}" />\n`;
  if (publicationUri) tags += `    <link rel="site.standard.publication" href="${escapeAttr(publicationUri)}" />\n`;
  return tags ? html.replace(/<\/head>/i, `${tags}  </head>`) : html;
}

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const path = cleanPath(url.pathname);
    const segs = segsFor(path);

    // Two title conventions:
    //   • top-level surfaces → the page's own "dame.is {label}" (from pages.js)
    //   • record/leaf pages   → "{record title} — dame.is" + a per-record OG
    //     card, resolved by slug from the /data snapshots (with a live PDS
    //     fallback; see og/records.js).
    // A record route whose record can't be resolved degrades to the section's
    // own card + title, so crawlers never see the generic home card there.
    let title;
    let desc;
    let ogImage;
    let atUri = null;
    let cid = null;
    // Standard Site refs: the site.standard.document + its publication, for the
    // Bluesky rich embed. `stdDoc` only on article pages; `stdPub` on articles
    // and the publication home pages (/blogging, /creating).
    let stdDoc = null;
    let stdPub = null;
    if (segs.length === 2) {
      const sectionSeg = segs[0];
      const sectionPath = `/${sectionSeg}`;
      const section = pageMeta(sectionPath);
      const rec = await recordMeta(path, url.origin);
      if (rec) {
        // The record resolved: its own OG card + at:// URI for the head. Falls
        // back below only when it can't be resolved.
        //   • titled records (blog/work/channel/track/moth) → "{title} — dame.is"
        //     with the title as the card headline and its description beneath.
        //   • textOnly records (posts, statuses) have no title of their own, so
        //     the section names the page, the text becomes the description, and
        //     the card renders the text as body copy.
        const cardSubtitle = rec.textOnly ? '' : rec.description;
        if (rec.textOnly) {
          title = section.title;
          desc = rec.title;
        } else {
          title = `${rec.title} — ${SITE.domain}`;
          desc = rec.description || section.desc;
        }
        const params = new URLSearchParams({
          section: sectionSeg,
          label: rec.title,
          subtitle: cardSubtitle,
          nsid: rec.nsid || section.nsid,
        });
        // Stamp the card's day-of-life folio with the record's own date.
        if (rec.date) params.set('date', rec.date);
        if (rec.textOnly) params.set('body', '1');
        ogImage = `${ORIGIN}/api/og?${params.toString()}`;
        atUri = rec.atUri;
        cid = rec.cid;
        // Only site.standard.document records get the Standard Site embed; a
        // leaflet or arena record on these routes is skipped.
        if (rec.nsid === STANDARD_DOC_NSID) {
          stdDoc = rec.atUri;
          stdPub = rec.publication;
        }
      } else {
        // A record route whose record can't be fetched degrades to the
        // section's own card + title, so crawlers never see the generic home
        // card there.
        title = section.title;
        desc = section.desc;
        ogImage = `${ORIGIN}/api/og?page=${encodeURIComponent(sectionPath)}`;
      }
    } else {
      const meta = pageMeta(path);
      title = meta.title;
      desc = meta.desc;
      // Prefer the live / snapshotted is.dame.page copy over the static default,
      // so editing the record on the PDS updates the crawler description AND the
      // card. Returns null (→ keep the static copy) when no record exists.
      const pageContent = await pageContentMeta(path, url.origin);
      if (pageContent?.desc) desc = pageContent.desc;
      const ogParams = new URLSearchParams({ page: path });
      // Hand the resolved copy to the card generator so it renders the same
      // description without re-fetching (mirrors the record-card path above).
      if (pageContent?.desc) ogParams.set('subtitle', pageContent.desc);
      ogImage = `${ORIGIN}/api/og?${ogParams.toString()}`;
      atUri = topLevelAtUri(path);
      // Publication home pages advertise their publication for the embed.
      stdPub = SECTION_PUBLICATION[path] || null;
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

    // Record/leaf pages (and the top-level surfaces) advertise their canonical
    // at:// URI so AT-aware crawlers can find the backing record.
    if (atUri) html = injectAtprotoHead(html, atUri, cid);

    // Standard Site link tags → Bluesky renders the rich publication embed.
    if (stdDoc || stdPub) html = injectStandardSiteHead(html, { document: stdDoc, publication: stdPub });

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
