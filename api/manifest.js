// Vercel serverless function: the Web App Manifest that makes dame.is
// installable as a PWA, with the hourly sky-avatar as the app icon.
//
// Served from /api/ (not a static /manifest.webmanifest) because the SPA
// catch-all rewrite swallows non-/api, non-/assets paths — the same reason the
// favicon and OG cards live under /api. Linked from index.html as
// <link rel="manifest" href="/api/manifest">.
//
// The icon URLs point back at /api/favicon?size=…, so an install picks up the
// current Eastern-hour avatar (iOS freezes the home-screen icon at install
// time; Chrome/Android refresh it when the manifest changes). Colors mirror
// src/styles/theme.css (light paper + tan chrome).

import { SITE } from '../og/pages.js';

const MANIFEST = {
  name: SITE.domain,
  short_name: SITE.domain,
  description: SITE.tagline,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f1ead4', // --page (light)
  theme_color: '#e3d8ba',      // --surface-raised (light) — matches the meta theme-color
  icons: [
    { src: '/api/favicon?size=192', sizes: '192x192', type: 'image/jpeg', purpose: 'any' },
    { src: '/api/favicon?size=512', sizes: '512x512', type: 'image/jpeg', purpose: 'any' },
  ],
};

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
  return res.status(200).end(JSON.stringify(MANIFEST));
}
