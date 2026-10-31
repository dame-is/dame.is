// What a link in an essay says about where it goes.
//
// Every link in a document can show a card on hover (LinkPreview.jsx): the
// post a Bluesky link points at, an article's headline and byline, a Wikipedia
// summary, a site's own description. The links are looked up once, at build
// time (scripts/prefetch.mjs), and for a document newer than the build by
// api/link-previews.js; both go through api/_lib/linkPreviews.js, which does
// the fetching. This module is the pure half they share with the browser:
// which links a document holds, what kind of place each one is, how a page's
// <head> reads, and the one shape a preview is stored in.
//
// A preview, as stored (every field but `kind`, `host` and `path` optional):
//
//   kind     'post' | 'profile' | 'wikipedia' | 'x-post' | 'video'
//            | 'document' | 'article' | 'website' | 'internal'
//   host     'techcrunch.com', the eyebrow
//   path     'techcrunch.com/2026/03/30/…', the address the card's foot shows
//   land     where the link really ends up when it redirects somewhere else:
//            'x.com' when only the host changed, the whole short path if not
//   icon     a key into the file's `icons` map (the site's favicon)
//   title, desc, site, author, platform ('Leaflet')
//   when     ISO date, or 'YYYY-MM' when only the month is known
//   image    the share image, served from dame.is
//   name, handle, avatar, text, counts, ext   a post (Bluesky or X)
//   banner, bio, followers, posts             a Bluesky profile
//   section, extract, thumb                   a Wikipedia page
//   local    a link that stays on the site and opens in the same tab

import { isSubscribeLink } from './newsletter.js';

export const LINK_FACET = 'pub.leaflet.richtext.facet#link';

/** The site's own host. A link to it is `internal`, wherever it points. */
export const SITE_HOST = 'dame.is';

/** The most links one document is looked up for. */
export const MAX_DOCUMENT_LINKS = 120;

/**
 * Every http(s) link in a document's facets, once each, in reading order.
 * Walks the whole value, so it finds links in paragraphs, headings, quotes and
 * nested list items alike, whatever block holds them.
 */
export function documentLinks(content) {
  const seen = new Set();
  const walk = (node) => {
    if (seen.size >= MAX_DOCUMENT_LINKS) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    if (node.$type === LINK_FACET && typeof node.uri === 'string' && /^https?:\/\//i.test(node.uri)) {
      seen.add(node.uri);
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') walk(value);
    }
  };
  walk(content);
  return [...seen];
}

/**
 * Where a document's previews live under /data: `link-previews/<collection>/<rkey>`,
 * the name `fetchSnapshot` takes. Null for anything that isn't a record URI.
 */
export function linkPreviewsName(atUri) {
  const m = String(atUri || '').match(/^at:\/\/[^/]+\/([a-z0-9.-]+)\/([A-Za-z0-9._:~-]+)$/i);
  return m ? `link-previews/${m[1]}/${m[2]}` : null;
}

/** 'techcrunch.com' from a URL, without its www. Empty for a bad URL. */
export function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * The address as a card's foot shows it: host and path, no scheme, no
 * trailing slash, with the escapes a reader would type back in decoded.
 */
export function shortPath(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '');
    try {
      path = decodeURI(path);
    } catch {
      /* keep it escaped */
    }
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${path}${u.search}${u.hash}`;
  } catch {
    return String(url || '');
  }
}

/**
 * Where a link ends up, when that isn't where it says: '' when it lands where
 * it points, the new host alone when only the host changed (twitter.com to
 * x.com), and the whole short path otherwise (attie.ai to attie.ai/login).
 */
export function landingOf(url, finalUrl) {
  if (!finalUrl) return '';
  const strip = (s) => shortPath(s).replace(/[?#].*$/, '').replace(/\/+$/, '');
  const from = strip(url);
  const to = strip(finalUrl);
  if (!to || from === to) return '';
  const [fromHost, ...fromRest] = from.split('/');
  const [toHost, ...toRest] = to.split('/');
  if (fromHost !== toHost && fromRest.join('/') === toRest.join('/')) return toHost;
  return to;
}

/**
 * What kind of place a URL is, by its address alone — the kinds that have an
 * API of their own to ask, and `web` for everything read from its <head>.
 */
export function classifyLink(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return { type: 'invalid' };
  }
  if (!/^https?:$/.test(u.protocol)) return { type: 'invalid' };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname;

  if (host === 'bsky.app') {
    const post = path.match(/^\/profile\/([^/]+)\/post\/([^/]+)\/?$/);
    if (post) return { type: 'post', actor: decodeURIComponent(post[1]), rkey: post[2] };
    const profile = path.match(/^\/profile\/([^/]+)\/?$/);
    if (profile) return { type: 'profile', actor: decodeURIComponent(profile[1]) };
  }

  const wiki = host.match(/^([a-z][a-z-]*)\.(?:m\.)?wikipedia\.org$/);
  if (wiki && path.startsWith('/wiki/') && path.length > 6) {
    let title = path.slice(6);
    try {
      title = decodeURIComponent(title);
    } catch {
      /* an undecodable title is passed on as written */
    }
    let section = '';
    if (u.hash.length > 1) {
      try {
        section = decodeURIComponent(u.hash.slice(1)).replace(/_/g, ' ');
      } catch {
        section = u.hash.slice(1).replace(/_/g, ' ');
      }
    }
    return { type: 'wikipedia', lang: wiki[1], title, section };
  }

  if (/^(?:mobile\.)?(?:twitter|x)\.com$/.test(host)) {
    const status = path.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/);
    if (status) return { type: 'x-post', user: status[1], id: status[2] };
  }

  if (
    (/^(?:m\.|music\.)?youtube\.com$/.test(host) &&
      ((path === '/watch' && u.searchParams.get('v')) || /^\/(?:shorts|live)\/[^/]+/.test(path))) ||
    (host === 'youtu.be' && path.length > 1)
  ) {
    return { type: 'video', provider: 'youtube' };
  }
  if (host === 'vimeo.com' && /^\/(?:video\/)?\d+/.test(path)) {
    return { type: 'video', provider: 'vimeo' };
  }

  if (host === SITE_HOST) {
    return { type: 'internal', local: isSubscribeLink(url) };
  }

  return { type: 'web' };
}

/* ------------------------------------------------------------------ */
/* Reading a page's <head>                                              */
/* ------------------------------------------------------------------ */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** HTML entities, named (the common ones) and numeric, decoded. */
export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? whole;
  });
}

const ATTR = /([^\s=/>"']+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/** A tag's attributes, names lowercased: `<meta property="og:title" …>` → { property, content }. */
function attributesOf(tag) {
  const out = {};
  const body = tag.replace(/^<[a-z]+/i, '').replace(/\/?>$/, '');
  for (const m of body.matchAll(ATTR)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

function absolute(href, base) {
  if (!href) return '';
  try {
    const u = new URL(href, base);
    return /^https?:$/.test(u.protocol) ? u.href : '';
  } catch {
    return '';
  }
}

/**
 * What a page's <head> says about it: its title, description, share image,
 * site name, publication date, author, type, icons, and the standard.site
 * document it declares, if any. Reads only up to </head> when there is one.
 */
export function parseHeadMeta(html, baseUrl) {
  const source = String(html || '');
  const end = source.search(/<\/head\s*>/i);
  const head = end > 0 ? source.slice(0, end) : source;

  const meta = new Map();
  let refresh = '';
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const a = attributesOf(tag);
    if ((a['http-equiv'] || '').toLowerCase() === 'refresh') {
      const to = (a.content || '').match(/url\s*=\s*['"]?([^'"\s]+)/i);
      if (to && !refresh) refresh = absolute(to[1], baseUrl);
      continue;
    }
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    const content = (a.content || '').trim();
    if (key && content && !meta.has(key)) meta.set(key, content);
  }
  const first = (...keys) => {
    for (const k of keys) if (meta.get(k)) return meta.get(k);
    return '';
  };

  const icons = [];
  let documentUri = '';
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const a = attributesOf(tag);
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    if (rel.includes('site.standard.document') && /^at:\/\//.test(a.href || '')) {
      documentUri = documentUri || a.href;
      continue;
    }
    if (rel.includes('mask-icon')) continue;
    if (rel.includes('icon') || rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) {
      const href = absolute(a.href, baseUrl);
      if (href) {
        icons.push({
          href,
          type: (a.type || '').toLowerCase(),
          sizes: (a.sizes || '').toLowerCase(),
          touch: !rel.includes('icon'),
        });
      }
    }
  }

  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const author = first('author', 'article:author', 'parsely-author', 'sailthru.author');

  return {
    title: collapse(first('og:title', 'twitter:title') || (titleTag ? decodeEntities(titleTag[1]) : '')),
    description: collapse(first('og:description', 'twitter:description', 'description')),
    image: absolute(first('og:image:secure_url', 'og:image', 'og:image:url', 'twitter:image', 'twitter:image:src'), baseUrl),
    siteName: collapse(first('og:site_name', 'application-name', 'apple-mobile-web-app-title')),
    published: first('article:published_time', 'og:article:published_time', 'datepublished', 'date', 'pubdate'),
    // An article:author is often a link to the author's page, which reads as nothing.
    author: /^https?:\/\//i.test(author) ? '' : collapse(author),
    type: first('og:type').toLowerCase(),
    icons,
    documentUri,
    // A page that only forwards (<meta http-equiv="refresh">) to another.
    refresh,
  };
}

const collapse = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * The icons worth trying for a site, best first, ending with its /favicon.ico.
 * `small` is for a caller that can't shrink an image (the live endpoint): it
 * leads with the smallest declared raster, since whatever it picks is sent
 * as it is. Otherwise a larger source shrinks to a sharper 32px.
 */
export function iconCandidates(icons, pageUrl, { small = false } = {}) {
  const sizeOf = (icon) => {
    if (icon.sizes === 'any') return 512;
    const m = icon.sizes.match(/(\d+)x(\d+)/);
    if (m) return Number(m[1]);
    if (icon.touch) return 180;
    return 0;
  };
  const isSvg = (icon) => icon.type.includes('svg') || /\.svg(\?|$)/i.test(icon.href);
  const isIco = (icon) => icon.type.includes('icon') || /\.ico(\?|$)/i.test(icon.href);
  const score = (icon) => {
    const size = sizeOf(icon);
    if (small) {
      if (isSvg(icon)) return 40;
      if (!size) return 30;
      return 1000 - Math.abs(size - 32);
    }
    if (isSvg(icon)) return 900;
    // An .ico shrinks no better than the PNG beside it, and often worse.
    if (isIco(icon)) return 300 + Math.min(size, 64);
    if (!size) return 100;
    // Closest to 64 from above shrinks best; anything far bigger is a waste.
    return size >= 32 ? 1000 - Math.abs(size - 64) : 500 + size;
  };
  const ranked = [...(icons || [])].sort((a, b) => score(b) - score(a)).map((i) => i.href);
  const fallback = absolute('/favicon.ico', pageUrl);
  if (fallback) ranked.push(fallback);
  return [...new Set(ranked)];
}

/**
 * A page title with the site's own name trimmed off either end, since the
 * card already names the site: 'Flipboard acquires Graze | TechCrunch' and
 * 'Daring Fireball: Markdown' lose 'TechCrunch' and 'Daring Fireball'. Names
 * compare loosely ('Daring Fireball' is daringfireball.net). A title that is
 * nothing but the name is kept.
 */
export function cleanTitle(title, siteName, host) {
  let t = collapse(title);
  const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const bare = String(host || '').replace(/^www\./, '');
  const names = new Set(
    [siteName, bare, bare.replace(/\.[a-z]+$/, ''), bare.split('.')[0]].map(loose).filter((n) => n.length > 1),
  );
  for (const sep of [' | ', ' - ', ' – ', ' — ', ' · ', ' :: ', ' • ']) {
    const at = t.lastIndexOf(sep);
    if (at > 0 && names.has(loose(t.slice(at + sep.length)))) {
      t = t.slice(0, at).trim();
      break;
    }
  }
  const lead = t.match(/^([^:|]{2,40}):\s+(.+)$/);
  if (lead && names.has(loose(lead[1]))) t = lead[2].trim();
  return t;
}

/** A publication date from a URL path, '/2026/10/…' → '2026-10'. */
export function monthFromPath(url) {
  try {
    const m = new URL(url).pathname.match(/\/(20\d\d|19\d\d)\/(0[1-9]|1[0-2])\//);
    return m ? `${m[1]}-${m[2]}` : '';
  } catch {
    return '';
  }
}

/** A text cut to whole sentences, at most `max` characters where it can be. */
export function sentencesUpTo(text, max = 360) {
  const s = collapse(text);
  if (s.length <= max) return s;
  const parts = s.match(/[^.!?]+[.!?]+["”’)]?(\s|$)/g) || [];
  let out = '';
  for (const p of parts) {
    if ((out + p).length > max) break;
    out += p;
  }
  return (out || `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`).trim();
}

/* ------------------------------------------------------------------ */
/* Shaping what each kind of source answers                             */
/* ------------------------------------------------------------------ */

const isoOrEmpty = (value) => {
  if (!value) return '';
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : '';
};

/** The fields every preview carries, from the URL it was made for. */
function base(url, kind) {
  return { kind, host: hostOf(url), path: shortPath(url) };
}

/** Drop the empty fields, so a stored preview carries only what it says. */
export function compact(preview) {
  const out = {};
  for (const [k, v] of Object.entries(preview)) {
    if (v === '' || v == null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

// Bluesky's pictures are drawn from its CDN, as they are everywhere else on
// the site, rather than copied; anything else in their place is dropped.
const blueskyImage = (src) => (typeof src === 'string' && src.startsWith('https://cdn.bsky.app/') ? src : '');

/** A Bluesky post, from an AppView post view. */
export function previewFromPostView(post, url) {
  if (!post?.author) return null;
  const embed = post.embed || {};
  const media = embed.media || embed;
  const images = Array.isArray(media.images) ? media.images : [];
  const external = media.external || embed.external || null;
  return compact({
    ...base(url, 'post'),
    name: post.author.displayName || post.author.handle,
    handle: post.author.handle,
    avatar: blueskyImage(post.author.avatar),
    text: post.record?.text || '',
    when: isoOrEmpty(post.record?.createdAt || post.indexedAt),
    counts: {
      likes: post.likeCount || 0,
      reposts: post.repostCount || 0,
      replies: post.replyCount || 0,
      quotes: post.quoteCount || 0,
    },
    image: images[0]?.thumb || '',
    ext: external?.uri
      ? compact({ title: collapse(external.title), host: hostOf(external.uri), thumb: blueskyImage(external.thumb) })
      : null,
  });
}

/** A Bluesky profile, from app.bsky.actor.getProfile. */
export function previewFromProfile(profile, url) {
  if (!profile?.handle) return null;
  return compact({
    ...base(url, 'profile'),
    name: profile.displayName || profile.handle,
    handle: profile.handle,
    avatar: blueskyImage(profile.avatar),
    banner: blueskyImage(profile.banner),
    // A bio's blank lines are paragraph breaks there, and a gap in a card.
    bio: String(profile.description || '').replace(/\n{2,}/g, '\n').trim(),
    followers: Number.isFinite(profile.followersCount) ? profile.followersCount : null,
    posts: Number.isFinite(profile.postsCount) ? profile.postsCount : null,
  });
}

/** A Wikipedia page, from the REST page summary. */
export function previewFromWikiSummary(summary, url, { section = '' } = {}) {
  if (!summary?.title || (summary.type === 'disambiguation' && !summary.extract)) return null;
  return compact({
    ...base(url, 'wikipedia'),
    title: summary.title,
    desc: summary.description || '',
    extract: sentencesUpTo(summary.extract, 360),
    thumb: summary.thumbnail?.source || '',
    section,
  });
}

/** A video, from its host's oEmbed (YouTube's, Vimeo's). */
export function previewFromVideoOembed(oembed, url) {
  if (!oembed?.title) return null;
  return compact({
    ...base(url, 'video'),
    title: collapse(oembed.title),
    author: collapse(oembed.author_name),
    site: collapse(oembed.provider_name),
    image: oembed.thumbnail_url || '',
  });
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A post on X, from publish.twitter.com's oEmbed. */
export function previewFromOembed(oembed, url) {
  if (!oembed?.html) return null;
  const html = String(oembed.html);
  const body = (html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
  const text = decodeEntities(body.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
  const date = html.match(/>\s*([A-Z][a-z]+) (\d{1,2}), (\d{4})\s*<\/a>/);
  let when = '';
  if (date) {
    const m = MONTHS.indexOf(date[1].toLowerCase());
    if (m >= 0) when = `${date[3]}-${String(m + 1).padStart(2, '0')}-${date[2].padStart(2, '0')}`;
  }
  const handle = String(oembed.author_url || '').split('/').filter(Boolean).pop() || '';
  return compact({
    ...base(url, 'x-post'),
    name: oembed.author_name || handle,
    handle,
    text,
    when,
    land: landingOf(url, oembed.url),
  });
}

/**
 * Any other page, from its <head> (and, for a standard.site document, from
 * the record it declares). `finalUrl` is where the fetch landed after its
 * redirects; `record` and `publication` are the document's own records when
 * they could be read.
 */
export function previewFromPage(meta, url, { finalUrl = '', record = null, publication = null, internal = false } = {}) {
  if (!meta) return null;
  const host = hostOf(url);
  const doc = record?.value || null;
  const site = collapse(publication?.value?.name || meta.siteName);
  const title = collapse(doc?.title) || cleanTitle(meta.title, meta.siteName, host);
  if (!title && !meta.description) return null;
  const isDocument = Boolean(meta.documentUri);
  const when = isoOrEmpty(doc?.publishedAt || meta.published) || monthFromPath(url);
  const article =
    isDocument ||
    meta.type === 'article' ||
    Boolean(when) ||
    /\/(blog|posts?|news|articles?|essays?)\/./i.test(new URL(url).pathname);
  const kind = internal ? 'internal' : isDocument ? 'document' : article ? 'article' : 'website';
  return compact({
    ...base(url, kind),
    title,
    desc: collapse(doc?.description) || meta.description,
    // A website's name is its title; a page on this site's is the host.
    site: kind === 'website' || kind === 'internal' ? '' : site,
    platform: isDocument && /(^|\.)leaflet\.pub$/.test(host) ? 'Leaflet' : '',
    author: meta.author,
    when: kind === 'website' ? '' : when,
    image: meta.image,
    land: landingOf(url, finalUrl),
  });
}

/* ------------------------------------------------------------------ */
/* What a card says                                                     */
/* ------------------------------------------------------------------ */

const KIND_LABELS = {
  post: 'Bluesky post',
  profile: 'Bluesky profile',
  wikipedia: 'Wikipedia',
  'x-post': 'Post on X',
  video: 'Video',
  document: 'Article',
  article: 'Article',
  website: 'Website',
  internal: 'On this site',
};

/** The kind of place, as the card's eyebrow names it: 'Article', 'Leaflet'. */
export function previewLabel(preview) {
  if (preview?.kind === 'document' && preview.platform) return preview.platform;
  return KIND_LABELS[preview?.kind] || 'Link';
}

const MONTH_NAMES = MONTHS.map((m) => m[0].toUpperCase() + m.slice(1));

/** 'October 2026' for a month the address gave; otherwise null, for the caller's own date format. */
export function monthLabel(when) {
  const m = String(when || '').match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : null;
}

const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A post's tallies or a profile's, as the card's last line lists them; the zeros left out. */
export function previewCounts(preview) {
  if (preview?.kind === 'profile') {
    return [
      Number.isFinite(preview.followers) ? plural(preview.followers, 'follower', 'followers') : '',
      Number.isFinite(preview.posts) ? plural(preview.posts, 'post', 'posts') : '',
    ].filter(Boolean);
  }
  const c = preview?.counts || {};
  return [
    c.likes ? plural(c.likes, 'like', 'likes') : '',
    c.reposts ? plural(c.reposts, 'repost', 'reposts') : '',
    c.replies ? plural(c.replies, 'reply', 'replies') : '',
    c.quotes ? plural(c.quotes, 'quote', 'quotes') : '',
  ].filter(Boolean);
}

/**
 * A link's words cut before the part its icon stays with: the last word, or
 * for a long one (a bare URL) its last few characters, so the icon can never
 * be left alone at the start of a line and a long address still wraps.
 */
export function splitLinkEnd(text, longest = 16) {
  const s = String(text ?? '');
  const space = s.search(/\s\S*$/);
  const tail = space >= 0 ? s.slice(space + 1) : s;
  const chars = [...tail];
  if (chars.length <= longest) return [s.slice(0, s.length - tail.length), tail];
  const end = chars.slice(-6).join('');
  return [s.slice(0, s.length - end.length), end];
}
