# Every way dame.is is "atmospheric"

Source material for the blog post on the v2 design + architecture. "Atmospheric"
here means what the build plan and the site's own tagline mean by it:

> **"An atmospheric website built atop the AT Protocol"** — the PDS is the source
> of truth for content, and the site is a *view layer* over those records. Every
> page is a record; other atmosphere clients can discover and re-render the same
> data.

The site is atmospheric on seven levels: (1) its **foundation** is atproto, (2) it
defines its **own lexicon family**, (3) it **reads across the whole atmosphere**
into one feed, (4) it **writes back to visitors' own PDSes**, (5) it leans on
**decentralized infrastructure services**, (6) it's **discoverable and
interoperable** by design, and (7) it wears a set of **atmospheric flourishes**.

Identity that threads through all of it (`src/config.js`): `did:plc:gq4fo3u6tqzzdkjlwzpb23tj`
(`dame.is`), AppView `public.api.bsky.app`, PLC directory `plc.directory`.

---

## 1. The foundation: the site *is* an AT Protocol app

The architecture itself is the headline. There is no application database — the PDS
repo **is** the database, and React is just the renderer.

1. **Every page is a record; the site is a view layer.** The README states it
   literally, and the whole `src/` tree makes it true: pages, statuses, blog posts,
   portfolio works, résumés, guestbook, observations all live as records on the PDS
   and the site renders them. (`README.md`, `src/config.js`)

2. **A hand-rolled XRPC client — no SDK for reads.** `src/lib/atproto.js` is a
   "tiny isomorphic AT Protocol client. No SDK — just fetch + JSON," shared by Node
   (build) and the browser (runtime). It speaks `com.atproto.repo.listRecords`,
   `getRecord`, `describeRepo`, `com.atproto.sync.getBlob`,
   `com.atproto.identity.resolveHandle`, and the `app.bsky.*` feed/actor endpoints.

3. **The hybrid data model: build-time snapshot → live PDS hydration.** Every
   record-backed page paints instantly from a static JSON snapshot baked at build
   time (`scripts/prefetch.mjs` → `public/data/*.json`), then re-fetches the same
   data *live from the PDS* in the browser and overlays it. The snapshot is
   explicitly "a fast-first-paint cache and a network-failure fallback — NOT the
   runtime source of truth." Two hydration policies (`live-first` vs
   `snapshot-first`) tune when a snapshot flash is acceptable.
   (`src/lib/snapshot.js`, `src/hooks/useLiveFeed.js`)

4. **The unified feed builder is isomorphic.** `src/lib/feedBuilder.js`
   (`buildUnifiedFeed`) runs the *exact same code* at build time and live in the
   browser — the difference between "the home page is whatever the last build saw"
   and "the home page reflects the PDS as of right now."

5. **Identity resolution from first principles.** `resolvePds(did)` fetches the DID
   document from `plc.directory`, finds the `#atproto_pds` service endpoint, and
   caches it. `resolveIdentifier` accepts a handle, DID, or PDS URL and normalizes
   to `{did, handle, pds}`. The explorer can even read a DID's full identity history
   via the PLC audit log (`/{did}/log/audit`). (`src/lib/atproto.js`)

6. **Records ↔ URLs, both directions.** Routes are generated straight from the verb
   registry, so *both* a friendly gerund URL and the raw lexicon NSID resolve to the
   same record: `/posting/:rkey` **and** `/app.bsky.feed.post/:rkey`, `/logging/:rkey`
   **and** `/is.dame.now/:rkey`. `recordPathFromAtUri()` maps any `at://` URI back to
   its page. The raw NSID is a first-class URL on the site.
   (`src/App.jsx`, `src/lib/recordRoutes.js`, `vercel.json`)

7. **One generic renderer for any record.** `src/pages/Record.jsx` resolves any
   `/:verb/:rkey` live and dispatches to a body renderer by verb; unknown verbs fall
   through to a raw-JSON dump with "Open in explorer" / "Copy AT URI." The page
   footer prints the record's `at://` URI as a link.

8. **PDS-triggered rebuilds.** `/api/rebuild` pings a Vercel deploy hook to
   re-snapshot the PDS; a 6-hour cron is the safety net, and a publishing flow (Apple
   Shortcut) can `curl -X POST` it for near-instant publish. A content-only rebuild
   keeps the same `BUILD_ID` (keyed on the git commit), so refreshing records never
   forces a client reload — only shipping code does. (`api/rebuild.js`,
   `vercel.json`, `src/lib/appVersion.js`)

9. **Freshness comes from the record, not git.** The old GitHub "last commit" footer
   is replaced by each route's backing record's `createdAt`/`updatedAt` — the site's
   freshness signal is now the PDS. (`new_plan.md`, footer components)

---

## 2. A self-authored lexicon family: `is.dame.*`

Inventing a whole namespace of record types is itself the most atmospheric move.
Sixteen schemas live under `lexicons/` (documentation-only; the runtime just reads
JSON). Split into **feed verbs** and **infrastructure** collections.

- **`is.dame.now`** — a status line ("dame.is hiking"). Renders in the chrome bar
  (`NowStatus.jsx`) and as the `/logging` archive.
- **`is.dame.page`** — page copy (title/intro/body) as a PDS record, one per site
  page (literal rkeys: `home`, `blogging`, `curating`…). Falls back to in-repo
  defaults in `src/lib/pageRegistry.js`, so a page can live "local" or "on the PDS"
  transparently — and the admin can migrate one to the other losslessly.
- **`is.dame.profile`** — an extended, long-form bio with labeled links, layered
  *on top of* the Bluesky `app.bsky.actor.profile` rather than replacing it. A
  second, PDS-hosted identity layer only this site knows to read. (`/about`)
- **`is.dame.creating.work`** — portfolio works, whose `content` field deliberately
  borrows Leaflet's block-document format so one renderer covers blogs, portfolio
  docs, and works.
- **The backlinked résumé model** — the cleverest data model in the set
  (`lexicons/RESUME.md`):
  - **`is.dame.resume.job`** / **`is.dame.resume.education`** are *canonical*
    records that own the facts and the achievement bullets (with stable ids and
    forkable phrasing "variants").
  - **`is.dame.resume`** is a *version* that "owns no employment facts of its own —
    it is a curated, ordered view that backlinks to job/education records." Many
    audience-tailored résumés (`/for-hire`, `/resume/:slug`) stay in sync with the
    underlying jobs. The backlink is a **bare `at-uri`, not a `strongRef`**, so a
    résumé always tracks the job's latest version. Field names deliberately echo
    JSON Resume for portability.
- **`is.dame.hero.phrase`** — the homepage's rotating "dame is [role] who [clause]"
  sentence, assembled combinatorially from `role`/`clause` records with per-part
  fallbacks. The site's own identity copy is PDS-hosted, editable data.
  (`HeroSentence.jsx`)
- **`is.dame.arena.channel`** — a thin pointer record (rkey = site slug) that
  publishes an external Are.na channel as a `/curating` gallery.
- **`is.dame.mothing` / `is.dame.observing`** (+ `.observation`) — the
  taxonomy-split iNaturalist mirror (see §3).
- **`is.dame.guestbook` / `is.dame.guestbook.entry`** — the decentralized guestbook
  (see §4).
- **`is.dame.annotating`** — an *aspirational* lexicon: book-style margin notes
  targeting any `at://` URI anywhere in the atmosphere. Schema-only, unrendered — a
  declared primitive waiting for a renderer.

**The verb registry** (`src/lib/verbRegistry.js`) is the spine that makes this
cohere: gerund verbs (`logging`, `posting`, `blogging`, `listening`, `creating`,
`photographing`, `mothing`, `observing`, `liking`, `reposting`, `following`,
`crafting`…), each mapping one or more NSIDs to a `source` network tag, a `kind`
(`content` / `reference` / `appviewFeed`), an icon, and a renderer. Adding a record
type to the whole site is meant to be a one-line change here.

---

## 3. Reading across the whole atmosphere — one life-feed from many apps

The home feed is a single time-ordered timeline that **ingests records from a dozen
different atproto apps' lexicons** and normalizes each into a uniform
`{verb, createdAt, atUri, cid, source, payload}` shape. This is the strongest
demonstration that the site lives *in* the atmosphere, not beside it.

- **Bluesky** (`app.bsky.*`) — posts (`app.bsky.feed.post`, via the AppView author
  feed), likes, reposts (reshaped into full inline post cards), follows, lists +
  list items, and feed generators. Also embeddable inside Leaflet docs.
- **teal.fm** (`fm.teal.alpha.feed.play`) — music scrobbles read from Dame's own
  PDS. Powers the "listening to…" chrome-bar signal (`NowPlaying.jsx`, 30s tick),
  the `/listening` page, and a client-side stats dashboard. Consecutive plays
  collapse into expandable "listening sessions." Album art is resolved through an
  Apple iTunes proxy (`api/albumart.js`, ISRC → Apple id → text search); Apple
  Music / Spotify links derived per play.
- **Leaflet** (`pub.leaflet.*`) — the block-document renderer
  (`LeafletDocument.jsx`) handles text/header/image/website/code/list blocks and
  `bskyPost` embeds, plus byte-offset rich-text facets. It renders both Leaflet docs
  *and* Standard Site docs (which store bodies in `pub.leaflet.content` format).
  `pub.leaflet.comment` records surface as a `commenting` verb.
- **Standard Site** (`site.standard.document` / `.publication`) — Dame's primary
  blog + portfolio record type. A doc's `site` field decides its surface
  (`/blogging` vs `/creating`); `effectiveVerb()` reclassifies by publication
  membership — the record's data, not the code, decides the route.
- **Grain** (`social.grain.*`) — photo galleries and stories, rendered with a
  lightbox (`MediaCard.jsx`), linking out to grain.social.
- **Tangled** (`sh.tangled.*`) — git-forge stars and follows, rendered as reference
  cards linking to tangled.org.
- **Anisota Lab** (`net.anisota.lab.*`, `net.anisota.feed.*`) — a separate atproto
  creative app whose generative pieces (poems, sigils, erasures, inkblots…) are
  re-rendered *faithfully* by porting Anisota's own layout math verbatim
  (`src/lib/anisotaLab.js`), since there's no AppView for its lexicons.
- **iNaturalist mirror** (`is.dame.mothing/observing.observation`) — external nature
  observations copied onto the PDS (see below) and surfaced like native records.

Two mechanisms make the multi-app feed work:

- **Cross-PDS subject hydration** (`src/lib/subjectResolver.js`) — reference records
  (likes/reposts/follows/stars/favorites) are just pointers; a single feed row can
  embed content native to half a dozen apps. Bluesky subjects resolve via batched
  `getPosts`/`getProfiles`; *anything else* (a Grain gallery, a Tangled repo, a
  Leaflet doc) resolves via the universal path: parse DID → resolve PDS via PLC →
  `getRecord`.
- **Comments are real Bluesky replies** — not a bespoke comment store. `Comments.jsx`
  renders the `app.bsky.feed.getPostThread` reply tree, so a reply written in *any*
  Bluesky client shows up as a comment here. Blog posts opt in via a `commentsUri`
  field on the standard-doc.

**The iNaturalist mirror** deserves a callout for its privacy engineering: one
account (`anisota`) is pulled from `api.inaturalist.org`, split by taxonomy (moths =
Lepidoptera minus butterflies → `is.dame.mothing.*`; everything else →
`is.dame.observing.*`), and written to the PDS keyed by iNat id. `src/lib/inaturalist.js`
is the single choke point that strips **all** location signal — coordinates, place
names, and even timezone (times keep the wall-clock but drop the offset, so a record
reveals *when-in-the-day* but never *where*). A 6-hourly cron
(`api/mirror-mothing.js`) runs the incremental sync 10 minutes before each rebuild,
and `liveObservations.js` bridges the gap by borrowing the deterministic `at://` URI
the mirror will assign, so a live sighting merges with — never duplicates — the
record once mirrored.

---

## 4. Writing across the atmosphere — OAuth to the visitor's *own* PDS

The site went from "reads only" to letting anyone write records to their own repo —
without a shared account or a server-side session.

- **Real atproto OAuth in the browser.** `@atproto/oauth-client-browser`, scope
  `atproto transition:generic`, DPoP-bound tokens, public client. Client metadata is
  generated **per host** (`api/client-metadata.js` at `/oauth-client-metadata.json`)
  because the spec requires `client_id` to equal the metadata URL — so `dame.is`,
  `testing.dame.is`, and `*.vercel.app` previews are each independent OAuth clients.
  A visitor authenticates against *their own* PDS. (`src/lib/oauthClient.js`,
  `src/hooks/useAtprotoSession.jsx`)

- **The decentralized guestbook — no database, two lexicons on two repos.** The
  *book* is a singleton on Dame's PDS (`at://…/is.dame.guestbook/self`) that mostly
  exists to be a stable **backlink target**. Each *signature* is an
  `is.dame.guestbook.entry` record written to **the visitor's own PDS** — they keep
  their own words. Reads are assembled live at request time: **Constellation** lists
  everyone who backlinked the book, **Slingshot** hydrates each signer's record, and
  the Bluesky AppView supplies avatars. Ownership is honored by the protocol — a
  signer can delete their own signature and the backlink vanishes; the host can only
  **hide** (an entry `at-uri` added to the book's public `hidden[]` array), so even
  moderation state is a portable public record any renderer can honor. Anyone can
  host their own book with the same two lexicons. (`lexicons/GUESTBOOK.md`,
  `src/lib/guestbook.js`)

- **CMS-less "edit mode."** Because the site *is* the owner's repo, editing the
  website is literally writing records through the OAuth agent. Owner-only edit mode
  makes feed rows selectable, and an inline `RecordEditor` (form or raw JSON,
  including blob uploads to the PDS) writes back via
  `com.atproto.repo.putRecord`/`createRecord`/`deleteRecord`. Guarded so only the
  owner's own records are editable. (`src/hooks/useEditMode.jsx`,
  `src/components/RecordEditor.jsx`)

- **An admin desk over the PDS.** `/admin` is a full CRUD console gated to the owner
  DID — bespoke managers for blogging, creating, listening, publications, the résumé
  studio, site pages, hero-phrase seeding, guestbook moderation, and a legacy-blog
  migration that uploads old Eleventy markdown + images as `site.standard.document`
  records. Every action is a PDS read/write through the OAuth agent. (`src/pages/Admin.jsx`)

---

## 5. Standing on decentralized infrastructure

The site deliberately uses shared, network-wide atproto services instead of running
its own backend:

- **Constellation** (`constellation.microcosm.blue`) — a decentralized **backlink
  index** answering "who across the whole network points at this record?" via
  `blue.microcosm.links.getBacklinks`. Powers the guestbook and the `/exploring`
  backlinks browser. (`src/lib/constellation.js`)
- **Slingshot** (`slingshot.microcosm.blue`) — a network-wide **record edge-cache**
  serving `com.atproto.repo.getRecord` for *any* repo, resolving the DID→PDS hop
  itself — the cheap way to hydrate backlinks pointing at many different PDSes.
  (`src/lib/slingshot.js`)
- **PLC directory** (`plc.directory`) — DID document + PDS resolution, and identity
  history via the audit log.
- **Bluesky AppView** (`public.api.bsky.app`) — profiles, author feed, post threads,
  batched post/profile hydration — all unauthenticated.

Constellation names the records; Slingshot fetches them; the AppView identifies the
authors. Three shared services stand in for a database, an indexer, and an auth
system.

---

## 6. Discoverability & interop — a good atmosphere citizen

The site doesn't just consume the atmosphere; it exposes its own records so other
clients, crawlers, and humans can find and re-render them.

- **Every page advertises its backing record in `<head>`.** `AtUriHead.jsx` injects
  `<link rel="alternate" type="application/at-record+json" href="at://…">` plus
  `<meta name="atproto:uri">` and `<meta name="atproto:cid">` for whatever record
  backs the current view. Because the SPA is JS-rendered, Vercel Edge Middleware
  injects the *same* tags server-side for JS-less crawlers (marked
  `data-atproto="ssr"`, which the client strips on boot to stay the single source of
  truth). (`src/components/AtUriHead.jsx`, `middleware.js`)
- **Standard Site rich embeds.** The middleware also emits
  `<link rel="site.standard.document">` / `rel="site.standard.publication">` tags,
  and `/api/well-known` answers the `/.well-known/site.standard.publication/*`
  verification handshake — so Bluesky renders a dame.is blog/portfolio link as a rich
  "Standard Site" card instead of a plain OG image. (`api/well-known.js`)
- **The Waypoints "Open in…" picker.** Built on `@aturi.to/waypoints`, a global
  capture-phase click listener intercepts any link to a bare `at://` URI or a
  supported atmosphere host and opens a bottom sheet letting the visitor pick *which
  client* opens the record — Bluesky clients for `app.bsky.*`, native readers for
  Leaflet/Standard docs, and app-specific destinations (Grain, Tangled, Streamplace,
  Semble, Margin…) when the record is native to them. The antithesis of a walled
  garden. (`src/lib/waypoints.js`, `src/components/WaypointsSheet.jsx`)
- **`at://` as a first-class link, plus data inspectors.** `AtUriLink` renders any
  URI as a link into the in-site explorer; `AturiActions` adds "Open in…" and
  "Inspect Data" → the aturi.to Atmosphere Explorer raw-record view.
- **`/exploring` — a universal repo/record/backlink browser** for *any* DID,
  collection, or record on the network (not just Dame's), including a Constellation
  backlinks tab and the PLC identity history.
- **The atmosphere debug overlay.** Press `?` on any page to reveal the atproto
  plumbing behind it: route, `at uri`, `cid`, `lexicon` (NSID), resolved `pds`,
  `appview`, and `build`, with copy buttons, "Open in explorer," the raw record JSON,
  and — for the signed-in owner — an inline editor. A built-in record inspector on
  every page. (`src/components/DebugPane.jsx`)
- **OG cards that render atproto metadata.** `/api/og` generates a notebook-layout
  card that prints each surface's **lexicon NSID** as a mono chip; the home card is a
  table-of-contents pairing each surface with its lexicon
  (`site.standard.document`, `fm.teal.alpha.feed.play`, `app.bsky.feed.post`,
  `is.dame.arena.channel`…). (`api/og.js`, `og/records.js`)
- **An iOS home-screen widget that reads the PDS directly.** The Scriptable widget
  (`scripts/scriptable/dame-now-widget.js`) shows the latest `is.dame.now` status
  read straight from the PDS — resolve PDS via `plc.directory`, then
  `com.atproto.repo.listRecords` — with no login and no AppView, "exactly like the
  website does." It can even *write* a new status (app-password session +
  `createRecord`) and ping the deploy hook.

---

## 7. Atmospheric flourishes (thematic, not integrations)

Honest framing: these are on-theme and Bluesky-*adjacent*, but they're not atproto
integrations per se — good to mention as flavor, not as protocol plumbing.

- **The hourly "sky" avatar / favicon / theme.** `src/lib/skyAvatars.js` +
  `skyTheme.js` bundle 24 hourly sky JPEGs and derive an hourly `--sky-*` color
  palette from each frame's gradient. The favicon and PWA icon (`api/favicon.js`)
  render the current Eastern hour's sky tile — **the same art that drives Dame's
  automated, hourly-cycling live Bluesky profile avatar.** So the site's chrome, its
  tab icon, and Dame's atproto identity avatar all track the sun together. The
  connection to the atmosphere is thematic, but the shared avatar art ties it to the
  live Bluesky profile.
- **The pervasive framing itself.** The tagline "An atmospheric website built atop
  the AT Protocol" and nearly every page's own description ("streamed from / drawn
  live from / mirrored from the AT Protocol") state the thesis in-copy.

---

## Quick reference: NSIDs, services, and hosts

| Integration | Key NSIDs | External host(s) | Mode |
|---|---|---|---|
| **Own lexicons** | `is.dame.now`, `.page`, `.profile`, `.creating.work`, `.resume(.job/.education)`, `.hero.phrase`, `.arena.channel`, `.mothing(.observation)`, `.observing(.observation)`, `.guestbook(.entry)`, `.annotating` | (own PDS) | Author + render |
| **Bluesky** | `app.bsky.feed.post/.like/.repost/.generator`, `app.bsky.graph.follow/.list/.listitem`, `app.bsky.actor.profile`, `app.bsky.richtext.facet` | `public.api.bsky.app`, `bsky.app` | Read (AppView + PDS); comments |
| **teal.fm** | `fm.teal.alpha.feed.play` | `itunes.apple.com`, `music.apple.com`, `open.spotify.com` (art/links) | Read own PDS; render |
| **Leaflet** | `pub.leaflet.document/.content/.pages.*/.blocks.*/.richtext.facet#*/.comment` | `leaflet.pub` | Render + migrate + comments |
| **Standard Site** | `site.standard.document`, `site.standard.publication` | `standard.site`, Bluesky embed | Own record type; embed tags; well-known |
| **Are.na** | `is.dame.arena.channel` (own pointer) | `api.are.na/v3` | Pointer records + live fetch |
| **iNaturalist** | `is.dame.mothing/observing(.observation)` (own) | `api.inaturalist.org/v1` | **Mirror** → own PDS (location-stripped) |
| **Grain** | `social.grain.gallery/.story/.favorite/.comment/.graph.follow` | `grain.social` | Read own PDS; render |
| **Tangled** | `sh.tangled.feed.star`, `sh.tangled.graph.follow` | `tangled.org` | Read own PDS; render references |
| **Anisota Lab** | `net.anisota.lab.*`, `net.anisota.spell.custom`, `net.anisota.feed.*` | `anisota.net` | Read own PDS; render (ported math) |
| **Constellation** | `blue.microcosm.links.getBacklinks(Count)` | `constellation.microcosm.blue` | Backlink index (guestbook, explorer) |
| **Slingshot** | `com.atproto.repo.getRecord` (any repo) | `slingshot.microcosm.blue` | Universal record hydration |
| **PLC** | DID doc + `/log/audit` | `plc.directory` | Identity → PDS resolution |
| **Waypoints / aturi.to** | resolver over `at://` + atmosphere URLs | `aturi.to` | "Open in any client" interop |
| **OAuth** | `client_id = /oauth-client-metadata.json`, scope `atproto transition:generic` | `bsky.social` (authz) | Browser writes to visitor's PDS |

*Compiled from a full read of the codebase (`src/`, `api/`, `lexicons/`,
`scripts/`, `middleware.js`, `vercel.json`, `README.md`, `new_plan.md`).*
