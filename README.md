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
- `is.dame.mothing` / `is.dame.mothing.observation` — a mirror of moth
  observations from iNaturalist, rendered at `/mothing`. The summary singleton
  lives at `at://{me}/is.dame.mothing/self`; one observation record per
  iNaturalist observation is keyed by its iNat id. **No location data is ever
  mirrored** — coordinates, place names, and timezone are stripped in
  [`src/lib/inaturalist.js`](src/lib/inaturalist.js). Sync with
  [`scripts/mirror-inaturalist.mjs`](scripts/mirror-inaturalist.mjs). Once
  mirrored, moth observations also appear in the home feed under the `mothing`
  verb, ordered by observation date.
- `is.dame.observing` / `is.dame.observing.observation` — the same mirror for
  every _non-moth_ iNaturalist observation (birds, plants, fungi, butterflies,
  other insects…), rendered in the home feed under the `observing` verb. The
  same sync writes both: it pulls every observation once and splits each by
  taxonomy — moths (Lepidoptera minus butterflies) become `is.dame.mothing.*`
  records, everything else `is.dame.observing.*` — so one iNaturalist log shows
  up as _mothing_ if it's a moth and _observing_ otherwise, with nothing
  dropped or double-counted. Same location-stripping guarantee. The
  `is.dame.observing/self` summary doubles as the incremental mirror's
  freshness marker across all observations.

Plus `fm.teal.alpha.feed.play` (teal.fm) for the now-playing signal.

## Mothing / iNaturalist

`/mothing` reads moth observations for the iNaturalist user configured in
`src/config.js` (`INATURALIST_USER`), scoped to Lepidoptera minus butterflies.
The page paints from the build-time `public/data/mothing.json` snapshot and
refreshes live from the iNaturalist API in the browser.

The **home feed** goes further: every iNaturalist observation is mirrored onto
the PDS and surfaced there — moths under the `mothing` verb, everything else
(birds, plants, fungi, butterflies, other insects…) under `observing`. The mirror
pulls all observations once and classifies each from its taxon ancestry
(`isMoth` = Lepidoptera, minus butterflies) so the two feed verbs partition the
set with nothing dropped or double-counted.

To keep that owned copy on the PDS, run the mirror:

```sh
BSKY_IDENTIFIER=dame.is BSKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
  node scripts/mirror-inaturalist.mjs           # --full to force a complete resync
```

The mirror is incremental: a cheap freshness check (one small request, over all
observations) skips the run entirely when nothing changed; otherwise it re-pulls
only observations changed since the last sync (via iNaturalist's
`updated_since`), writes just those to the right collection plus the two
refreshed summaries, and deletes records for observations removed upstream (or
moved across the moth boundary by a re-identification). `--dry-run` plans without
writing; `--full` ignores the freshness marker. A daily Vercel cron
(`/api/mirror-mothing`, see `vercel.json`) runs the same sync using
`BSKY_APP_PASSWORD` (+ optional `BSKY_IDENTIFIER`); set `CRON_SECRET` to lock the
endpoint down.

The `/mothing` page applies the same freshness check in the browser: it paints
from the snapshot and only re-pulls the full observation set from iNaturalist
when the cheap signature says something actually changed.

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
