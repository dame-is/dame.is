// Vercel Edge Middleware: make a client-rendered SPA answer honestly to
// readers that don't run JavaScript — social crawlers, AI crawlers, and agents.
//
// dame.is renders entirely on the client: every route is served the same static
// index.html behind a catch-all rewrite. Four things follow from that, and this
// file is where each is answered.
//
//   1. Every path returned HTTP 200, including the ones that don't exist. An
//      agent probing /pricing was told it was a real page. Now a path matching
//      no route shape (og/routes.js) gets a real 404, and a record route whose
//      record doesn't resolve gets one too.
//   2. The HTML on the wire carried seven characters of text. Crawlers got an
//      empty document. Now a server-rendered summary of the page — heading,
//      prose, links — is injected into #root (og/ssrContent.js), displayed
//      only where JavaScript isn't available to replace it.
//   3. Social crawlers saw one generic card for the whole site. The <head> is
//      rewritten per page with a card from /api/og — the original job of this
//      file, unchanged — plus a canonical URL and JSON-LD identity.
//   4. Agents had to parse HTML to read prose. Now any page also serves
//      Markdown to `Accept: text/markdown` (og/markdown.js).
//
// The matcher runs on every SPA path, which the OG rewrite alone did not need.
// Static files and the vercel.json redirects are excluded twice — once in the
// matcher, once by isStaticPath/isRedirectSource below — because a mistake in
// either direction 404s something real.

import { pageMeta, PAGES, SITE, cleanPath, segsFor } from './og/pages.js';
import {
  recordMeta,
  pieceMeta,
  participantMeta,
  participantsMeta,
  RECORD_SECTIONS,
} from './og/records.js';
import { pageContentMeta } from './og/pageContent.js';
import { isKnownRoute, isStaticPath, isRedirectSource } from './og/routes.js';
import { ssrFallbackHtml, injectSsrFallback } from './og/ssrContent.js';
import {
  negotiate,
  pageMarkdown,
  notFoundMarkdown,
  MARKDOWN_TYPE,
  SERVABLE_TYPES,
} from './og/markdown.js';
import { pageJsonLd, jsonLdScript } from './og/jsonld.js';
import { ME_DID, COLLECTIONS, BLOG_PUBLICATION, PORTFOLIO_PUBLICATION } from './src/config.js';

const ORIGIN = 'https://dame.is';

// Every response this file produces is negotiated on Accept, so a shared cache
// must key on it. Without this a CDN that cached the HTML variant first would
// hand that HTML to the next agent asking for Markdown.
const VARY = 'Accept, Accept-Encoding';

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

// Everything except the paths served by a function or straight off the
// filesystem. `index.html` matters most: the HTML branch below fetches it as a
// subrequest, and a subrequest that re-entered this middleware would loop.
// isStaticPath() in og/routes.js is the second net for the same set.
export const config = {
  matcher: [
    '/((?!api/|assets/|data/|_vercel/|\\.well-known/|index\\.html|robots\\.txt|sitemap\\.xml|feed\\.xml|llms\\.txt|version\\.json|oauth-client-metadata\\.json).*)',
  ],
};

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Every consumer below interpolates this value into the REPLACEMENT string
    // of a String.prototype.replace() call (setMeta, the <title> swap, and the
    // inject* head helpers), where `$` is a special sequence ($1, $&, $$, …).
    // Double each `$` so record-derived text like "How I saved $1,000" can't
    // expand into a replacement pattern and corrupt the emitted <head>. In a
    // replacement string `$$` collapses back to a single literal `$`.
    .replace(/\$/g, '$$$$');
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

// Point crawlers at the canonical URL for this view (the verb-form slug the
// middleware matcher serves), so a record reachable at 2–3 live URLs collapses
// to one indexable address. Replaces an existing rel=canonical if the baseline
// ever ships one, else injects before </head>. esc is $-safe (see escapeAttr).
function setCanonical(html, href) {
  const esc = escapeAttr(href);
  const re = /(<link\s+rel="canonical"\s+href=")[^"]*(")/i;
  if (re.test(html)) return html.replace(re, `$1${esc}$2`);
  return html.replace(/<\/head>/i, `    <link rel="canonical" href="${esc}" />\n  </head>`);
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

/** Fetch the built SPA shell, or null if it can't be read.
 *
 * Read fresh (no-store) so a revalidated response always embeds the CURRENT
 * deployment's content-hashed entry asset — never a stale/deleted hash. The
 * `x-og-shell` header marks the subrequest so a middleware invocation that
 * somehow sees it can bail before recursing. */
async function fetchShell(origin) {
  const res = await fetch(new URL('/index.html', origin), {
    headers: { 'x-og-shell': '1' },
    cache: 'no-store',
  });
  return res.ok ? await res.text() : null;
}

/**
 * Build a response, dropping the body for HEAD — which a HEAD response must
 * not carry, and which the branches below would otherwise have attached.
 *
 * KNOWN GAP, and this helper does not close it: Vercel strips `content-type`
 * from an edge-middleware response to a HEAD request. Status, `vary`,
 * `cache-control` and `x-robots-tag` all survive; the content type does not,
 * with or without a body — so `curl -sI -H 'Accept: text/markdown' …`, the
 * header check acceptmarkdown.com documents, shows no markdown type on a URL
 * where GET correctly returns `text/markdown; charset=utf-8`. Static files and
 * /api functions are served by other handlers and keep theirs; only middleware
 * responses lose it, so nothing here can put it back. Routing pages through a
 * serverless function instead would fix the header and cost every page an edge
 * response for a serverless one — the wrong trade for a header on HEAD.
 *
 * What remains true is that a GET is correct, which is what agents actually
 * fetch. This still returns null for HEAD because RFC 9110 §9.3.2 asks a HEAD
 * response to mirror what a GET would send, and if the platform stops
 * rewriting these responses the headers are already right.
 */
function respond(request, body, init) {
  return new Response(request.method === 'HEAD' ? null : body, init);
}

/**
 * 406, per RFC 9110 §15.5.7: the request accepted no representation this site
 * can produce. The body is JSON rather than an HTML error page, because the
 * only clients that reach here are the ones that sent a machine-written Accept
 * header, and they can't parse HTML — it names what IS servable so the caller
 * can retry without guessing.
 */
function notAcceptableResponse(request, path) {
  const body = {
    error: 'not_acceptable',
    message: `No acceptable representation of ${path}. This site serves HTML and Markdown.`,
    available: SERVABLE_TYPES,
    resolution: 'Retry with Accept: text/markdown, Accept: text/html, or Accept: */*.',
  };
  return respond(request, JSON.stringify(body, null, 2) + '\n', {
    status: 406,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      vary: VARY,
      'cache-control': 'public, max-age=0, must-revalidate, s-maxage=60',
    },
  });
}

/**
 * A real HTTP 404 for a path no route answers to.
 *
 * Markdown callers get a short document pointing at the indexes that DO exist.
 * Everyone else gets the app shell with a 404 status — so the SPA still boots
 * and renders its own "Nowhere to be found" page for a person, while the status
 * line tells a crawler the truth. The shell carries a fallback block of its own
 * so an agent reading the HTML gets the same pointers as the Markdown one.
 */
async function notFoundResponse({ request, origin, path, want }) {
  const headers = {
    vary: VARY,
    // Don't let a 404 sit in a shared cache: the usual reason a path 404s here
    // is that a record hasn't been published yet, and publishing it must not
    // require waiting out a CDN entry.
    'cache-control': 'no-store',
    'x-robots-tag': 'noindex',
  };

  if (want === 'markdown') {
    return respond(request, notFoundMarkdown({ origin: ORIGIN, path }), {
      status: 404,
      headers: { ...headers, 'content-type': MARKDOWN_TYPE },
    });
  }

  const shell = await fetchShell(origin);
  if (!shell) return undefined; // can't read the shell — fall through to normal serving

  let html = shell.replace(/<title>[^<]*<\/title>/i, '<title>Not found — dame.is</title>');
  html = setMeta(html, 'name', 'robots', 'noindex');
  html = setMeta(
    html,
    'name',
    'description',
    `No page exists at ${path} on ${SITE.domain}.`,
  );
  html = injectSsrFallback(
    html,
    ssrFallbackHtml({
      path,
      heading: '404 — Not found',
      desc: `No page exists at ${path} on ${SITE.domain}. The links below are the pages that do.`,
    }),
  );
  return respond(request, html, {
    status: 404,
    headers: { ...headers, 'content-type': 'text/html; charset=utf-8' },
  });
}

export default async function middleware(request) {
  try {
    const url = new URL(request.url);
    const path = cleanPath(url.pathname);
    const segs = segsFor(path);

    // Three things this middleware must never judge against the route table:
    // its own shell subrequest, the files served straight off the filesystem,
    // and the legacy paths vercel.json redirects. Each would otherwise 404.
    if (request.headers.get('x-og-shell')) return undefined;
    if (isStaticPath(url.pathname) || isRedirectSource(path)) return undefined;

    // Which representation the caller asked for. `none` means it accepted
    // neither HTML nor Markdown, which is a 406 rather than a guess.
    const want = negotiate(request.headers.get('accept'));
    if (want === 'none') return notAcceptableResponse(request, path);

    // A path whose SHAPE matches no route in the SPA. This is the soft-404 fix:
    // before it, the catch-all rewrite answered 200 with the app shell here, so
    // every path that could be typed appeared to exist.
    if (!isKnownRoute(path))
      return await notFoundResponse({ request, origin: url.origin, path, want });

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
    // Set when a record route's record can't be resolved: the page is a soft
    // 404 (served HTTP 200 by the SPA rewrite), so we noindex it below rather
    // than let crawlers index a section-fallback card as if it were the record.
    let noindex = false;
    // Standard Site refs: the site.standard.document + its publication, for the
    // Bluesky rich embed. `stdDoc` only on article pages; `stdPub` on articles
    // and the publication home pages (/blogging, /creating).
    let stdDoc = null;
    let stdPub = null;
    // The one address this view should be indexed under. Usually the path that
    // was requested; not always — a standard document answers to both its human
    // path and its record key, and only one of them can be canonical.
    let canonicalPath = path;
    // What the JS-less fallback and the Markdown view render. `heading` is the
    // page's <h1> — the <title> without the site suffix a heading doesn't need —
    // and `body` is the record's own prose where a record backs the page.
    let heading;
    let body = '';
    let date = null;
    let isArticle = false;
    // Leaf routes: `/section/:id`, plus the one section whose leaves have
    // leaves of their own — a Ratioed piece, the roster, and one person in it.
    // All of them resolve to a single subject and get the same card /
    // canonical / at:// treatment, so they share this branch and differ only in
    // which resolver answers.
    //
    // Two of the four are derived rather than stored: the roster and a
    // participant are cuts through the piece records, so they carry no at://
    // URI of their own and are marked noindex-free by simply resolving. The
    // roster's path is three segments like a take's, and `participants` is not
    // a take, so it is asked first.
    //
    // A path is only asked to produce a record when its section HAS records to
    // produce — /posting/3abc does, /available/v2 and /exploring/:repo do not.
    // Getting this wrong is not a cosmetic bug now that an unresolved record
    // means 404: every `/{nsid}/:rkey` explorer address, every résumé version
    // and the OAuth callback would answer 404 to a lookup that was never going
    // to succeed. RECORD_SECTIONS is og/records.js's own list, imported rather
    // than restated so the two can't drift. Ratioed's deeper leaves all live
    // under /creating, which is in it.
    const sectionSeg = segs[0];
    const isRecordRoute =
      (segs.length === 2 && RECORD_SECTIONS.has(sectionSeg)) ||
      (segs.length >= 3 && segs.length <= 4 && sectionSeg === 'creating');
    if (isRecordRoute) {
      const sectionPath = `/${sectionSeg}`;
      const section = pageMeta(sectionPath);
      const rec =
        segs.length === 4
          ? await participantMeta(path, url.origin)
          : segs.length === 3
            ? (await participantsMeta(path, url.origin)) || (await pieceMeta(path, url.origin))
            : await recordMeta(path, url.origin);
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
          // A post or status IS its text, so the section names the page and the
          // text is the whole of the body — repeating it under the heading
          // would just print it twice (ssrContent skips a body equal to desc).
          heading = section.title;
        } else {
          title = `${rec.title} — ${SITE.domain}`;
          desc = rec.description || section.desc;
          heading = rec.title;
          body = rec.description || '';
        }
        date = rec.date || null;
        // Only a blog post is an Article; a work, a channel, a track and a moth
        // observation are records of other kinds and stay a plain WebPage.
        isArticle = sectionSeg === 'blogging';
        const params = new URLSearchParams({
          section: sectionSeg,
          label: rec.title,
          subtitle: cardSubtitle,
          nsid: rec.nsid || section.nsid,
        });
        // Stamp the card's day-of-life folio with the record's own date.
        if (rec.date) params.set('date', rec.date);
        if (rec.textOnly) params.set('body', '1');
        // A record whose shape deserves its own card says so, and the generic
        // section/label/subtitle card is skipped for it.
        ogImage = rec.ogQuery
          ? `${ORIGIN}/api/og?${rec.ogQuery}`
          : `${ORIGIN}/api/og?${params.toString()}`;
        atUri = rec.atUri;
        cid = rec.cid;
        if (rec.canonicalPath) canonicalPath = rec.canonicalPath;
        // Only site.standard.document records get the Standard Site embed; a
        // leaflet or arena record on these routes is skipped.
        if (rec.nsid === STANDARD_DOC_NSID) {
          stdDoc = rec.atUri;
          stdPub = rec.publication;
        } else if (rec.publication) {
          // A Ratioed piece is a measurement record, not a standard document,
          // so it has no document ref to declare — but it does belong to a
          // publication, and saying so is what puts the page under that
          // masthead rather than the site's default one.
          stdPub = rec.publication;
        }
      } else {
        // A record route whose record can't be fetched degrades to the
        // section's own card + title, so crawlers never see the generic home
        // card there. It's a soft 404 though (no such record), so mark it
        // noindex — the section card is a graceful fallback for humans, not a
        // page search engines should index under this record URL.
        title = section.title;
        desc = section.desc;
        heading = section.title;
        ogImage = `${ORIGIN}/api/og?page=${encodeURIComponent(sectionPath)}`;
        noindex = true;
      }
    } else {
      // A top-level surface, or a sub-path of one that carries no record of its
      // own: /available/:version, /exploring/:repo/:collection/:rkey, the OAuth
      // callback. A sub-path has no copy of its own, so it borrows its
      // section's card and description rather than dropping to the site-wide
      // default — /available/v2 reads as the résumé, not as the home page.
      const sectionPath = segs.length ? `/${sectionSeg}` : '/';
      const metaPath = PAGES[path] ? path : PAGES[sectionPath] ? sectionPath : path;
      const meta = pageMeta(metaPath);
      title = meta.title;
      desc = meta.desc;
      heading = meta.title;
      // Prefer the live / snapshotted is.dame.page copy over the static default,
      // so editing the record on the PDS updates the crawler description AND the
      // card. Returns null (→ keep the static copy) when no record exists.
      const pageContent = await pageContentMeta(metaPath, url.origin);
      if (pageContent?.desc) desc = pageContent.desc;
      const ogParams = new URLSearchParams({ page: metaPath });
      // Hand the resolved copy to the card generator so it renders the same
      // description without re-fetching (mirrors the record-card path above).
      if (pageContent?.desc) ogParams.set('subtitle', pageContent.desc);
      ogImage = `${ORIGIN}/api/og?${ogParams.toString()}`;
      atUri = topLevelAtUri(path);
      // Publication home pages advertise their publication for the embed.
      stdPub = SECTION_PUBLICATION[path] || null;
    }

    const canonical = `${ORIGIN}${canonicalPath}`;

    // A record route that resolved nothing is a 404, not a 200 with the
    // section's card. `noindex` (below) has always said as much to crawlers
    // that read meta; the status line says it to everything else. The body is
    // unchanged either way, so a person still gets the app and the record page
    // still renders if the record exists and only the edge lookup missed it.
    const status = noindex ? 404 : 200;

    // Markdown variant: the same facts, without the shell. Agents asking for
    // `text/markdown` get prose instead of an HTML document to parse past.
    if (want === 'markdown') {
      return respond(
        request,
        pageMarkdown({ origin: ORIGIN, path, heading, desc, body, atUri, date, canonical }),
        {
          status,
          headers: {
            'content-type': MARKDOWN_TYPE,
            vary: VARY,
            'cache-control': noindex
              ? 'no-store'
              : 'public, max-age=0, must-revalidate, s-maxage=60',
          },
        },
      );
    }

    // Pull the built SPA shell. The matcher excludes /index.html and the
    // x-og-shell guard above catches it a second time, so this subrequest can't
    // loop back through the middleware.
    const shell = await fetchShell(url.origin);
    if (!shell) return undefined; // fall through to normal serving
    let html = shell;

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

    // Advertise the canonical URL for every route we serve, so the same record
    // reachable at multiple live URLs collapses to one address. This used to be
    // the requested path, which meant it collapsed nothing: /creating/<rkey>
    // declared itself canonical alongside /creating/<path>, so every work with
    // a human slug was indexable twice and renaming one split its history in
    // two. The record now names its own address (recordMeta.canonicalPath).
    html = setCanonical(html, canonical);

    // The record route resolved no record. The 404 status above is the primary
    // signal; noindex is kept alongside it because the body still renders the
    // section as a graceful fallback for a person, and that fallback shouldn't
    // be indexed under a record URL that doesn't exist.
    if (noindex) html = setMeta(html, 'name', 'robots', 'noindex');

    // Record/leaf pages (and the top-level surfaces) advertise their canonical
    // at:// URI so AT-aware crawlers can find the backing record.
    if (atUri) html = injectAtprotoHead(html, atUri, cid);

    // Standard Site link tags → Bluesky renders the rich publication embed.
    if (stdDoc || stdPub) html = injectStandardSiteHead(html, { document: stdDoc, publication: stdPub });

    // schema.org identity, so an agent resolving "who is dame.is" gets one
    // answer — a Person, the WebSite they publish, and this page — rather than
    // having to infer it from the prose.
    html = html.replace(
      /<\/head>/i,
      () =>
        `    ${jsonLdScript(
          pageJsonLd({ canonical, title, desc, heading, isArticle, date, image: ogImage }),
        )}\n  </head>`,
    );

    // The page's content, for readers that never run the app. Hidden wherever
    // JavaScript is available (see og/ssrContent.js), so nothing about the
    // rendered site changes.
    html = injectSsrFallback(html, ssrFallbackHtml({ path, heading, desc, body, atUri, date }));

    return respond(request, html, {
      status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        vary: VARY,
        // Edge-cache the rendered shell briefly to keep middleware cost down —
        // but NEVER serve it stale. The shell embeds the build's content-hashed
        // entry asset (/assets/index-<hash>.js), and every deploy rotates that
        // hash and deletes the old file. A shell cached across a deploy points
        // at a now-404 asset that Vercel serves as text/plain, which the
        // browser refuses to run as a module — blanking the page. So: a short
        // s-maxage that revalidates promptly onto the new build, NO
        // stale-while-revalidate (its 24h stale-serve was the crash window),
        // and must-revalidate so no cache — browser, webview, or intermediary —
        // may ever serve this shell stale. The inline boot-recovery in
        // index.html covers the brief post-deploy sliver where a still-fresh
        // shell can be served, and /api/asset-recovery rescues any stale shell
        // that slips through from a cache we don't control.
        //
        // A 404 is never cached at all: the usual reason a record route 404s is
        // that the record hasn't been published yet (or a PDS lookup blipped),
        // and neither should take a minute to clear.
        'cache-control': noindex
          ? 'no-store'
          : 'public, max-age=0, must-revalidate, s-maxage=60',
      },
    });
  } catch {
    return undefined; // never block the page on a meta-injection hiccup
  }
}
