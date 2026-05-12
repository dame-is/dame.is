# dame.is v2 — 4-hour atmospheric website

## Context

A 4-hour build challenge: ship a new personal site at dame.is as an **atmospheric website** — the AT Protocol PDS is the source of truth for content, and the site is a view layer over those records. Pages, blog posts, status updates, and portfolio works all live as records under `is.dame.*` lexicons; the site fetches them at build time for static caching and refreshes in-browser so newly-published records show up without redeploy. Each page advertises its backing AT URI in `<head>` so other atmosphere clients can discover and re-render the same content.

The current site is an Eleventy static site that already pulls Bluesky posts and status updates from `public.api.bsky.app` via vanilla JS. The rewrite is a React + Vite SPA with a **book-inspired typesetting aesthetic**, gerund URL framing ("Dame is… blogging"), and a much stronger PDS-as-database story.

**Decisions locked in (from clarifying questions):**

- Data: hybrid — build-time JSON snapshot + client refresh on mount
- Writes: none. Read-only public AppView + direct PDS reads
- All custom lexicons follow gerund framing under `is.dame.*`:
  - `is.dame.now` — status updates (replaces old `@now.dame.is` Bluesky posts pattern)
  - `is.dame.blogging.post` — blog posts
  - `is.dame.creating.work` — portfolio items (art, software, etc.)
  - `is.dame.page` — page-content records for Home, About, Posting intro, etc. (kept as infrastructure, not gerund)
  - `is.dame.profile` — extended long-form bio (kept as infrastructure)
- Music: "now listening" comes from your own PDS via `fm.teal.*` (teal.fm) records — not last.fm
- URL framing: gerund verbs — `/blogging`, `/posting`, `/logging`, `/listening`, `/creating`, `/sharing`, etc. Plus `/about`.
- Home (`/`) is a **unified, filterable, searchable activity feed** — statuses, Bluesky posts, blogs, listens, creations interleaved by timestamp
- Repo strategy: reuse the existing `dame-is/dame.is` repo. Develop the rewrite on branch `claude/atproto-website-migration-3qCTd`; `main` keeps the current Eleventy site live until cutover. Preserves GitHub history, stars, the Vercel project link, and the `last-commit` footer source.
- Styling: plain CSS, brand-new theme, CSS custom properties for dark/light. **Visual concept: a book's interior** — generous margins, serif body text, drop caps on long-form pages, page-number-style metadata, hairline rules. The site reads like you're holding a well-typeset volume.
- Navigation: **two layers**. (1) A static top **chrome bar** with site title + atmospheric signals (status, now-playing, day-of-life, follows). (2) A **floating action dock** (collapsible, page-marker / bookmark / pen-tool inspired) holding route links + tool buttons (theme toggle, atmosphere debug overlay, etc.).
- Vercel rewrites + cron/deploy hook for PDS-driven rebuilds: **in scope**

---

## Part 1 — Migration map (what comes from the old site)

Reimplement, don't copy. Endpoints and patterns carry over; the old ~2400-line `js/main.js` is rewritten as small React hooks.

| Old feature | Old source | DID | Endpoint | New home |
|---|---|---|---|---|
| Status updates ("dame.is hiking") | `js/main.js:809-862` | `did:plc:gq4fo3u6tqzzdkjlwzpb23tj` | `com.atproto.repo.listRecords` on `is.dame.now`, limit=1 (new lexicon replaces the @now.dame.is Bluesky-post pattern) | `<NowStatus />` in `Nav.jsx` |
| Now playing (music) | new | @dame DID | `com.atproto.repo.listRecords` on `fm.teal.*` collection, limit=1 | `<NowPlaying />` in `Nav.jsx` |
| Day of life (in nav, live ticker) | roadmap.md:11 | n/a | n/a | `<DayOfLifeTicker />` in `Nav.jsx` |
| About / extended bio | new | @dame DID | `getProfile` + `com.atproto.repo.getRecord` on `is.dame.profile/self` | `About.jsx` |
| Unified activity feed (home) | new (roadmap.md:15, roadmap.md:24) | @dame DID | merges `is.dame.now` + Bluesky posts + `is.dame.blogging.post` + `fm.teal.*` + `is.dame.creating.work` | `Home.jsx` |
| Bluesky posts feed | `js/main.js:1109-1400` | `did:plc:gq4fo3u6tqzzdkjlwzpb23tj` | `app.bsky.feed.getAuthorFeed` limit=100 + cursor | `Posting.jsx` page |
| Day-of-life counter | `.eleventy.js:206-335` | n/a | n/a — birthdate `1993-05-07T00:00:00Z` | `src/lib/dayOfLife.js` |
| Logging archive | `logging.md` + `js/main.js:1746-1996` | @now DID | same as status, paginated 50/batch | `Logging.jsx` |
| Bluesky comments | `js/comments-init.js` | @dame DID | `bluesky-comments` (CDN) | `npm i bluesky-comments`, `<Comments />` on blog posts |
| Last commit + timestamp | `js/last-commit.js` | n/a | **Repurposed**: read `createdAt` / `updatedAt` from the current page's backing `is.dame.*` record | `<RecordTimestamp />` in `Footer.jsx` |
| Follower / following count | `js/main.js:619-802` | @dame DID | `app.bsky.actor.getProfile` | `<ProfileStats />` in `Nav.jsx` |

**Constants:**

```js
// src/config.js
export const ME_DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';      // @dame.is
export const BIRTHDATE = '1993-05-07T00:00:00Z';
export const GITHUB_REPO = 'dame-is/dame.is';
export const APPVIEW = 'https://public.api.bsky.app';

// PDS collections we read at build time — all gerund-framed under is.dame.*
export const COLLECTIONS = {
  now:      'is.dame.now',                  // status updates
  blogging: 'is.dame.blogging.post',        // blog posts
  creating: 'is.dame.creating.work',        // portfolio items (art, software, etc.)
  page:     'is.dame.page',                 // page-content records (infrastructure)
  profile:  'is.dame.profile',              // extended long-form bio (infrastructure)
  listen:   'fm.teal.alpha.feed.play',      // teal.fm play records — confirm exact NSID before build
};
```

**Not migrating in v1** (out of 4-hour scope): font/theme settings popup, sitemap popup with 6× scroll carousel, skeet-tools, chip-taste-test, folder/table views, newsletter signup, koan-of-the-day.

---

## Part 2 — Architecture

### Navigation — two layers

The nav is split between a static **chrome bar** (atmospheric signals) and a **floating action dock** (routes + tools). This keeps the long sustained signals out of the way of momentary actions.

#### Layer 1: Chrome bar (top of every page, always visible)

Four atmospheric signals always visible, all sourced from your records:

1. **Status** — current `is.dame.now` record (e.g. "dame.is hiking"). Refetched on mount.
2. **Now playing** — most recent `fm.teal.*` play (track + artist). Refetched on mount + every few minutes.
3. **Day of life** — live-ticking `Day 11728 / 131 of 365 / Year 31` from `dayOfLife.js`.
4. **Follows / followers** — counts from `app.bsky.actor.getProfile`, with the count-up animation ported from `js/main.js:619-802`.

Plus the site title/logo on the left.

#### Layer 2: Floating action dock (`<ActionDock />`)

A collapsible floating element — styled as a **page marker / bookmark ribbon / pen-tool tab** consistent with the book aesthetic. Collapsed it's a small ribbon hanging off the side or bottom of the page; tapping/clicking expands it to reveal:

- **Route links**: `/`, `/about`, `/posting`, `/logging`, `/blogging`, `/creating`, `/sharing`
- **Tool buttons**:
  - **Theme toggle** (light/dark/system)
  - **Atmosphere debug overlay** — opens an overlay showing AT URI, CID, PDS endpoint, lexicon NSID, and raw JSON for the record(s) backing the current view. Toggle key `?` or icon click. Promoted from stretch to v1.
  - **Copy AT URI** — one-click copy of the canonical record URI for the current page.
- **Collapse/expand affordance**: the ribbon slides in/out; state persisted in `localStorage`.

State + open/close logic lives in `useActionDock()` hook so any component can trigger it.

### Visual design — book interior aesthetic

The design metaphor is **a well-typeset book interior**. Concrete moves:

- **Typography**: serif body (e.g. Source Serif Pro, Crimson Pro, or system serif fallback); humanist sans for chrome bar / dock / metadata; generous measure (~65ch); leading 1.55–1.65.
- **Layout**: ample inner / outer margins; running header showing the route ("Dame is… blogging") set like a book's chapter title; page-number-style timestamps in the gutter on `/posting`, `/logging`, blog posts (e.g. "Day 11728 · 11 May 2026").
- **Drop caps** on long-form pages (`/blogging/:slug`, `/about` extended bio) — first letter only, configurable per page.
- **Hairline rules** as section dividers; small caps for category labels and verb tags in the unified feed.
- **Color**: warm off-white "page" background (`#F7F3EA` ish) in light, soft ink-paper inversion in dark. CSS custom properties drive both.
- **Cursor**: subtle bookmark/ribbon ink-pen feel for hover states; underlines for links match book footnote styling.
- **Book-open intro (lightweight v1, expanded in stretch)**: on first visit (`localStorage` flag absent), the page shows a top-down view of a closed book with title on the cover; a single tap/click triggers a CSS animation that "opens" the book into the standard layout. After the first visit, this is skipped. Heavy 3D version is stretch.

### Stack

- Vite + React (JS, not TS)
- React Router v6
- Plain CSS with custom properties (`theme.css` + component-scoped `.css`)
- `bluesky-comments` npm package for comments
- `marked` or `react-markdown` for rendering document content (depending on what standard.site stores — markdown vs HTML; check during prefetch)
- No state lib — hooks + context only

### URL routes (gerund framing)

| Path | Backing record (AT URI) | Notes |
|---|---|---|
| `/` | `at://{ME}/is.dame.page/home` | **Unified activity feed**: statuses + Bluesky posts + blogs + listens + creations, interleaved by `createdAt`, with verb-filter chips and a text search box. Page record provides the intro/hero copy. |
| `/about` | `at://{ME}/is.dame.profile/self` | Avatar/handle/bio from `app.bsky.actor.getProfile`; "Read more" expands the long-form `is.dame.profile` record |
| `/blogging` | `at://{ME}/is.dame.page/blogging` | Blog index — lists all `is.dame.blogging.post` records |
| `/blogging/:slug` | `at://{ME}/is.dame.blogging.post/{rkey}` | Match by `post.slug` field |
| `/creating` | `at://{ME}/is.dame.page/creating` | Portfolio index — lists all `is.dame.creating.work` records (art, software, etc.) |
| `/creating/:slug` | `at://{ME}/is.dame.creating.work/{rkey}` | Single work item |
| `/posting` | `at://{ME}/is.dame.page/posting` | Bluesky feed grouped by day, intro copy from the page record |
| `/logging` | `at://{ME}/is.dame.page/logging` | `is.dame.now` archive grouped by day |
| `/listening` *(stretch)* | `at://{ME}/is.dame.page/listening` | Full `fm.teal.*` archive grouped by day |
| `/sharing` | `at://{ME}/is.dame.page/sharing` | Page record provides the content; sub-routes deferred |
| `*` | none | 404 |

Old paths from `vercel.json` redirect into these (see Vercel section below).

### Lexicon-wide timestamp convention

**Every `is.dame.*` record carries both `createdAt` and `updatedAt`** as `format: "datetime"` strings. `createdAt` is required and immutable; `updatedAt` is required and bumped on each `putRecord` call. The footer's `<RecordTimestamp />` reads these for the current route's backing record — that's why this isn't optional. Applies to: `is.dame.now`, `is.dame.page`, `is.dame.profile`, `is.dame.blogging.post`, `is.dame.creating.work`, and (stretch) `is.dame.annotating`.

Existing `is.dame.now` records that predate this site (the @now.dame.is statuses migrated from the old Bluesky-post pattern) get a one-time backfill: set `updatedAt = createdAt` for any record missing it. Handle in `scripts/prefetch.mjs` defensively (fall back to `createdAt` if `updatedAt` is missing) so the footer never renders broken.

### `is.dame.page` lexicon sketch

A lightweight page-content record. Define under the user's atproto namespace; one record per logical site page.

```json
{
  "lexicon": 1,
  "id": "is.dame.page",
  "defs": {
    "main": {
      "type": "record",
      "key": "literal:home | literal:posting | literal:logging | literal:sharing | tid",
      "record": {
        "type": "object",
        "required": ["title", "createdAt"],
        "properties": {
          "title":      { "type": "string", "maxLength": 200 },
          "slug":       { "type": "string" },
          "intro":      { "type": "string", "maxLength": 2000 },
          "body":       { "type": "string", "maxLength": 50000 },
          "bodyFormat": { "type": "string", "enum": ["markdown","plaintext"], "default": "markdown" },
          "createdAt":  { "type": "string", "format": "datetime" },
          "updatedAt":  { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

Ship the schema as `lexicons/is.dame.page.json` in the repo; the runtime doesn't need it (we just read JSON), but it documents intent and future lexicon publishing.

### `is.dame.profile` lexicon sketch (extended bio)

`app.bsky.actor.getProfile` already returns avatar, handle, displayName, and a short bio (`description`). The extended/long-form bio lives in a separate record at `at://{ME}/is.dame.profile/self`:

```json
{
  "lexicon": 1,
  "id": "is.dame.profile",
  "defs": {
    "main": {
      "type": "record",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["body", "updatedAt"],
        "properties": {
          "tagline":   { "type": "string", "maxLength": 280 },
          "body":      { "type": "string", "maxLength": 50000 },
          "bodyFormat":{ "type": "string", "enum": ["markdown","plaintext"], "default": "markdown" },
          "links":     { "type": "array", "items": { "type": "object",
                          "required": ["label","url"],
                          "properties": { "label": {"type":"string"}, "url": {"type":"string","format":"uri"} } } },
          "updatedAt": { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

`/about` renders `getProfile` data above the fold; a "Read more" disclosure expands the markdown `body` from this record.

### `is.dame.annotating` lexicon sketch *(stretch — v1.1)*

Margin notes / line notes / citations / parentheticals modeled on the marginalia in a printed book. Each annotation points at a target (an AT URI plus an optional selector — paragraph index, character range, or line) and carries a short note.

```json
{
  "lexicon": 1,
  "id": "is.dame.annotating",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["target", "body", "createdAt"],
        "properties": {
          "target":     { "type": "string", "format": "at-uri" },
          "selector":   { "type": "object",
                          "properties": {
                            "kind":  { "type": "string", "enum": ["paragraph","line","range","whole"] },
                            "start": { "type": "integer" },
                            "end":   { "type": "integer" }
                          } },
          "kind":       { "type": "string", "enum": ["margin","footnote","citation","parenthetical"] },
          "body":       { "type": "string", "maxLength": 2000 },
          "bodyFormat": { "type": "string", "enum": ["markdown","plaintext"], "default": "markdown" },
          "createdAt":  { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

Rendering: blog posts and pages query annotations targeting their AT URI and float them in the outer margin (or footnote stack on narrow viewports), book-style. Pure stretch — none of this ships in v1.

### Teal "now listening" — `fm.teal.*`

The nav and a future `/listening` page surface music plays from teal.fm records on your PDS. Build-time prefetch grabs the most recent ~50 plays; the nav refetches the latest one client-side on mount + every few minutes.

Confirm the exact NSID before build (`fm.teal.alpha.feed.play` is the current best guess from teal.fm's lexicons; if it has changed, update `COLLECTIONS.listen` in `config.js`). Record fields expected: track title, artist, played-at timestamp, possibly album art / external link.

### `is.dame.blogging.post` lexicon sketch

One record per blog post. Single record type (no separate publication record, since this is a single-author site).

```json
{
  "lexicon": 1,
  "id": "is.dame.blogging.post",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "slug", "body", "createdAt"],
        "properties": {
          "title":      { "type": "string", "maxLength": 300 },
          "slug":       { "type": "string", "maxLength": 200 },
          "summary":    { "type": "string", "maxLength": 2000 },
          "body":       { "type": "string", "maxLength": 200000 },
          "bodyFormat": { "type": "string", "enum": ["markdown","plaintext"], "default": "markdown" },
          "tags":       { "type": "array", "items": { "type": "string", "maxLength": 64 } },
          "createdAt":  { "type": "string", "format": "datetime" },
          "updatedAt":  { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

`/blogging/:slug` matches `:slug` against `post.slug`. Index sorts by `createdAt` desc.

### `is.dame.creating.work` lexicon sketch (portfolio)

One record per portfolio item (artwork, software project, etc.). `kind` enum tags the type so the index can filter by category.

```json
{
  "lexicon": 1,
  "id": "is.dame.creating.work",
  "defs": {
    "main": {
      "type": "record",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["title", "slug", "kind", "createdAt"],
        "properties": {
          "title":      { "type": "string", "maxLength": 300 },
          "slug":       { "type": "string", "maxLength": 200 },
          "kind":       { "type": "string", "enum": ["art","software","writing","music","video","other"] },
          "summary":    { "type": "string", "maxLength": 2000 },
          "body":       { "type": "string", "maxLength": 200000 },
          "bodyFormat": { "type": "string", "enum": ["markdown","plaintext"], "default": "markdown" },
          "media":      { "type": "array", "items": { "type": "object",
                            "required": ["url"],
                            "properties": {
                              "url":   { "type": "string", "format": "uri" },
                              "alt":   { "type": "string" },
                              "kind":  { "type": "string", "enum": ["image","video","embed"] }
                            } } },
          "links":      { "type": "array", "items": { "type": "object",
                            "required": ["label","url"],
                            "properties": {
                              "label": { "type": "string" },
                              "url":   { "type": "string", "format": "uri" }
                            } } },
          "createdAt":  { "type": "string", "format": "datetime" }
        }
      }
    }
  }
}
```

### Home unified-feed model

Home merges five record sources into a single time-ordered timeline with verb tags:

| Verb | Source | Display |
|---|---|---|
| `logging` | `is.dame.now` | status entry — short text + timestamp |
| `posting` | Bluesky feed (`app.bsky.feed.getAuthorFeed`) | post card |
| `blogging` | `is.dame.blogging.post` | title + summary + link |
| `listening` | `fm.teal.*` | track + artist (collapsed: consecutive listens stack into "5 listens" rows) |
| `creating` | `is.dame.creating.work` | title + thumb + kind tag |

Controls along the top:
- Verb filter chips (multi-select; `?verbs=posting,blogging` in URL for shareable filters)
- Text search box (client-side substring match across title/body/summary; `?q=...` in URL)

Both controls update `useSearchParams` so links are shareable and back-button works. Day-of-life headers separate days, same as `/posting` and `/logging`.

`Home.jsx` reads `unifiedFeed.json` (built by `prefetch.mjs` as a merged, sorted, normalized array; each item has `{verb, createdAt, atUri, payload}`). The runtime hook refetches each source independently and merges fresh items in.

### Atmospheric `<head>` — discoverability

Every route renders an AT URI hint so other atmosphere clients can find the canonical record:

```html
<link rel="alternate" type="application/at-record+json"
      href="at://did:plc:.../is.dame.page/home" />
<meta name="atproto:uri" content="at://did:plc:.../is.dame.page/home" />
<meta name="atproto:cid" content="bafy..." />   <!-- optional, from listRecords -->
```

Implementation: a `<AtUriHead atUri={...} cid={...} />` component (React 19 native `<title>`/`<meta>` hoisting, or `react-helmet-async` if needed) that each route mounts with its record's URI. For `/blogging` and `/posting` aggregate pages, point at the publication / page record. For `/blogging/:path`, point at the document.

### Project layout

```
dame-is/
├─ index.html
├─ vite.config.js
├─ vercel.json                  ⭐ rewrites + redirects + cron
├─ package.json
├─ lexicons/
│  ├─ is.dame.now.json
│  ├─ is.dame.page.json
│  ├─ is.dame.profile.json
│  ├─ is.dame.blogging.post.json
│  ├─ is.dame.creating.work.json
│  └─ is.dame.annotating.json     (stretch — schema-only in v1)  (all documentation-only; not consumed at runtime)
├─ api/
│  └─ rebuild.js                ⭐ Vercel serverless: pings deploy hook
├─ scripts/
│  └─ prefetch.mjs              ⭐ build-time PDS + AppView fetcher
├─ public/
│  └─ data/                     (generated, gitignored)
│     ├─ profile.json           (app.bsky.actor.getProfile)
│     ├─ extendedProfile.json   (is.dame.profile/self)
│     ├─ posts.json             (Bluesky feed)
│     ├─ now.json               (is.dame.now status records)
│     ├─ listening.json         (recent fm.teal.* plays)
│     ├─ blogs.json             (is.dame.blogging.post records)
│     ├─ creations.json         (is.dame.creating.work records)
│     ├─ pages.json             (all is.dame.page records, keyed by rkey)
│     ├─ unifiedFeed.json       (merged, time-sorted timeline for Home)
│     └─ snapshot-meta.json
├─ src/
│  ├─ main.jsx
│  ├─ App.jsx
│  ├─ config.js
│  ├─ lib/
│  │  ├─ atproto.js             ⭐ shared by Node + browser: resolvePds, getProfile, getAuthorFeed, listRecords
│  │  ├─ dayOfLife.js
│  │  ├─ time.js
│  │  └─ snapshot.js            (load JSON + merge with client refresh)
│  ├─ hooks/
│  │  ├─ useSnapshot.js
│  │  ├─ useAuthorFeed.js
│  │  ├─ useProfile.js
│  │  ├─ useRecordTimestamp.js  ⭐ reads createdAt / updatedAt for current route's record
│  │  ├─ useLiveDayOfLife.js
│  │  ├─ useActionDock.js       ⭐ dock open/close + persisted state
│  │  └─ useAtUri.js            ⭐ exposes the AT URI for current route (debug overlay reads this)
│  ├─ components/
│  │  ├─ ChromeBar.jsx          ⭐ top bar: title + status + now-playing + day-of-life + follows
│  │  ├─ ActionDock.jsx         ⭐ floating bookmark/ribbon nav + tools (collapsible)
│  │  ├─ DebugOverlay.jsx       ⭐ atmosphere debug panel (AT URI, CID, PDS, raw JSON)
│  │  ├─ ThemeToggle.jsx
│  │  ├─ NowStatus.jsx          (latest is.dame.now)
│  │  ├─ NowPlaying.jsx         (latest fm.teal.* play)
│  │  ├─ DayOfLifeTicker.jsx    (live day count in chrome bar)
│  │  ├─ ProfileStats.jsx       (followers / following)
│  │  ├─ Footer.jsx
│  │  ├─ RecordTimestamp.jsx    ⭐ "written 2w ago · updated 3d ago" from page-record createdAt/updatedAt
│  │  ├─ AtUriHead.jsx          ⭐ injects atproto meta tags per page
│  │  ├─ DayOfLifeHeader.jsx    (per-day group header on /posting and /logging)
│  │  ├─ PostCard.jsx
│  │  ├─ StatusEntry.jsx
│  │  ├─ BlogCard.jsx
│  │  ├─ CreatingCard.jsx
│  │  ├─ ListenRow.jsx
│  │  ├─ FeedItem.jsx           ⭐ polymorphic renderer for unified feed
│  │  ├─ FeedFilters.jsx        ⭐ verb-chip + search bar for Home
│  │  └─ Comments.jsx
│  ├─ pages/
│  │  ├─ Home.jsx               ⭐ unified, filterable, searchable activity feed
│  │  ├─ About.jsx              ⭐ getProfile + extended bio record
│  │  ├─ Posting.jsx
│  │  ├─ Logging.jsx
│  │  ├─ Blogging.jsx           (index of is.dame.blogging.post)
│  │  ├─ BlogPost.jsx           (single post by slug)
│  │  ├─ Creating.jsx           ⭐ portfolio index of is.dame.creating.work
│  │  ├─ CreatingWork.jsx       (single work by slug)
│  │  ├─ Sharing.jsx
│  │  └─ NotFound.jsx
│  └─ styles/
│     ├─ reset.css
│     ├─ theme.css
│     └─ typography.css
```

### Data flow — the hybrid model

**Build (`npm run build` runs `prefetch.mjs` first):**

1. Resolve `ME_DID`'s PDS via `https://plc.directory/{did}` → `service[0].serviceEndpoint`.
2. AppView: `app.bsky.actor.getProfile`, paginated `app.bsky.feed.getAuthorFeed`.
3. PDS: paginated `com.atproto.repo.listRecords` for `is.dame.now`, `is.dame.page`, `is.dame.profile`, `is.dame.blogging.post`, `is.dame.creating.work`, `fm.teal.*`.
4. Build `unifiedFeed.json` by mapping each source into `{verb, createdAt, atUri, payload}` shape and merge-sorting by `createdAt` desc.
5. Write `public/data/*.json` + `snapshot-meta.json` (built-at ISO).
6. Vite builds; JSON ships as static assets.

**Runtime:**

1. Each page synchronously imports its snapshot JSON for instant first paint.
2. `useEffect` fires a fresh fetch to the same endpoint from the browser, merges new items by URI/rkey at the top, leaves existing items in place.
3. If the live fetch fails, the snapshot is what visitors see — graceful degrade.

### Vercel rewrites + redirects (ported from old `vercel.json`)

Build command + cron go in the new `vercel.json`:

```jsonc
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "crons": [
    { "path": "/api/rebuild", "schedule": "0 */6 * * *" }   // every 6 hours
  ],
  "rewrites": [
    { "source": "/index", "destination": "/" },
    { "source": "/home",  "destination": "/" }
  ],
  "redirects": [
    // gerund migration (note: /about is now a real page, no longer a redirect)
    { "source": "/blog",       "destination": "/blogging",  "permanent": true },
    { "source": "/blog/:path*","destination": "/blogging/:path*", "permanent": true },
    { "source": "/writing/blogs", "destination": "/blogging", "permanent": true },
    { "source": "/writing/blogs/:path*", "destination": "/blogging/:path*", "permanent": true },
    { "source": "/posts",      "destination": "/posting",   "permanent": true },
    { "source": "/writing/posts", "destination": "/posting", "permanent": true },
    { "source": "/log",        "destination": "/logging",   "permanent": true },
    { "source": "/patrons",    "destination": "/supported", "permanent": true },
    { "source": "/ethos",      "destination": "/sharing",   "permanent": true },
    // external (kept from old config)
    { "source": "/skeet-tools",   "destination": "https://cred.blue/resources", "permanent": true },
    { "source": "/ratingalttext", "destination": "https://cred.blue/alt-text",  "permanent": true },
    { "source": "/curating/:path*", "destination": "https://www.are.na/dame/:path*", "permanent": true },
    { "source": "/flushing",   "destination": "https://flushes.app/profile/dame.is", "permanent": true }
  ]
}
```

### Cron / deploy hook — PDS-triggered rebuilds

Two-layer approach:

1. **Scheduled poll (always-on):** Vercel cron pings `/api/rebuild` every 6 hours. The handler checks `snapshot-meta.json` vs. current PDS state by listing record CIDs/cursors, and if anything changed, hits the Vercel **Deploy Hook URL** (stored as `DEPLOY_HOOK_URL` env var). This is the safety net.

2. **On-demand from publishing tools:** Document the Deploy Hook URL so your Apple Shortcuts / publishing flow can `curl -X POST` it after writing a record. Instant rebuild without waiting on the 6-hour cron.

```js
// api/rebuild.js — Vercel serverless function
export default async function handler(req, res) {
  const hook = process.env.DEPLOY_HOOK_URL;
  if (!hook) return res.status(500).json({ error: 'no deploy hook configured' });
  // Optional: compare PDS listRecords cursors against snapshot-meta.json to skip no-op rebuilds.
  await fetch(hook, { method: 'POST' });
  res.status(200).json({ triggered: true });
}
```

Setup steps after deploy:
- Vercel dashboard → Settings → Git → Deploy Hooks → create one named "pds-rebuild" → copy URL.
- Set `DEPLOY_HOOK_URL` env var in the project.
- Optionally add the same URL to your status-update Apple Shortcut so a status publish kicks a rebuild.

### Critical files

1. `scripts/prefetch.mjs` — single point of failure for build-time data. Smoke-test in isolation: `node scripts/prefetch.mjs && ls -la public/data/`.
2. `src/lib/atproto.js` — shared by Node + browser; plain `fetch`, no atproto SDK (saves install + bundle weight).
3. `src/lib/dayOfLife.js` — straight port of UTC-noon-normalized calc from `.eleventy.js:206-335`.
4. `src/hooks/useSnapshot.js` — hybrid merge logic; one bug here flickers or duplicates content.
5. `src/components/AtUriHead.jsx` — the atmospheric `<head>` injection; the thing that makes this an *atmospheric* website rather than just another React site.
6. `vercel.json` + `api/rebuild.js` — keep PDS publishes flowing into deploys.

---

## Feature priority buckets

Mission-critical features go first; everything else is sequenced behind them. The timeboxing in Part 3 follows this ordering — if anything slips, cut from the bottom up.

### Essential — non-negotiable for v1

These are the features that, if missing, the site doesn't tell the story it's trying to tell. Build first, polish last.

1. **Home page / unified feed** — `/` shows status, posts, blogs, listens, and creations interleaved by `createdAt`. Filterable by verb-chip and searchable, with `?verbs=&q=` URL sync.
2. **Chrome bar atmospheric signals** — top bar shows site title + current `is.dame.now` status + **now-listening track from `fm.teal.*`** + follower/following counts + live day-of-life ticker. All four signals are non-negotiable — the listening signal is the single most "always alive" element on the page and proves the multi-PDS-collection story. NSID for teal.fm must be confirmed before scaffold; if the live call fails at build time the component degrades to a "—" placeholder rather than disappearing.
3. **Action dock (tools menu)** — floating collapsible bookmark/ribbon element that holds route links + tool buttons. The home for everything that isn't an atmospheric signal.
4. **Debug overlay** — opens from a dock tool button on every route. Shows AT URI, CID, PDS endpoint, lexicon NSID, and raw JSON for the record(s) backing the current view. The single most "atmospheric" feature in the build.
5. **Atmosphere `<head>`** — every route emits `<link rel="alternate" type="application/at-record+json">` + `<meta name="atproto:uri">` pointing at the canonical record. Makes the site discoverable as a view layer.
6. **Lexicon-backed blog** — `/blogging` index + `/blogging/:slug` single post, both rendered from `is.dame.blogging.post` records on the PDS. Proves the "PDS as database" story.
7. **Book-interior visual aesthetic** — serif body, generous margins, hairline rules, page-number-style timestamps, small caps for verb tags. The design language that ties everything together.
8. **AT Protocol data pipeline** — `scripts/prefetch.mjs` builds JSON snapshots; `useSnapshot` hooks merge live refreshes on mount. Without this nothing renders.
9. **Theme toggle** — light/dark via CSS custom properties; toggle lives in the action dock.
10. **Deployed to Vercel on the right branch** — actually live at the URL.

### High Priority — ship if hours 3-4 are on track

The features that round the site out into "complete" rather than "demo". Cut these only after Essential is solid.

- **`/about`** — `getProfile` card above the fold; "Read more" expands the `is.dame.profile/self` long-form bio.
- **`/posting`** — Bluesky author feed grouped by day with day-of-life headers.
- **`/logging`** — full `is.dame.now` archive grouped by day.
- **Footer with page-record timestamps** — every route's backing `is.dame.*` record carries `createdAt` and `updatedAt`; the footer renders them as a relative-time pair ("written 2 weeks ago · updated 3 days ago"). Replaces the old GitHub `last-commit` footer entirely — the site's freshness signal now comes from your PDS, not git. Implementation: `<RecordTimestamp />` reads from `useAtUri()` + the route's prefetched record JSON.
- **Bluesky comments on blog posts** — `bluesky-comments` npm component mounted under each post.
- **Old-URL redirects** — `vercel.json` carries forward `/blog → /blogging`, `/log → /logging`, etc.
- **Drop caps on long-form pages** — first-letter styling on `/blogging/:slug` and `/about` body.
- **Book-open intro overlay** — first-visit-only CSS animation; `localStorage` flag suppresses subsequent visits.
- **Copy-AT-URI tool button** in the action dock.

### Medium Priority — nice to have, cuttable without regret

Useful but expendable. Each is a self-contained module that can ship in v1.1.

- **`/creating` portfolio index + `/creating/:slug`** — `is.dame.creating.work` records with media + links.
- **`/sharing` page** — backed by `is.dame.page/sharing`.
- **Vercel cron + `/api/rebuild` handler** — automated 6-hour rebuilds. Deploy hook URL can be triggered manually meanwhile.
- **Verb-filter chips + search box** — Home renders without them (raw merged feed); they make it useful at scale.
- **Day-of-life ticker live updates** — static day number ships even if the second-by-second ticker doesn't.

### Low Priority — stretch / v1.1+

Anything below this line is out of scope for the 4-hour build. Listed for future planning.

- **`is.dame.annotating` margin notes** — book-style marginalia targeting any AT URI; render in the outer margin.
- **Full 3D book-open intro** — proper page-turn animation vs. the lightweight CSS overlay in High Priority.
- **`/listening`** — full `fm.teal.*` archive page, mirroring `/logging`.
- **RSS feeds** — `/blogging` and unified feed, generated at build time.
- **Skeleton loaders** during the live-refresh window.
- **GitHub + are.na verbs** in the unified Home feed.
- **Cross-verb permalink cards** — inline post/blog previews when a status references another record.
- **OAuth login + write panel** — admin-only publishing UI replacing the Apple Shortcut.
- **Reading time indicator** on blog posts.
- **Time-of-day auto dark mode**, not just OS preference.
- **Lexicon publishing** — make `is.dame.*` schemas resolvable via XRPC.
- **PDS-firehose-driven rebuilds** — Jetstream listener replaces the 6-hour cron.
- **Page-turn route transitions** — animated page turns between routes to lean further into the book metaphor.

---

## Part 3 — 4-hour timeboxing

| Block | Time | Outcome |
|---|---|---|
| Scaffold: `npm create vite`, router, theme CSS with book-aesthetic tokens, layout shell, `AtUriHead` | 0:00–0:25 | App boots, light/dark works, serif/sans loaded, head meta wired |
| `lib/atproto.js` + `scripts/prefetch.mjs` for profile + posts + `is.dame.now` + listening | 0:25–0:50 | `profile.json` / `posts.json` / `now.json` / `listening.json` populated |
| Extend prefetch to `is.dame.page` + `is.dame.profile` + `is.dame.blogging.post` + `is.dame.creating.work` + build `unifiedFeed.json` | 0:50–1:15 | All snapshots written and merged |
| `ChromeBar` (status + now-playing + day-of-life ticker + follow counts) + `Footer` (`<RecordTimestamp />` from page record) | 1:15–1:40 | Atmospheric chrome bar live; footer reads createdAt/updatedAt from `useAtUri()` record |
| `ActionDock` (floating bookmark-style nav + tool buttons) + `useActionDock` hook + theme toggle | 1:40–2:05 | Collapsible dock works on every page; theme toggle wired |
| `DebugOverlay` (AT URI / CID / PDS / raw JSON for current route) + `useAtUri` hook | 2:05–2:20 | Tool button in dock opens overlay; debug shows correct record for each route |
| `Home.jsx` unified feed + `FeedItem.jsx` + `FeedFilters.jsx` (verb chips + search via `useSearchParams`) | 2:20–2:55 | `/` renders merged feed, filters work, URL sync |
| `Posting.jsx` + `Logging.jsx` + `dayOfLife.js` headers + `PostCard.jsx` / `StatusEntry.jsx` | 2:55–3:15 | `/posting` + `/logging` render |
| `Blogging.jsx` index + `BlogPost.jsx` single-post with markdown + drop cap | 3:15–3:35 | `/blogging` + `/blogging/:slug` work |
| `Creating.jsx` + `CreatingWork.jsx` + `About.jsx` + `Sharing.jsx` + `Comments.jsx` | 3:35–3:50 | Remaining routes ship |
| Book-open intro overlay (first-visit only, CSS animation) + `vercel.json` redirects + `api/rebuild.js` + deploy hook | 3:50–4:00 | Intro polish + live on Vercel with cron rebuild armed |

**If running over at 3:00, cut from the bottom of the priority list up:** drop Medium first (`/creating`, `/sharing`, `<NowPlaying />`, cron handler, verb filters), then drop the bottom of High (book-open intro overlay, copy-AT-URI button, drop caps). **Never cut Essential:** Home unified feed, chrome bar, action dock, debug overlay, atmosphere `<head>`, `is.dame.blogging.post`-backed blog, book aesthetic, theme toggle, data pipeline, Vercel deploy.

---

## Verification

1. `npm run build` succeeds. `public/data/*.json` is populated and non-empty (including `unifiedFeed.json`).
2. Local preview (`npm run preview`):
   - **Chrome bar** shows: site title, current status from `is.dame.now`, now-playing track, live day-of-life ticker, follower/following counts.
   - **Action dock** floats above the page; clicking the ribbon expands it to reveal route links and tool buttons; collapsing it persists across reloads (`localStorage`).
   - **Debug overlay** opens from the dock's tool button on every route and shows the correct AT URI / CID / PDS endpoint / raw JSON for that route's record(s).
   - Layout reads like a book: serif body, generous margins, hairline rules, page-number-style timestamps, drop caps on long-form pages.
   - First visit shows the book-open intro overlay; second visit skips it (localStorage flag set).
   - `/` shows the unified feed mixing statuses, posts, blogs, listens, and creations in chronological order. Clicking verb chips filters; typing in the search box narrows results. URL updates with `?verbs=...&q=...`.
   - `/about` shows avatar + handle + short bio from `getProfile`; "Read more" expands the long-form `is.dame.profile/self` body.
   - `/posting` shows posts grouped by day with day-of-life headers.
   - `/logging` shows `is.dame.now` entries grouped by day.
   - `/blogging` shows at least one `is.dame.blogging.post` record. `/blogging/:slug` renders markdown.
   - `/creating` shows portfolio items. `/creating/:slug` renders a single work with media.
   - Comments component renders under a blog post.
   - Footer shows the current route's record `createdAt` + `updatedAt` as a relative-time pair (e.g. "written 2w ago · updated 3d ago"), pulled from the PDS record backing that route — not from GitHub.
   - View source on every route: `<link rel="alternate" type="application/at-record+json" href="at://...">` and `<meta name="atproto:uri">` are present and point at the correct record.
3. Network tab confirms: page loads `/data/unifiedFeed.json` first (200, cached), then fires live requests to refresh each source.
4. Disable network → reload → snapshot still renders.
5. Old URLs redirect: `/blog/foo` → `/blogging/foo`, `/log` → `/logging`, `/skeet-tools` → cred.blue. `/about` resolves as a real page (not a redirect).
6. Hit `/api/rebuild` locally (with `vercel dev` and `DEPLOY_HOOK_URL` set to a test URL); confirm it POSTs to the hook.
7. Deploy to Vercel; confirm prod matches local. Verify cron entry appears under Project → Crons.
8. Publish a test `is.dame.now` record on the PDS, manually POST the deploy hook, watch the new entry appear at the top of `/` and `/logging` after redeploy.

---

*All stretch / v1.1+ work is captured under "Low Priority" in the Feature priority buckets section above.*