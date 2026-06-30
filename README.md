# dame.is

An atmospheric personal website. Every page is a record on the AT Protocol; the
site is a view layer over those records.

## Stack

- **Vite + React** SPA, plain CSS, no state library.
- **AT Protocol** as the database. Records live under `is.dame.*` lexicons on
  the user's PDS; build-time JSON snapshots come from `app.bsky.feed.getAuthorFeed`,
  `com.atproto.repo.listRecords`, and `app.bsky.actor.getProfile`.
- **Vercel** for hosting. A 6-hour cron pings `/api/rebuild`, which fires the
  Vercel deploy hook so new records publish without a manual redeploy.

## Lexicons

Schema-only documentation lives under [`lexicons/`](lexicons/):

- `is.dame.now` — short status updates ("dame.is hiking").
- `is.dame.page` — page-content records keyed by literal page name.
- `is.dame.profile` — extended long-form bio at `at://{me}/is.dame.profile/self`.
- `is.dame.creating.work` — portfolio works (art, software, writing, music…).
- `is.dame.resume` / `is.dame.resume.job` / `is.dame.resume.education` —
  a backlinked resume model: many resume versions curate shared job/education
  records and pick which highlight bullets to show. See
  [`lexicons/RESUME.md`](lexicons/RESUME.md); renders at `/resume`. Bulk-import
  from a LinkedIn/resume PDF with
  [`scripts/import-resume.mjs`](scripts/import-resume.mjs).
- `is.dame.annotating` — stretch lexicon for book-style margin notes.

Plus `fm.teal.alpha.feed.play` (teal.fm) for the now-playing signal.

## Local development

```sh
npm install
npm run prefetch          # writes public/data/*.json from your PDS + AppView
npm run dev               # Vite dev server on http://localhost:5173
```

`npm run build` runs the prefetch script, then `vite build`. `npm run build:offline`
skips the prefetch (useful when a snapshot already exists).

## Architecture

| Concept | Lives in |
|---|---|
| AT Protocol client (Node + browser) | [`src/lib/atproto.js`](src/lib/atproto.js) |
| Build-time data fetcher | [`scripts/prefetch.mjs`](scripts/prefetch.mjs) |
| Hybrid snapshot/live merge hook | [`src/hooks/useSnapshot.js`](src/hooks/useSnapshot.js) |
| Per-route AT URI lookup | [`src/hooks/useAtUri.js`](src/hooks/useAtUri.js) |
| `<head>` discoverability tags | [`src/components/AtUriHead.jsx`](src/components/AtUriHead.jsx) |
| Atmosphere debug overlay | [`src/components/DebugOverlay.jsx`](src/components/DebugOverlay.jsx) |
| Day-of-life math | [`src/lib/dayOfLife.js`](src/lib/dayOfLife.js) |

## Deploy hook setup

After deploying, in Vercel:

1. **Settings → Git → Deploy Hooks** → create one named `pds-rebuild` and copy the URL.
2. **Settings → Environment Variables** → set `DEPLOY_HOOK_URL` to that URL.
3. (Optional) point your publishing flow (Apple Shortcuts, etc.) at the same URL
   so a `curl -X POST` after writing a record kicks an instant rebuild.

## Credits

- [`bluesky-comments`](https://github.com/czue/bluesky-comments) — comment threads on blog posts.
- [teal.fm](https://teal.fm) — listening signal.
