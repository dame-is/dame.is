// The fetching half of the link previews (src/lib/linkPreviews.js is the pure
// half). Given the links in a document, ask each place about itself in the way
// it answers best and shape the answers into previews:
//
//   bsky.app posts and profiles   the public AppView
//   Wikipedia                     the REST page summary, made for previews
//   posts on X                    publish.twitter.com's oEmbed, keyless
//   YouTube and Vimeo videos      their own oEmbed
//   everything else               the page's own <head>, and for a
//                                 standard.site document the record it names
//
// Two callers. The build (scripts/prefetch.mjs) looks up every document's
// links and keeps the pictures on dame.is, shrunk with sharp. The live
// endpoint (api/link-previews.js) does the same for a document published since
// the last build, and can't shrink anything, so it sends pictures through the
// image proxy and keeps only small icons. That difference is the `media`
// adapter each passes in; everything else is shared.
//
// Pages are fetched through the SSRF guard with every redirect re-checked,
// exactly as api/unfurl.js does: a link in a document is still a URL from
// outside, and the live endpoint runs on a server.

import { createHash } from 'node:crypto';
import { assertPublicHttpUrl } from './ssrfGuard.js';
import { APPVIEW } from '../../src/config.js';
import { SUBSCRIBE_URL } from '../../src/lib/newsletter.js';
import {
  classifyLink,
  compact,
  hostOf,
  iconCandidates,
  parseHeadMeta,
  previewFromOembed,
  previewFromPage,
  previewFromPostView,
  previewFromProfile,
  previewFromVideoOembed,
  previewFromWikiSummary,
  shortPath,
  SITE_HOST,
} from '../../src/lib/linkPreviews.js';

export const USER_AGENT = 'Mozilla/5.0 (compatible; dame.is link previews; +https://dame.is)';
const HEAD_LIMIT = 512 * 1024;
const MAX_REDIRECTS = 4;
const SLINGSHOT = 'https://slingshot.microcosm.blue';

/** The site's own icon, the hourly sky tile (api/favicon.js), for links to dame.is. */
export const SITE_ICON = '/api/favicon';

// The sites answered through an API are never fetched as pages, so their
// icons are named here rather than found in a <head>.
const KNOWN_ICONS = {
  post: ['https://bsky.app/static/favicon-32x32.png', 'https://bsky.app/favicon.ico'],
  profile: ['https://bsky.app/static/favicon-32x32.png', 'https://bsky.app/favicon.ico'],
  'x-post': ['https://abs.twimg.com/favicons/twitter.3.ico', 'https://x.com/favicon.ico'],
  youtube: ['https://www.youtube.com/s/desktop/favicon.ico', 'https://www.youtube.com/favicon.ico'],
  vimeo: ['https://vimeo.com/favicon.ico'],
};
const OEMBED = {
  youtube: 'https://www.youtube.com/oembed',
  vimeo: 'https://vimeo.com/api/oembed.json',
};
const wikipediaIcons = (lang) => [
  `https://${lang}.wikipedia.org/static/favicon/wikipedia.ico`,
  'https://en.wikipedia.org/static/favicon/wikipedia.ico',
];

/**
 * Fetch a URL from outside, following redirects by hand so each hop passes
 * the SSRF guard. Resolves to the final response and the URL it came from.
 */
export async function fetchGuarded(url, { signal, accept = '*/*' } = {}) {
  let current = await assertPublicHttpUrl(url);
  for (let hops = 0; ; hops += 1) {
    const response = await fetch(current.href, {
      headers: { 'user-agent': USER_AGENT, accept },
      redirect: 'manual',
      signal,
    });
    const location =
      response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) return { response, finalUrl: current.href };
    response.body?.cancel?.().catch(() => {});
    if (hops >= MAX_REDIRECTS) throw new Error('Too many redirects');
    current = await assertPublicHttpUrl(new URL(location, current.href).href);
  }
}

/** Up to `limit` bytes of a body, or null when it runs past them. */
export async function readCapped(response, limit) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > limit ? null : buf;
  }
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** A page's markup as far as its </head>, which is all a preview reads. */
async function readHead(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return (await response.text()).slice(0, HEAD_LIMIT);
  const decoder = new TextDecoder();
  let html = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
    if (html.length >= HEAD_LIMIT || /<\/head\s*>/i.test(html)) break;
  }
  reader.cancel().catch(() => {});
  return html;
}

async function getJson(url, signal, headers = {}) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers }, signal });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** A record by at:// URI, through Slingshot's cache. Null when it can't be read. */
async function getRecordByUri(atUri, signal) {
  const m = String(atUri || '').match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)$/);
  if (!m) return null;
  const params = new URLSearchParams({ repo: m[1], collection: m[2], rkey: m[3] });
  try {
    return await getJson(`${SLINGSHOT}/xrpc/com.atproto.repo.getRecord?${params}`, signal);
  } catch {
    return null;
  }
}

/** A page's <head>, and where the fetch ended up. */
async function fetchHead(target, signal) {
  const { response, finalUrl } = await fetchGuarded(target, {
    signal,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
  });
  if (!response.ok) {
    response.body?.cancel?.().catch(() => {});
    throw new Error(`Upstream ${response.status}`);
  }
  const type = String(response.headers.get('content-type') || '');
  if (type && !/html|xml/i.test(type)) {
    response.body?.cancel?.().catch(() => {});
    throw new Error(`Not a page (${type})`);
  }
  return { meta: parseHeadMeta(await readHead(response), finalUrl), finalUrl };
}

/** The page behind a link, read from its <head>. */
async function resolvePage(url, { signal, internal, local }) {
  // The newsletter link is '/blogging#subscribe' as often as not; the
  // newsletter's own page is what it opens, and what describes it.
  let { meta, finalUrl } = await fetchHead(local ? SUBSCRIBE_URL : url, signal);
  // A page with nothing to say but where it moved (a meta refresh, as moved
  // docs sites leave behind) is followed there, once.
  if (meta.refresh && !meta.title && !meta.description) {
    ({ meta, finalUrl } = await fetchHead(meta.refresh, signal));
  }
  let record = null;
  let publication = null;
  if (meta.documentUri && !internal) {
    record = await getRecordByUri(meta.documentUri, signal);
    const site = record?.value?.site;
    if (typeof site === 'string' && site.startsWith('at://')) {
      publication = await getRecordByUri(site, signal);
    }
  }
  const preview = previewFromPage(meta, url, {
    finalUrl: local ? '' : finalUrl,
    record,
    publication,
    internal,
  });
  if (preview && local) {
    preview.path = shortPath(SUBSCRIBE_URL);
    preview.local = true;
  }
  return {
    preview,
    icons: internal ? [] : iconCandidates(meta.icons, finalUrl),
    smallIcons: internal ? [] : iconCandidates(meta.icons, finalUrl, { small: true }),
  };
}

/**
 * One link's preview, its icon candidates and the pictures still to fetch.
 * Throws when the place can't be read at all.
 */
export async function lookUpLink(url, { signal } = {}) {
  const kind = classifyLink(url);
  switch (kind.type) {
    case 'post': {
      const atUri = `at://${kind.actor}/app.bsky.feed.post/${kind.rkey}`;
      const params = new URLSearchParams({ uri: atUri, depth: '0', parentHeight: '0' });
      const json = await getJson(`${APPVIEW}/xrpc/app.bsky.feed.getPostThread?${params}`, signal);
      return { preview: previewFromPostView(json?.thread?.post, url), icons: KNOWN_ICONS.post };
    }
    case 'profile': {
      const params = new URLSearchParams({ actor: kind.actor });
      const json = await getJson(`${APPVIEW}/xrpc/app.bsky.actor.getProfile?${params}`, signal);
      return { preview: previewFromProfile(json, url), icons: KNOWN_ICONS.profile };
    }
    case 'wikipedia': {
      const title = encodeURIComponent(kind.title.replace(/ /g, '_'));
      const json = await getJson(
        `https://${kind.lang}.wikipedia.org/api/rest_v1/page/summary/${title}?redirect=true`,
        signal,
      );
      return {
        preview: previewFromWikiSummary(json, url, { section: kind.section }),
        icons: wikipediaIcons(kind.lang),
      };
    }
    case 'x-post': {
      const params = new URLSearchParams({ url, omit_script: '1', dnt: 'true' });
      const json = await getJson(`https://publish.twitter.com/oembed?${params}`, signal);
      return { preview: previewFromOembed(json, url), icons: KNOWN_ICONS['x-post'] };
    }
    case 'video': {
      const params = new URLSearchParams({ url, format: 'json' });
      const json = await getJson(`${OEMBED[kind.provider]}?${params}`, signal);
      return { preview: previewFromVideoOembed(json, url), icons: KNOWN_ICONS[kind.provider] };
    }
    case 'internal':
      return resolvePage(url, { signal, internal: true, local: kind.local });
    case 'web':
      return resolvePage(url, { signal, internal: false, local: false });
    default:
      return { preview: null, icons: [] };
  }
}

/**
 * Previews for a list of links: `{ previews, icons, failed }`, where
 * `previews` is keyed by the link exactly as written, `icons` by the key each
 * preview's `icon` names (its host), and `failed` lists the links that
 * couldn't be read, so a reader's browser doesn't ask for them again.
 *
 * `media` decides where the pictures come from:
 *   image(src, { width, height, fit })  → a URL to show, or ''
 *   icon(candidates)                    → a data: URI or path, or ''
 *   small                               → true when it can't shrink an icon,
 *                                         so the smallest are tried first
 * Bluesky's own images stay on its CDN, as everywhere else on the site.
 *
 * Bounded twice: `perLinkMs` for any one link, and `deadlineMs` for the lot,
 * after which whatever hasn't answered counts as failed.
 */
export async function resolveLinks(
  urls,
  { media, concurrency = 6, perLinkMs = 6000, deadlineMs = 60_000, log = () => {} } = {},
) {
  const previews = {};
  const icons = {};
  const failed = [];
  const iconByHost = new Map(); // host -> Promise<string>
  const deadline = AbortSignal.timeout(deadlineMs);
  const queue = [...new Set(urls)];

  const iconFor = (host, candidates) => {
    if (!iconByHost.has(host)) {
      iconByHost.set(
        host,
        host === SITE_HOST ? Promise.resolve(SITE_ICON) : media.icon(candidates).catch(() => ''),
      );
    }
    return iconByHost.get(host);
  };

  const one = async (url) => {
    const signal = AbortSignal.any([deadline, AbortSignal.timeout(perLinkMs)]);
    try {
      const found = await whileOpen(lookUpLink(url, { signal }), signal);
      const preview = found?.preview;
      if (!preview) throw new Error('nothing to say');
      const host = preview.host || hostOf(url);
      const [icon, image, thumb] = await whileOpen(Promise.all([
        iconFor(host, (media.small && found.smallIcons) || found.icons || []),
        preview.image && !onBlueskyCdn(preview.image)
          ? media.image(preview.image, { width: 640, height: 336, fit: 'cover' }).catch(() => '')
          : preview.image || '',
        preview.thumb
          ? media.image(preview.thumb, { width: 192, height: 192, fit: 'inside' }).catch(() => '')
          : '',
      ]), deadline);
      if (icon) {
        icons[host] = icon;
        preview.icon = host;
      }
      previews[url] = compact({ ...preview, image, thumb });
    } catch (err) {
      failed.push(url);
      log(`link preview: ${url} — ${err?.name === 'TimeoutError' ? 'timed out' : err?.message || err}`);
    }
  };

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) await one(queue.shift());
  });
  await Promise.all(workers);
  return { previews, icons, failed };
}

/**
 * `promise`, or a rejection the moment `signal` aborts, whichever comes
 * first. The signal is passed to every fetch as well; this is what holds the
 * bound when something under it doesn't listen.
 */
function whileOpen(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop));
  });
}

const onBlueskyCdn = (src) => /^https:\/\/cdn\.bsky\.app\//.test(src);

/** A short, stable name for a picture, from where it came from. */
export function mediaKey(src) {
  return createHash('sha256').update(String(src)).digest('hex').slice(0, 20);
}

/* ------------------------------------------------------------------ */
/* Icons                                                                */
/* ------------------------------------------------------------------ */

/**
 * The PNG inside a .ico, nearest 32px, when it carries one (most made since
 * Vista do). Null for an icon of bitmaps only, or for anything that isn't an
 * .ico. Lets a caller that can't decode .ico still show the picture.
 */
export function icoPngEntry(buf) {
  if (!buf || buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16;
    if (at + 16 > buf.length) break;
    const width = buf[at] || 256;
    const size = buf.readUInt32LE(at + 8);
    const offset = buf.readUInt32LE(at + 12);
    if (offset + size > buf.length || size < 8) continue;
    const isPng = buf[offset] === 0x89 && buf.toString('latin1', offset + 1, offset + 4) === 'PNG';
    if (!isPng) continue;
    const distance = Math.abs(width - 32) + (width < 32 ? 64 : 0);
    if (!best || distance < best.distance) best = { distance, offset, size };
  }
  return best ? buf.subarray(best.offset, best.offset + best.size) : null;
}

/**
 * The bitmap inside a .ico nearest 32px, decoded to RGBA: `{ width, height,
 * rgba }`, or null. For the many .ico files with no PNG in them, which libvips
 * can't read. Handles the 32-bit (alpha) and 24-bit entries and the paletted
 * 8, 4 and 1-bit ones, with the AND mask for transparency where there's no
 * alpha channel.
 */
export function icoBitmapEntry(buf) {
  if (!buf || buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
  const count = buf.readUInt16LE(4);
  let best = null;
  for (let i = 0; i < count; i += 1) {
    const at = 6 + i * 16;
    if (at + 16 > buf.length) break;
    const width = buf[at] || 256;
    const offset = buf.readUInt32LE(at + 12);
    if (offset + 40 > buf.length || buf.readUInt32LE(offset) !== 40) continue;
    const distance = Math.abs(width - 32) + (width < 32 ? 64 : 0);
    if (!best || distance < best.distance) best = { distance, offset };
  }
  if (!best) return null;
  try {
    const off = best.offset;
    const width = buf.readInt32LE(off + 4);
    const height = Math.abs(buf.readInt32LE(off + 8)) / 2;
    const bpp = buf.readUInt16LE(off + 14);
    const compression = buf.readUInt32LE(off + 16);
    if (compression !== 0 || width <= 0 || height <= 0 || width > 256 || height > 256) return null;
    if (![1, 4, 8, 24, 32].includes(bpp)) return null;
    const colors = bpp <= 8 ? buf.readUInt32LE(off + 32) || 1 << bpp : 0;
    const palette = off + 40;
    const pixels = palette + colors * 4;
    const stride = Math.floor((bpp * width + 31) / 32) * 4;
    const maskStride = Math.floor((width + 31) / 32) * 4;
    const mask = pixels + stride * height;
    if (mask + maskStride * height > buf.length && bpp !== 32) return null;
    if (pixels + stride * height > buf.length) return null;
    const rgba = Buffer.alloc(width * height * 4);
    let anyAlpha = false;
    for (let y = 0; y < height; y += 1) {
      const row = pixels + (height - 1 - y) * stride;
      for (let x = 0; x < width; x += 1) {
        let r;
        let g;
        let b;
        let a = 255;
        if (bpp === 32 || bpp === 24) {
          const p = row + x * (bpp / 8);
          b = buf[p];
          g = buf[p + 1];
          r = buf[p + 2];
          if (bpp === 32) a = buf[p + 3];
        } else {
          const bit = x * bpp;
          const byte = buf[row + (bit >> 3)];
          const index = (byte >> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
          const c = palette + index * 4;
          b = buf[c];
          g = buf[c + 1];
          r = buf[c + 2];
        }
        if (bpp === 32 && a > 0) anyAlpha = true;
        const o = (y * width + x) * 4;
        rgba[o] = r;
        rgba[o + 1] = g;
        rgba[o + 2] = b;
        rgba[o + 3] = a;
      }
    }
    // Without a usable alpha channel, the AND mask says what's transparent.
    if ((bpp !== 32 || !anyAlpha) && mask + maskStride * height <= buf.length) {
      for (let y = 0; y < height; y += 1) {
        const row = mask + (height - 1 - y) * maskStride;
        for (let x = 0; x < width; x += 1) {
          const clear = (buf[row + (x >> 3)] >> (7 - (x & 7))) & 1;
          rgba[(y * width + x) * 4 + 3] = clear ? 0 : 255;
        }
      }
    }
    return { width, height, rgba };
  } catch {
    return null;
  }
}

const ICON_TYPES = new Set([
  'image/png',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/gif',
  'image/webp',
  'image/jpeg',
  'image/svg+xml',
]);

/**
 * An icon's media type, by its first bytes, which servers misreport (a WebP
 * served as image/png), or failing those by its header. Empty when it is
 * neither: a soft 404 answers 200 with a page.
 */
export function iconTypeOf(contentType, buf) {
  if (buf && buf.length >= 12) {
    if (buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'image/png';
    if (buf.readUInt16LE(0) === 0 && buf.readUInt16LE(2) === 1) return 'image/x-icon';
    if (buf.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
    if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
    if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(buf.toString('utf8', 0, 600))) {
      return 'image/svg+xml';
    }
    return '';
  }
  const declared = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!ICON_TYPES.has(declared)) return '';
  return declared === 'image/vnd.microsoft.icon' ? 'image/x-icon' : declared;
}

/**
 * Fetch an icon's bytes from the first candidate that answers with one.
 * Resolves to `{ buf, type }` or null.
 */
export async function fetchIcon(candidates, { signal, limit = 256 * 1024 } = {}) {
  for (const href of candidates || []) {
    try {
      const { response } = await fetchGuarded(href, { signal, accept: 'image/*' });
      if (!response.ok) {
        response.body?.cancel?.().catch(() => {});
        continue;
      }
      const buf = await readCapped(response, limit);
      if (!buf || !buf.length) continue;
      const type = iconTypeOf(response.headers.get('content-type'), buf);
      if (type) return { buf, type };
    } catch (err) {
      if (signal?.aborted) return null;
      void err;
    }
  }
  return null;
}

/**
 * The live endpoint's media: no resizing, so a picture is sent through the
 * image proxy as it is, and an icon is kept only when it is already small.
 */
export function liveMedia({ iconLimit = 12 * 1024, perIconMs = 3000 } = {}) {
  return {
    small: true,
    async image(src) {
      return `/api/image-proxy?url=${encodeURIComponent(src)}`;
    },
    async icon(candidates) {
      const got = await fetchIcon(candidates, { signal: AbortSignal.timeout(perIconMs) });
      if (!got) return '';
      let { buf, type } = got;
      if (type === 'image/x-icon' && buf.length > iconLimit) {
        const png = icoPngEntry(buf);
        if (png) {
          buf = png;
          type = 'image/png';
        }
      }
      if (buf.length > iconLimit) return '';
      return `data:${type};base64,${buf.toString('base64')}`;
    },
  };
}

/**
 * The build's media: every picture fetched once, shrunk with sharp and written
 * under public/data, so a reader's browser never asks another site for one.
 * Share images become 640×336 WebP (the card's 1.91:1), Wikipedia thumbnails
 * at most 192px, icons 32px WebP inlined as data: URIs, since they show beside
 * every link the moment the page is read.
 *
 * `sharp` is passed in: it is a dev dependency, there for the build alone.
 */
export function buildMedia({
  sharp,
  dir,
  prefix = '/data/link-previews/img',
  writeFile,
  perImageMs = 8000,
  perIconMs = 4000,
  imageLimit = 8 * 1024 * 1024,
}) {
  const images = new Map(); // key -> Promise<string>
  return {
    small: false,
    image(src, { width, height, fit }) {
      const key = mediaKey(`${src} ${width}x${height} ${fit}`);
      if (!images.has(key)) {
        images.set(
          key,
          (async () => {
            const { response } = await fetchGuarded(src, {
              signal: AbortSignal.timeout(perImageMs),
              accept: 'image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8',
            });
            if (!response.ok) {
              response.body?.cancel?.().catch(() => {});
              return '';
            }
            const buf = await readCapped(response, imageLimit);
            if (!buf) return '';
            const out = await sharp(buf, { failOn: 'none', animated: false })
              .rotate()
              .resize({ width, height, fit, withoutEnlargement: true })
              .webp({ quality: 72 })
              .toBuffer();
            await writeFile(`${dir}/${key}.webp`, out);
            return `${prefix}/${key}.webp`;
          })().catch(() => ''),
        );
      }
      return images.get(key);
    },
    async icon(candidates) {
      const got = await fetchIcon(candidates, { signal: AbortSignal.timeout(perIconMs) });
      if (!got) return '';
      const { buf, type } = got;
      let input = sharp(buf, { failOn: 'none', animated: false, density: 192 });
      if (type === 'image/x-icon') {
        // libvips reads no .ico. Many carry a PNG inside; the rest are
        // bitmaps, decoded here.
        const png = icoPngEntry(buf);
        const bitmap = png ? null : icoBitmapEntry(buf);
        if (png) input = sharp(png, { failOn: 'none' });
        else if (bitmap) {
          input = sharp(bitmap.rgba, { raw: { width: bitmap.width, height: bitmap.height, channels: 4 } });
        } else return '';
      }
      const out = await input
        .resize(32, 32, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .webp({ quality: 90 })
        .toBuffer();
      return `data:image/webp;base64,${out.toString('base64')}`;
    },
  };
}
