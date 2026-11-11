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
  Carries a photo gallery, a block body (the same `pub.leaflet.content` editor
  the blog uses, so images can sit inline), and flags choosing how much of the
  Bluesky profile card `/themself` shows above it.
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
- `is.dame.guestbook` / `is.dame.guestbook.entry` — a decentralized
  guestbook, rendered at `/guestbook`. The book is a singleton on my PDS
  (`at://{me}/is.dame.guestbook/self`); each signature is an
  `is.dame.guestbook.entry` record **on the visitor's own PDS** whose
  `subject` backlinks to the book. Reads are assembled live from
  Constellation backlinks hydrated through Slingshot; writes happen in the
  browser via atproto OAuth. See [`lexicons/GUESTBOOK.md`](lexicons/GUESTBOOK.md).
  Create the book once with [`scripts/create-guestbook.mjs`](scripts/create-guestbook.mjs).
- `is.dame.experiment` / `is.dame.experiment.reaction` — quick prototypes
  and concepts, posted for reactions and rendered at `/experimenting`. An
  experiment is a record on my PDS; each reaction is an
  `is.dame.experiment.reaction` record **on the visitor's own PDS** whose
  `subject` backlinks to it, gathered the way the guestbook's signatures are.
  See [Experimenting](#experimenting) and
  [`lexicons/EXPERIMENTING.md`](lexicons/EXPERIMENTING.md).
- `is.dame.sunfarming.result` — a finished island of
  [Sunfarming](#sunfarming), posted by the player: how many days it took. On
  **the player's own PDS**, pointing at a name for the island's board, so a
  board is gathered from backlinks like the reactions are. See
  [`lexicons/SUNFARMING.md`](lexicons/SUNFARMING.md).
- `is.dame.state` — live iPhone-sourced physical + ambient state (heart rate,
  activity, battery, ambient sound, calories). An append-only log keyed by TID:
  the **latest** record is the current "right now" rendered by the atmosphere-bar
  **vitals panel** (`src/components/VitalsPanel.jsx`, read via
  `src/hooks/useDameState.js`), and the full series is the history. Each record is
  immutable, so an `is.dame.now` status can strong-ref the one captured alongside
  it via its optional `stateRef` — coupling a note to the body-state behind it,
  which renders as a small chip (`src/components/VitalsChip.jsx`) under the status
  in the feed and on its record page.
  Posted straight from an iPhone Apple Shortcut (app-password `createSession` →
  `createRecord`, no server), and also charts over time in the /logging
  dashboard (`src/components/StateStats.jsx`). See
  [`lexicons/STATE.md`](lexicons/STATE.md).
- `is.dame.newsletter` — the newsletter's standing words, a singleton at
  `self`: its name, the form's heading, the thank-you line and the fine
  print. Every field falls back to the built-in sentence. Edited in the admin's
  Newsletter surface; see [Newsletter](#newsletter).
- `is.dame.graph.list` — one record per managed Bluesky list: a rule
  (people I engage with, people who engage with me, or accounts close in my
  follow graph, over a rolling 30 days) and the list it keeps current. Synced
  every six hours by `api/graph-lists.js`; managed in the Analytics studio's
  Graph tab. See [`docs/GRAPH-LISTS.md`](docs/GRAPH-LISTS.md).
- `is.dame.nav` — optional PDS override for the nav-menu (dock sheet) route
  list. When its `enabled` flag is set, its `items` select / reorder / relabel /
  hide the entries; otherwise the site uses the hardcoded routes in
  `src/lib/navRoutes.js`. Edited in the admin "Nav menu" panel.
- `is.dame.overlay` — stream overlays and scenes for OBS (or any tool that
  takes a browser source; stream.place gets whatever OBS sends it). One record
  per overlay, keyed by the id in its address, `/overlay/{id}`: a 1920×1080
  canvas carrying the site's own grid (16 columns × 9 rows of 92px cells on
  24px gutters), painted in the hour's sky or a fixed hour, with widgets placed
  on whole cells — a title, a countdown, the clock, the day of life, the
  latest status, now playing, vitals, the stream.place chat, capture frames,
  the mark and links. Modelled on atpota.to's `to.atpota.poe.overlay`, with its
  separate scenes folded in as overlays whose backdrop is the page. The page
  reads the record without signing in and follows saves live over Jetstream.
  Edited in the admin's "Stream overlays" studio; see
  [`src/lib/overlay.js`](src/lib/overlay.js).

  Also on the canvas: **Poe**, atpota.to's potato, ported to run here
  ([`src/overlay/poe/`](src/overlay/poe/)): it greets chatters, thanks new
  followers, says weather alerts and answers `!weather`, `!forecast`, `!apps`,
  `!pet` and `!poe`. The **atmosphere** widgets (card, strip, badge, busiest
  apps, forecast, pulse) draw atpota.to's weather station in this site's type;
  the readings come through [`api/atmosphere.js`](api/atmosphere.js), which
  passes on `atpota.to/api/atmosphere` and `/api/weather-forecast`. A **TID
  clock** shows the time as an atproto record key, and optionally the repo's
  latest revision. **Text** widgets set your own words in any of the site's
  voices on any of its grounds (page, raised, veil, accent, ink, the hour's
  sky), or as a ticker. **Capture frames** (rectangles or circles, with an
  optional nameplate) can be arranged for one to four sources at once, rotated
  so a different source takes the main window, and the studio lists where each
  goes in OBS.

Plus teal.fm for the now-playing signal: `fm.teal.feed.play` for plays and
`fm.teal.actor.status` for what's on right now. teal.fm moved off its
`fm.teal.alpha.*` lexicons in August 2026, so both namespaces are read and
collapsed by rkey (production wins) — see [`src/lib/teal.js`](src/lib/teal.js).

## Listening / albums

`/listening` is the play feed. `/listening/albums` is the same history read the
other way: every record in the recent play history (the newest thousand plays
per teal.fm lexicon, not the whole archive), ranked by how often, each with a
page of its own at `/listening/albums/{slug}`.

An album is **not a record**. teal.fm scrobbles tracks, so an album here is what
a run of plays adds up to — the same relationship a mothing night has to its
observations. [`src/lib/albums.js`](src/lib/albums.js) is the whole derivation,
and it runs in three places so they cannot disagree: in the browser over the
live play history, in `scripts/prefetch.mjs` (which writes
`public/data/albums.json` from a deeper pull than the feed's own cap, since an
album is an archive rather than a feed), and at the edge, where the middleware
resolves one for the crawler `<head>`.

The address an album answers to is derived too — `albumSlug(title, artist)`
gives `raven-by-kelela` — so nothing has to be stored for a link to keep
working. It is lossy, so a slug resolves by comparing computed slugs across the
index rather than by trusting uniqueness; the most-played album wins a fold.

An album page also links out to where you can actually play the record
([`albumLinksFor`](src/lib/musicLinks.js), the album-shaped cousin of the
per-play `musicLinksFor`). Apple gets a real link whenever the release is known
— from the id the artwork lookup returns, or failing that from the album URL
hiding inside one of its plays, since an Apple track URL is
`…/album/{slug}/{albumId}?i={songId}` and dropping the query is the record.
Spotify is always a search: its track URLs say nothing about the release they
are off, and there is no unauthenticated way to ask. The `kind` on each link
(`direct` vs `search`) is what the label is written from, so a guess never
presents itself as a certainty.

`/listening/albums` is the one literal segment under `/listening` that is not a
play's record key (a teal rkey is a TID, and nothing stops one spelling a word),
so `isAlbumPath` in [`og/records.js`](og/records.js) is checked before either
the router or the middleware asks for a record.

Open Graph: a play's card is drawn by `/api/og?play={rkey}` — the cover, the
track, the artist, and the album named rather than implied. `/api/og?album={slug}`
is one album's, and `/api/og?albums=1` draws the index as a shelf of covers.
Artwork has no home in the play record, so it is resolved through Apple's
catalogue from one of the album's plays (ISRC → Apple song id → track + artist;
[`src/lib/musicIds.js`](src/lib/musicIds.js) is the ladder, shared by the
browser, the `/api/albumart` proxy, and the card renderer) and inlined as bytes,
so one dead cover can't take a card down with it.

## Experimenting

`/experimenting` is the bench: quick prototypes and half-formed concepts, put
up before they are finished to find out what people make of them. Each one is
an `is.dame.experiment` record (a title, a pitch, and whatever there is to show
so far: a picture, a link to try, a longer write-up) with a page of its own at
`/experimenting/{rkey}`.

Under each is the ask and three answers, **More of this**, **Curious** and
**Not for me**, as buttons that carry their own counts, so the tally and the
way to add to it are one row. A reaction is an `is.dame.experiment.reaction`
record on the reactor's own PDS, signed with any atproto account, with an
optional note; one per person per experiment, and theirs to change or take
back. They are read from backlinks (Constellation → Slingshot → AppView), the
same way the guestbook is, and snapshotted at build time into
`public/data/experimenting.json` so the tallies paint at once.

To post one, sign in and use **Content → Experimenting → New** in the admin
(`/admin?c=is.dame.experiment&mode=new`); the owner also gets a "Post an
experiment" button on the page itself. `status` says where it stands: `open`
takes reactions, `pursuing` and `shelved` close them and say how it came out.
A `draft` is the owner's alone. The page's own title and intro are its
`is.dame.page/experimenting` record, like every page's.

An experiment's `url` can be anywhere. One that is built into this site lives
under the bench, as [`/experimenting/culturing`](#culturing) and
[`/experimenting/sunfarming`](#sunfarming) do. A built-in experiment is a
project of its own in [`experiments/`](experiments/), with its own
`package.json`, dependencies and standalone build, which the site only imports;
[`experiments/README.md`](experiments/README.md) is how that works, how to add
one, and how to take one out into a repository of its own.

The whole design, including sign-in scopes and moderation, is in
[`lexicons/EXPERIMENTING.md`](lexicons/EXPERIMENTING.md);
[`src/lib/experiments.js`](src/lib/experiments.js) is what an experiment and
its reactions add up to, and
[`src/lib/experimentReactions.js`](src/lib/experimentReactions.js) reads and
writes them.

## Mothing / iNaturalist

`/mothing` reads moth observations for the iNaturalist user configured in
`src/config.js` (`INATURALIST_USER`), scoped to Lepidoptera minus butterflies.
The page paints from the build-time `public/data/mothing.json` snapshot and
refreshes live from the iNaturalist API in the browser.

Observations are grouped into **sessions** — one night at the light, 8pm to 3am,
keyed by the evening's date (an after-midnight sighting belongs to the night that
began the evening before). Each session has a page of its own at
`/mothing/{YYYY-MM-DD}`, which draws that night as a card gallery. A session is
not a record: it is what a night's worth of observation records add up to, so
both the page and the crawler-facing `<head>` derive it from the same snapshot
(`findNight` in `src/lib/mothing.js`) rather than fetching anything of their own.

`/mothing/{slug}` serves two things, told apart by the shape of the slug: a date
is a night, and anything else is an iNaturalist observation id (`/mothing/392585028`
→ the generic record page). A night's Open Graph card is drawn by
`/api/og?night={date}` — the date, the counts, the hours, and the first five moths
of the night inlined as photographs.

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
writing; `--full` ignores the freshness marker. A Vercel cron runs the same
sync every 6 hours (`/api/mirror-mothing`, see `vercel.json`), just before each
`/api/rebuild`, so new observations reach the PDS — and the home feed — within
hours instead of a day. It uses `BSKY_APP_PASSWORD` (+ optional
`BSKY_IDENTIFIER`), and it needs `CRON_SECRET`: the endpoint only runs for a
request carrying `Authorization: Bearer <CRON_SECRET>` (Vercel sends that on
its own cron calls), and with the secret unset it refuses every request. The
freshness check makes the extra runs cheap: they no-op when nothing changed
upstream.

The `/mothing` page applies the same freshness check in the browser: it paints
from the snapshot and only re-pulls the full observation set from iNaturalist
when the cheap signature says something actually changed.

## Culturing

`/experimenting/culturing` is a workbench of petri dishes that aren't real:
pour a medium, put cultures on it, add a disc or a drop of dye, and leave it
in the incubator. Nothing on it is science, and everything on it is modelled
on how real colonies and biofilms look and grow; the page says which parts are
borrowed from where, in the notes on each culture and medium and in "What is
real here" at its foot.

It is the first [experiment](#experimenting), and the first that is a page of
this site rather than a link away from it. The page is built in and has no
record of its own; what puts it on the bench is an `is.dame.experiment` record
whose `url` is its address. The page finds that record by the address and
links to its reactions ("Say what you make of it"). See
[Experiments built into the site](lexicons/EXPERIMENTING.md#experiments-built-into-the-site)
for the convention.

The workbench is a package of its own,
[`experiments/culturing/`](experiments/culturing/), which the site imports as
`@dame-is/culturing` into one page
([`src/pages/Culturing.jsx`](src/pages/Culturing.jsx)). It is its own chunk
and never warmed: it carries a WebGL2 simulation and its shaders. How the
model, the units, the recipes, the drawing and the bench work is in its
[README](experiments/culturing/README.md), along with what it can be tested
for without a GPU. It is dressed in the site's kit, and borrows that through
one file ([`src/host.js`](experiments/culturing/src/host.js)), which is what
would have to travel with it if it left.

## Sunfarming

`/experimenting/sunfarming` is a small game. Each island starts on a diesel
generator; put down solar panels where the shade allows, keep the spare in
batteries, add wind for the night, and the village grows at dawn after a well
powered day, its homes moving up through three tiers that each want power at
a harder hour. An island is finished when every home is at its best and a
whole day has passed with the generator silent, and that opens the next of
six, each with its own weather, woods and seasons. It is drawn in cel-shaded
3D (three.js): a three-step light ramp, an ink outline round everything, a
banded sea with foam on the shore, and a sky that goes through the day.

Everybody starts on a tutorial island, First Light, whose lesson points at
each thing in turn (an arrow on the button to press, an arrow on the tile to
build on) and moves on when it has been done. It takes a couple of minutes,
and the rest of the game opens when it is finished. Going from one island to
the next happens behind a crossing: the sea comes up over the picture, says
where the boat is bound, and lifts on the new island.

It is the second [experiment](#experimenting) built into the site. The whole
of it is [`experiments/sunfarming/`](experiments/sunfarming/), a package the
site imports as `@dame-is/sunfarming`; its
[README](experiments/sunfarming/README.md) has the rules, the controls and how
it is put together. It is its own chunk and never warmed.

A game wants the whole window, so its page
([`src/pages/Sunfarming.jsx`](src/pages/Sunfarming.jsx)) is the game and
nothing else. On that address the site draws none of its own interface: no
bars, no dock, no inspect layer, and its single-key shortcuts stand down
(`isImmersiveExperimentPath` in
[`src/lib/experiments.js`](src/lib/experiments.js), asked by `App.jsx`). The
way back out is a button in the game's top corner, and in its menu on a
phone, which the page hands it: it goes to the experiment's own page, where
the reactions are, or to the bench until a record has been posted for it. The
game's full screen button asks the browser for real full screen where there
is such a thing.

A player who finishes an island can post the result with an atproto account:
an `is.dame.sunfarming.result` record on their own PDS, and each island has a
board of them, read from backlinks. The game knows nothing of atproto; the
page hands it a way to post
([`src/hooks/useSunfarmingSocial.js`](src/hooks/useSunfarmingSocial.js)), and
without one it only offers a line to copy.
[`lexicons/SUNFARMING.md`](lexicons/SUNFARMING.md) is the whole of it.

The game looks nothing like the rest of the site, on purpose: it carries its
own stylesheet, scoped under one class, and reads none of the site's tokens,
so it is the same game on its own (`npm run dev -w @dame-is/sunfarming`) as it
is in the page.

## Newsletter

The blog ("dame.is blogging", `BLOG_PUBLICATION`) doubles as an email
newsletter, sent by [Leaflet](https://leaflet.pub). Leaflet keeps the list and
sends the email; this site only shows the form and never sees an address. The
whole flow is described in [`src/lib/newsletter.js`](src/lib/newsletter.js).

- **Where the form shows.** A post places it with Leaflet's signup block
  (`pub.leaflet.blocks.signup`, "Newsletter signup" in the admin block editor)
  wherever the author wants one. A post without any gets one after its last
  line, and `/blogging` keeps one at the top, at `#subscribe`.
- **Its own page.** `/blogging/subscribe`
  ([`src/pages/BloggingSubscribe.jsx`](src/pages/BloggingSubscribe.jsx)) is
  the page drawn as the email: the form is its To line, and the body is the
  latest post's opening, with earlier posts a step away. It sits where a
  post's rkey would, so the edge asks `isSubscribePath` first rather than
  404ing it as a post that isn't there.
- **Its words.** The subscribe page's title and intro are its
  `is.dame.page/subscribe` record, like every page's. Everything else the site
  says about the newsletter, wherever the form is, is the `is.dame.newsletter`
  record ([`src/lib/newsletterCopy.js`](src/lib/newsletterCopy.js)): the name
  above the page's title, the form's heading in a post, the thank-you line
  and the fine print (`{rss}` becomes the feed's link). Both are edited in the
  admin's Newsletter surface, and an absent record or field is the built-in
  sentence.
- **Linking to it.** Link to `https://dame.is/blogging/subscribe`. In a post,
  that link (or one written the older way, to any dame.is page's
  `#subscribe`) opens the page in the same tab; anywhere else (an email, a
  feed reader, Bluesky) it opens like any link. Older links to
  `/blogging#subscribe` still land on the index's form. A reader whose way
  back from Leaflet has lost its page comes back to the newsletter page's
  form.
- **The form** is Leaflet's embeddable subscribe form as a plain GET form to
  `leaflet.pub/api/auth/email-login`. It only does anything once newsletter
  mode is on for the publication in Leaflet.
- **The way back.** Once a reader confirms, Leaflet sends them to
  `/receive_auth_callback` on this site, not to the form's redirect (the real
  redirect is sealed in a token only Leaflet can read). The form notes its page
  in a cookie as it leaves, and
  [`api/newsletter-return.js`](api/newsletter-return.js) sends the reader back
  there, where the form says thanks. The path is rewritten to that function in
  `vercel.json` and kept out of the middleware like the other non-SPA paths.

## Link previews

Every link in an essay, a work or the long-form profile ends on the icon of
the site it goes to, and hovering it (or tabbing to it) opens a card saying
where it leads: a Bluesky post's author, words and counts; a profile's banner
and bio; an article's headline, byline and date; a Wikipedia summary, with the
section linked to; a post on X; a Leaflet or other standard.site document's
publication; or a site's own description and share image. The card's foot
shows the address, and where the link really lands when it redirects
(`attie.ai → attie.ai/login`, `twitter.com → x.com`). Touch opens nothing; a
tap follows the link as before.

- **Looked up at build time.** `scripts/prefetch.mjs` walks every document's
  link facets and writes one file per document,
  `public/data/link-previews/<collection>/<rkey>.json`, with each link's
  preview, the icons (32px WebP, inlined), and the links it couldn't read.
  Share images are shrunk with `sharp` into `public/data/link-previews/img/`,
  so a reader's browser never asks another site for anything. A link that
  can't be read keeps the previous build's preview.
- **Each kind of place in its own terms.** Bluesky posts and profiles from
  the public AppView, Wikipedia from its page-summary API, X from
  `publish.twitter.com` oEmbed, a standard.site document from the record its
  page declares (read through Slingshot), and everything else from the
  page's `<head>`, fetched through the SSRF guard with every redirect
  re-checked. The shared, pure half is
  [`src/lib/linkPreviews.js`](src/lib/linkPreviews.js); the fetching half is
  [`api/_lib/linkPreviews.js`](api/_lib/linkPreviews.js).
- **Newer than the build.** A document published or edited since the last
  build asks [`api/link-previews.js`](api/link-previews.js) for the links its
  file doesn't have. It only reads the owner's own documents, takes the
  record's current `cid` (so the CDN can keep each version's answer for a
  week), and sends pictures through the image proxy until the next build
  shrinks them.
- **Drawn by** [`src/components/LinkPreview.jsx`](src/components/LinkPreview.jsx):
  `LeafletDocument` provides the previews when its page passes `atUri` and
  `cid`; without them (the block editor's preview) links are drawn exactly as
  before.

## Local development

```sh
npm install
npm run prefetch          # writes public/data/*.json from your PDS + AppView
npm run dev               # Vite dev server on http://localhost:5173
```

`npm run build` runs the prefetch script, then `vite build`. `npm run build:offline`
skips the prefetch (useful when a snapshot already exists).

The repo is an npm workspace: each folder under [`experiments/`](experiments/)
is a package of its own, installed and linked by the same `npm install`. Any of
them runs by itself with `npm run dev -w @dame-is/<name>` (see
[`experiments/README.md`](experiments/README.md)); `npm test` and
`npm run lint` at the root cover them too.

### The `sharp` override

`package.json` pins `sharp` to `^0.35.4` through `overrides`, and that pin is
load-bearing rather than tidy-minded. `@vercel/og` declares `sharp` as an
_optional_ dependency and **prefers it over its WASM fallback**: given both, it
rasterizes every Open Graph card with libvips rather than resvg. At `0.11.1` it
asks for `^0.34.5`, which no top-level range can lift, so without the override a
second, older copy lands under `node_modules/@vercel/og/` and that is the one
`/api/og` runs — carrying libvips and libheif CVEs into a function that decodes
remote images (album covers, moth photographs).

Which rasterizer a deployment actually used is readable off the card: libvips
writes a `pHYs` chunk and splits the pixel data into 8 KB `IDAT` chunks, resvg
writes one `IDAT` and no `pHYs`.

Dropping the override doesn't break anything visibly, which is exactly why it is
written down here. Removing `sharp` from `devDependencies` would not help either
— the copy that mattered was `@vercel/og`'s own.

## Architecture

| Concept | Lives in |
|---|---|
| AT Protocol client (Node + browser) | [`src/lib/atproto.js`](src/lib/atproto.js) |
| Build-time data fetcher | [`scripts/prefetch.mjs`](scripts/prefetch.mjs) |
| Hybrid snapshot/live data hook | [`src/hooks/useLiveFeed.js`](src/hooks/useLiveFeed.js) |
| Per-route AT URI lookup | [`src/hooks/useAtUri.js`](src/hooks/useAtUri.js) |
| `<head>` discoverability tags | [`src/components/AtUriHead.jsx`](src/components/AtUriHead.jsx) |
| Atmosphere debug overlay | [`src/components/DebugPane.jsx`](src/components/DebugPane.jsx) |
| Day-of-life math | [`src/lib/dayOfLife.js`](src/lib/dayOfLife.js) |
| Albums, derived from plays | [`src/lib/albums.js`](src/lib/albums.js) |
| Edge middleware (404s, meta, negotiation) | [`middleware.js`](middleware.js) |
| Experiments, each a package of its own | [`experiments/`](experiments/) |

## Machines reading the site

The site renders on the client, so the HTML on the wire used to carry seven
characters of text and every path — real or not — answered `200`. A crawler
could learn nothing from a page and an agent could not tell a typo from a real
address. [`middleware.js`](middleware.js) answers all of that at the edge,
before the catch-all rewrite in `vercel.json` fires:

- **Real 404s.** [`og/routes.js`](og/routes.js) mirrors the `<Route>` table in
  [`src/App.jsx`](src/App.jsx); a path matching no route shape gets a genuine
  `404`, as does a record route whose record does not resolve. The mirror is
  not trusted to stay accurate — `og/routes.test.js` parses `App.jsx` and
  `vercel.json` and fails if either drifts from it.
- **Content without JavaScript.** [`og/ssrContent.js`](og/ssrContent.js) builds
  a heading, the page's prose, the record behind it and the site's other
  surfaces as real links, injected into `#root`. An inline script hides it
  wherever JavaScript runs and `src/main.jsx` removes it before React mounts,
  so nothing about the rendered site changes — but curl, an AI crawler and a
  text browser all get a readable page.
- **Markdown on request.** [`og/markdown.js`](og/markdown.js) serves
  `text/markdown` to callers that ask for it
  ([acceptmarkdown.com](https://acceptmarkdown.com); RFC 9110 §12.5.1 for the
  q-value ranking, `406` for a request that accepts neither form). Everything
  negotiated carries `Vary: Accept`.
- **Share cards for posts.** A post with photos unfurls as
  `/api/og?post={rkey}`: the photos as a plate (up to four, laid out the way
  Bluesky lays them out) and the words beside them, or the first photo's alt
  text when there are none. A repost or a like unfurls as
  `/api/og?repost={rkey}` / `?like={rkey}`: the post it points at, under its
  author's avatar, name and handle, in quotation marks, and the head says
  "Dame reposted a post by …". Only a record key rides on the query; the
  renderer reads the text back off the record and builds every image URL
  itself from a DID and a CID on the Bluesky CDN (as JPEG, so never an SVG).
  Photos a moderation label covers stay off the card, and an author who has
  opted out of signed-out viewing gets the plain verb card instead.
- **Share cards for passages.** Select some of an essay's prose (a blog post
  or a work, anything that is a `site.standard.document`) and a small toolbar
  offers a link to that passage, `/blogging/{rkey}?quote={words}`. The link
  unfurls as `/api/og?doc={rkey}&quote={words}`, which sets the passage in
  quotation marks with the essay's title under it, and a reader who follows
  it lands on the passage, highlighted. The words in the URL are only ever
  used to find a place in the record: the edge and the card renderer both
  look them up in the document's prose ([`src/lib/quote.js`](src/lib/quote.js))
  and draw the record's own words, so a link with words the essay doesn't
  contain unfurls as the plain essay. Quotations, credits, code and embedded
  posts can't be quoted, since a card would present them as Dame's words.
  Two things about Bluesky shaped this. Its Standard Site card keeps a link's
  image but takes the title and description from the record, so there the
  image is what carries the passage. And its composer saves whichever URL a
  page's `rel=canonical` names, so a passage link names itself as canonical
  (marked `noindex`, which keeps the essay the one indexed page); otherwise a
  reader tapping the card would land at the top of the essay.
- **Identity.** [`og/jsonld.js`](og/jsonld.js) emits a schema.org `@graph` — a
  `Person`, the `WebSite` they publish, and the page — plus a per-path
  canonical URL. It is a Person, not an Organization: there is no company here
  and no address that belongs in public.

Two files are generated at build time by `scripts/prefetch.mjs`, from the same
snapshots, so they cannot disagree about what exists:

| File | Built by | For |
|---|---|---|
| `/sitemap.xml` | `buildSitemap` | crawlers |
| `/feed.xml` | `buildAtomFeed` | Atom readers |
| `/llms.txt` | [`og/llms.js`](og/llms.js) | agents — what the site is for, when to use it, when not to, and the unauthenticated atproto endpoint that serves the same data |

There is no REST API to publish and none is planned: the AT Protocol repository
behind the site is the read API, it needs no key, and `/llms.txt` names it with
a working `curl`.

## Deploy hook setup

After deploying, in Vercel:

1. **Settings → Git → Deploy Hooks** → create one named `pds-rebuild` and copy the URL.
2. **Settings → Environment Variables** → set `DEPLOY_HOOK_URL` to that URL,
   and `CRON_SECRET` to a long random string. `/api/rebuild` and the mirror
   endpoints refuse every request while it is unset, the 6-hour cron included;
   Vercel sends it on its own cron calls, and anything else calling them has to
   send `Authorization: Bearer <CRON_SECRET>`.
3. (Optional) point your publishing flow (Apple Shortcuts, etc.) at the same URL
   so a `curl -X POST` after writing a record kicks an instant rebuild.

## Credits

- [`bluesky-comments`](https://github.com/czue/bluesky-comments) — comment threads on blog posts.
- [teal.fm](https://teal.fm) — listening signal.
