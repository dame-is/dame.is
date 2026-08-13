// Standard Site publication-verification endpoint.
//
// Bluesky (and other AT clients) verify a site.standard.publication by fetching
// `{publication.url}/.well-known/site.standard.publication[/path]` and confirming
// it returns that publication's bare AT-URI — see
// https://standard.site/docs/verification. Without this, the enhanced "Standard
// Site" link embed never renders for dame.is links.
//
// dame.is hosts several non-root publications, so each answers at its own path:
//   /.well-known/site.standard.publication/blogging        → the blog
//   /.well-known/site.standard.publication/creating        → the portfolio
//   /.well-known/site.standard.publication/creating/ratioed → Ratioed
// (The bare /.well-known/site.standard.publication has no root publication.)
//
// Wired up in vercel.json, which rewrites the .well-known paths here.

import {
  BLOG_PUBLICATION,
  PORTFOLIO_PUBLICATION,
  RATIOED_PUBLICATION,
  RATIOED_PATH,
} from '../src/config.js';

// publication path (matches each record's `url` path) → publication AT-URI.
// A publication that hasn't been created yet is simply absent, so its path
// 404s rather than answering with an empty verification.
const PUBLICATIONS = {
  blogging: BLOG_PUBLICATION,
  creating: PORTFOLIO_PUBLICATION,
  ...(RATIOED_PUBLICATION ? { [`creating/${RATIOED_PATH}`]: RATIOED_PUBLICATION } : {}),
};

export default function handler(req, res) {
  const raw = req.query?.pub;
  const key = String(Array.isArray(raw) ? raw.join('/') : raw || '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  const uri = PUBLICATIONS[key] || null;

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400');
  if (!uri) return res.status(404).end('');
  return res.status(200).end(uri);
}
