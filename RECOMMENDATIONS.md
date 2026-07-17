# dame.is — Codebase, Design, UX & Accessibility Review

_A full-surface review of the site: front-end architecture, the AT-Protocol data
layer, the serverless API, visual design, UX, accessibility, performance,
security, SEO, and project tooling._

**Bottom line:** this is a genuinely well-built codebase — defensively
engineered, tastefully designed, and unusually disciplined for a personal site.
Almost nothing here is a rescue job; it's polish on a strong foundation. The
findings below are ordered so the handful that actually matter (two security
holes, a missing error boundary, a heavy home-feed load, zero tests) sit at the
top, with the long tail of refinements after.

---

## How this review was done

The codebase was surveyed in three passes (front-end, data/API, design system),
then reviewed across eleven dimensions. **Every finding was then independently
re-checked against the source code by an adversarial verifier** whose job was to
refute it. The counts:

| | Findings raised | Confirmed | Severity-adjusted | Refuted |
|---|---|---|---|---|
| Dimension reviews | 103 | 95 | 7 | 1 |
| Completeness critic | 8 | 7 | 1 | 0 |

So **110 verified findings** survive: **16 high, 53 medium, 41 low**. Contrast
ratios were computed from the actual token values; the one refuted claim and the
severity down-grades are noted in the appendix. Line numbers were accurate at
review time (`main` around commit `2f528ba`) and may drift as the code changes.

---

## What's already excellent

Worth stating plainly, because it shapes the recommendations — these are strengths to preserve, not things to touch:

- **Defensive engineering.** Dual stale-shell recovery nets (`index.html` boot
  script + `api/asset-recovery.js`) share a one-shot `_r` loop-guard so a deploy
  can never white-screen or reload-loop. The auto-updater keys reloads to the
  target build id and clears its marker only after a successful run.
- **Privacy by design.** A single choke point strips all iNaturalist location
  data (`src/lib/inaturalist.js`); guestbook geolocation is blurred to ~11 km and
  coarse-labeled client-side. The gap is _disclosure_, not behavior (see §10).
- **Token-driven design system.** Every color across ~15 k lines of CSS resolves
  through the semantic roles in `src/styles/theme.css` — grep finds zero stray
  `#fff`/`rgba(255…)` outside the deliberate print remap. Spacing rides
  `--space-*` almost universally; motion is one 120 ms voice.
- **Accessibility habits are real.** Icon-only buttons carry state-aware
  `aria-label`s with `aria-expanded`/`aria-controls`; `prefers-reduced-motion` is
  honored in all 8 CSS keyframes and all 16 `motion/react` consumers; landmarks
  and per-route titles are in place. The gaps below are specific, not systemic.
- **One honest data abstraction.** `useLiveFeed` gives every page the same
  snapshot-first/live-first strategy with an explicit `stale` status and degraded
  "snapshot from HH:MM" disclosure. `scripts/prefetch.mjs` imports the _same_
  `feedBuilder.js` the browser runs, so build-time and runtime shaping can't drift.
- **AT-Protocol discoverability** — server-injected `atproto:uri`/`cid` and
  Standard Site link tags for JS-less crawlers, stripped on boot so the client
  stays the single source of truth — is a genuine differentiator.

---

## Priorities at a glance

**P0 — do first (security + site-breaking):**

| # | Item | Where | Effort |
|---|---|---|---|
| 1 | SSRF: `/api/unfurl` & `/api/image-proxy` fetch any URL, unauthenticated | `api/unfurl.js`, `api/image-proxy.js` | S–M |
| 2 | `/api/arena` lends the owner's are.na token to any caller (reads private channels) | `api/arena.js` | S |
| 3 | Stored XSS: facet/embed `href` rendered with no scheme allowlist | `src/lib/postRichText.jsx` +2 | S |
| 4 | No error boundary — a render throw or rejected lazy import blanks the whole SPA | `src/App.jsx` | S |
| 5 | Meta injection corrupts `<head>` when record text contains `$` | `middleware.js:88` | S |

**P1 — high impact:**

| # | Item | Where | Effort |
|---|---|---|---|
| 6 | Home first paint pulls an uncacheable **5.9 MB** feed snapshot | `src/pages/Home.jsx`, `src/lib/snapshot.js` | M |
| 7 | Home rebuilds the entire feed (~45 requests) every 30 s, no resolver reuse | `src/pages/Home.jsx`, `feedBuilder.js` | M |
| 8 | Main bundle (358 KB gz) eagerly ships the OAuth stack to every visitor | `src/lib/oauthClient.js` | M |
| 9 | Transient fetch failures render as permanent "not found" (breaks shared links) | `src/pages/Record.jsx` +3 | S |
| 10 | Mirror advances its sync cursor before writes succeed → silent data gaps | `src/lib/inaturalistMirror.js` | S |
| 11 | Focus is never trapped/restored in any dialog or sheet | `BottomSheet.jsx`, `Modal.jsx` +2 | M |
| 12 | Sub-AA text contrast: `--ink-faint`, sky-theme hours, accent-fill buttons | `theme.css`, `skyTheme.js`, `app.css` | S–M |
| 13 | Focus indicators suppressed site-wide (`outline:none` + hover-identical) | ~30 CSS rules | M |
| 14 | On-screen keyboard occludes bottom-anchored input sheets | `BottomSheet.css` +3 | M |
| 15 | No robots.txt / sitemap.xml; both URLs serve the SPA shell | `scripts/prefetch.mjs`, `vercel.json` | M |
| 16 | Zero tests for a 58 k-line codebase | `package.json` | M |

**P2** is the rest — grouped by area below.

---

## 1. Security

Core trust model is sound: OAuth scopes are narrowed correctly (visitors get
only `repo:is.dame.guestbook.entry`, `scopeForAccount` fails safe to the narrow
scope), foreign guestbook fields render as auto-escaped JSX children, and record
SVGs are sandboxed through `sanitizeSvgDocument` + `<img>` data URLs. The issues
are at the server edge and in rich-text `href` handling.

### 1.1 SSRF in `/api/unfurl` and `/api/image-proxy` — **high**
`api/unfurl.js:41` and `api/image-proxy.js:18` both fetch a caller-supplied
`?url=` server-side with `redirect: 'follow'` and only a `^https?://` gate — no
host allowlist, no private/link-local/metadata-IP blocking, no auth. `unfurl`
then **returns** the fetched `og:*` content to the caller, so
`GET /api/unfurl?url=http://<internal-host>/` discloses internal responses; both
are open proxies usable for bandwidth laundering.
**Fix:** add a shared guard that resolves the hostname and rejects
loopback/private/link-local/reserved ranges (`127/8`, `10/8`, `172.16/12`,
`192.168/16`, `169.254/16`, `::1`, `fc00::/7`) **before** fetch _and after each
redirect_ (use `redirect:'manual'` and re-validate). These endpoints are
owner-facing (block editor) — you can also require a session or same-origin
`Origin`. _Effort: small–medium._

### 1.2 `/api/arena` lends the owner's are.na token to any caller — **high**
`api/arena.js:31-33` attaches `Authorization: Bearer <ARENA_ACCESS_TOKEN>` to any
`?path=/channels/…` request, with no caller auth and no restriction to the
channels the site actually mirrors, then edge-caches results for 15 min. The path
is scoped to `/channels/` on `api.are.na` (good), but the token authenticates _as
the account_, so anyone can use dame.is as an authenticated are.na relay —
**including reading the owner's private channels**.
**Fix:** restrict the proxy to an allowlist of the channel ids/slugs actually
mirrored (known from `is.dame.arena.channel` records), and/or strip the token for
any channel not in that list. Add a same-origin check as a second layer.
_Effort: small._

### 1.3 Stored XSS via unrestricted facet/embed `href` — **high**
`src/lib/postRichText.jsx:100` renders a link facet as
`<a href={feature.uri}>` with no scheme check. This path renders **foreign**
content — replies from arbitrary Bluesky users in `Comments.jsx` — so a reply
whose facet carries `uri:"javascript:…"` produces an executable link (React does
not strip `javascript:` hrefs). Same pattern in `src/lib/leafletRichText.jsx` and
`src/components/PostEmbed.jsx`.
**Fix:** add a `safeHref(uri)` helper that returns the URI only for an allowlist
of schemes (`http`, `https`, `mailto`, `at`) and route every facet/embed href
through it — mirroring what bsky.app does. _Effort: small._

### 1.4 Meta injection via `$` replacement patterns — **high** (also SEO)
`middleware.js:88` and the `<title>` swap at `:222` pass record-derived text as
the _replacement string_ of `String.replace`. `escapeAttr` escapes `& " < >` but
not `$`, so a title like `How I saved $1,000` expands `$1`/`$&` patterns and
corrupts the emitted `<head>` for crawlers.
**Fix:** use a replacer **function** (`(m,p1,p2) => p1+esc+p2`) or pre-escape `$`
as `$$` before both replaces. _Effort: small._

### 1.5 `/api/rebuild` unauthenticated; mirror crons fail-open — **medium**
`api/rebuild.js:6` triggers a production deploy with no auth — anyone can spam
unlimited rebuilds. The mirror endpoints only enforce `CRON_SECRET` _if it's
set_, so a missing secret silently disables the gate.
**Fix:** require the shared secret on `rebuild` (Vercel sends it for cron
invocations; put it in the Shortcuts request too); treat a missing `CRON_SECRET`
as a hard misconfiguration (500), not fail-open. _Effort: small._

### 1.6 No security response headers — **medium**
`vercel.json` sets no CSP, `X-Frame-Options`/`frame-ancestors`,
`X-Content-Type-Options`, or `Referrer-Policy`.
**Fix:** add a `headers` block (or set them in middleware for HTML) with at least
a CSP scoped to the origins actually used (self + fonts), `frame-ancestors`,
`nosniff`, and `strict-origin-when-cross-origin`. Roll CSP out in report-only
first. _Effort: medium._

### 1.7 Markdown → `dangerouslySetInnerHTML` unsanitized — **medium**
`src/lib/markdown.js:18` returns `marked.parse(...)` injected via
`dangerouslySetInnerHTML`. Today every input is the owner's own PDS content, so
this is latent — but it's one lexicon away from rendering foreign markdown with
no defense.
**Fix:** run output through DOMPurify before injecting (belt-and-braces even for
owned content), or keep it owner-only and document the invariant loudly.
_Effort: small._

### 1.8 `/api/og` is an unauthenticated denial-of-wallet + spoofing surface — **low**
`api/og.js` runs CPU-heavy Satori image generation on any request (`:37`) and
renders arbitrary `?title=/?subtitle=/?label=` into dame.is-branded 1200×630
cards (`:94`) — a content-spoofing vector.
**Fix:** the hourly cache blunts cost; additionally clamp/validate params to the
known pages/records and cap text length. _Effort: small._

---

## 2. Accessibility — structure, semantics & keyboard

Strong baseline (landmarks, state-aware button labels, alt-text piped end to
end). The material gaps are in overlays and screen-reader signaling.

### 2.1 No focus management in any dialog or sheet — **high**
`BottomSheet.jsx:85` declares `role="dialog"` with only an Escape listener;
`Modal.jsx:145` goes further to `aria-modal="true"` while the page behind stays
fully tabbable — a false inertness claim. None of BottomSheet, Modal, ActionDock,
or EditSheet moves focus in on open, traps Tab, or restores focus to the trigger
on close.
**Fix:** one shared focus hook — save `activeElement`, focus the panel (or first
control) on open, trap Tab while open, restore on close. You already use `inert`
in `ChromeBar.jsx`, so the primitive is in hand. _Effort: medium._

### 2.2 Route changes are silent to screen readers; no skip link — **medium**
`RouteTransition.jsx:28` only scrolls on navigation — no focus move or
announcement — and there's no skip link (chrome tab stops precede `<main>`).
**Fix:** on pathname change, move focus to the route container (`tabIndex={-1}`)
or announce the new title in a polite live region; add a visually-hidden
"Skip to content" link as the first focusable element. _Effort: small._

### 2.3 Form errors / async status have no live regions — **medium**
`GuestbookSignForm.jsx:124` renders errors as bare `<p>`; the success note and
remaining-count are plain spans (same in `SignInPanel`, `GuestbookSheet`).
**Fix:** `role="alert"` on error text, `role="status"` on the success note,
polite live region on the count. _Effort: small._

### 2.4 Lightbox controls portalled outside the `aria-modal` dialog — **medium**
`Lightbox.jsx:145` portals prev/next/close to `document.body` as a sibling of the
Modal dialog, so they fall outside the modal's accessibility subtree.
**Fix:** render controls inside the dialog element (a `position:fixed` child that
stays in the dialog subtree). _Effort: medium._

**Low (structure):** Home nests `<li>` inside `<li>` (`Home.jsx:634` — unique to
Home); owner edit rows use `role="button"` without key handlers
(`FeedItem.jsx:275`); `SkyHourSheet` misuses `role="tablist"` without the tabs
keyboard pattern (`:60`); single-key shortcuts `i`/`?` can't be disabled
(`useXray.jsx:88`); `aria-label` on generic `<span>` where it's ignored
(`ChromeBar.jsx:783`); ledger observation lightbox opens only on mouse row-click
(`FeedItem.jsx:188`).

---

## 3. Accessibility — visual & motion

Reduced-motion coverage is near-total and rem-based type respects zoom — the
gaps are contrast and focus visibility.

### 3.1 `--ink-faint` fails contrast at the 12 px sizes it's used for — **high**
`theme.css:16` light `#9d9784` on `#f1ead4` = **2.43:1**; dark = 2.69:1; the code
comment itself targets "faint ~3.3:1+", i.e. deliberately below AA. Yet it colors
real 12 px content: feed verb badges, timestamps, chrome labels, footer.
**Fix:** re-tune `--ink-faint` per theme to ≥4.5:1 at `--text-xs` (light ≈
`#7d7663`, dark ≈ `#8a8168`), or split the role — decorative faint for rules,
`--ink-muted` for any text. _Effort: small._

### 3.2 Focus indicators suppressed site-wide — **high**
~30 rules pair `:focus-visible` with `outline:none` and reuse the exact `:hover`
styling (a 1 px border flip or color change) — e.g. `ChromeBar.css:311`,
`SearchSheet.css:77`, `Feed.css:368`, `ActionDock.css:206`. Keyboard users can't
tell where focus is. Notably, image triggers already do it right
(`outline:2px solid var(--accent)`), so the pattern exists.
**Fix:** one global `:focus-visible { outline:2px solid var(--accent);
outline-offset:2px }` in `reset.css`; delete the per-component `outline:none`.
Square outlines suit the zero-radius aesthetic. _Effort: medium._

### 3.3 Sky-theme derivation drops text below AA at several hours — **medium** _(adjusted down from high)_
`skyTheme.js` computes per-hour palettes with no contrast floor in
`buildBaseVars`. The live `is.dame.sky` tuning record fixes the worst shoulder
hours, but even with it applied several hours still fail (8am faint 3.31:1 /
accent-soft 1.65:1; 6am & 8pm faint ~2.5:1; midday accent-fill 4.2–4.3:1). On
first paint before the async override loads, more hours fail.
**Fix:** add a post-derivation contrast pass that measures each ink/accent step
against its surface and darkens/lightens until it clears the target. _Effort: medium._

### 3.4 Accent-fill buttons drop text below 4.5:1 (2.4:1 on hover) — **medium**
`app.css:236` `.home-hero-cta-primary` is `--page` text on `--accent` fill at
`--text-sm` = 4.01:1 resting, **2.40:1 on hover** (hover _lightens_ to
`--accent-soft`). Same in `ChromeBar.css:547`, `Lightbox.css:177`.
**Fix:** nudge `--accent` slightly darker so small text clears 4.5:1, and make
hover _darken_ (`color-mix(... 85%, #000)`) not lighten. _Effort: small._

### 3.5 28 px primary touch targets in the fixed bottom bar — **medium**
`ChromeBar.css:480` — the primary mobile nav chips are 1.75 rem, below the 44 px
platform minimum, at the screen edge. (Also raised under §5.)
**Fix:** keep the 28 px visual chip, extend the hit area to ≥44 px on coarse
pointers via a transparent `::before { inset:-8px }`. _Effort: small._

### 3.6 Globally hidden scrollbars remove the only scroll affordance — **medium**
`reset.css:30` suppresses scrollbars on `*`, so inner overflow regions give no
hint they scroll.
**Fix:** scope suppression to `html`/`body`; let inner scroll containers keep
`scrollbar-width: thin`. _Effort: small._

**Low (visual):** sub-12 px interface labels compound the faint-ink deficit
(`ChromeBar.css:536`); status marquee has no pause for touch users (`:733`);
destructive-hover uses hardcoded `#c17d3f` at 2.36:1 (`NavMenuPanel.css:136`).

---

## 4. UX — flows & states

Loading states are real shape-matched skeletons, degraded data is honestly
disclosed ("snapshot from HH:MM"), and the OAuth→guestbook round-trip preserves
intent. The gaps are error handling and a few silent failures.

### 4.1 Transient failures render as permanent "not found" — **high**
`Record.jsx:141` admits it: a network blip sets `missing=true`, so an existing
record shows "Record not found" — fatal for shared/OG links, which then look
dead. Same conflation in `BlogPost.jsx`, `CreatingWork.jsx`, and empty-state
branches on index pages.
**Fix:** only claim "not found" on a definitive 4xx/`RecordNotFound`; otherwise
show "couldn't load right now" with the URL intact and a retry. `CuratingChannel`
already threads this distinction — copy it. _Effort: small._

### 4.2 Error boundary (see §7.1) — **high**

**Medium:** terminal error states have no retry (`Guestbook.jsx:183`); guestbook
"remove" / "Earlier signatures" fail silently (`GuestbookEntryRow.jsx:55`); sheet
dismissal destroys in-progress drafts with no confirm (`BottomSheet.jsx:62`);
profanity auto-hide says "Signed." then silently hides the entry from its author
(`GuestbookSignForm.jsx:50`); back-nav loses scroll position on live-first feed
pages (`useLiveFeed.js:53`).

**Low:** "scroll to bottom" fights the infinite-scroll sentinel and lands mid-feed
(`ChromeBar.jsx:550`); guestbook allows submitting over the char limit
(`:35`); OAuth callback can dead-end on "Completing the handshake…"
(`OauthCallback.jsx:38`); orphaned `?q=` filters feeds with no visible clear
(`ChromeBar.jsx:40`); bulk delete hides records even when deletion failed
(`EditModeBar.jsx:160`).

---

## 5. Responsive & mobile

Overlay sizing (`100dvh` minus measured chrome, `overscroll-behavior:contain`,
scroll-chain prevention) and overflow defense are exemplary. Two real gaps:

### 5.1 On-screen keyboard occludes bottom-anchored input sheets — **high**
Every input sheet is `position:fixed` to the viewport bottom
(`BottomSheet.css:23`). The guestbook sheet (the primary visitor CTA) puts a
textarea there; `SearchSheet` even auto-focuses — so the mobile keyboard covers
the field.
**Fix:** track `window.visualViewport` while an input sheet is open and translate
it above the keyboard, or add `interactive-widget=resizes-content` to the viewport
meta. _Effort: medium._

### 5.2 `viewport-fit=cover` missing → all safe-area insets resolve to 0 — **medium**
`index.html:54` omits `viewport-fit=cover`, so every `env(safe-area-inset-*)` in
the CSS is a no-op on notched devices.
**Fix:** add it and verify the bottom bar / lightbox controls clear the home
indicator in a standalone install. _Effort: small._

**Medium:** bottom toolbar row can overflow narrow phones with no wrap/scroll
(`ChromeBar.css:637`); 28 px touch targets (§3.5). **Low:** iOS input-zoom guard
is width-gated at 700 px and misses landscape (`app.css:35`); hover-only reveals
leave truncated chrome text unreachable on touch (`TickerText.jsx:121`).

---

## 6. Performance

Real craft already: `@atproto/api` and the admin/explorer are lazy; images carry
`loading=lazy`/`decoding=async` with reserved boxes; one shared 30 s tick drives
all live surfaces; serverless cache headers are tiered. The costs concentrate on
the home feed and the eager bundle.

### 6.1 Home first paint pulls a 5.9 MB uncacheable snapshot — **high**
`Home.jsx:75` → `fetchSnapshot('unifiedFeed')` fetches `/data/unifiedFeed.json`
with `cache:'no-store'` (`snapshot.js:42`): **5.9 MB raw / ~1.04 MB gzip**,
never cached or 304-revalidated, while the page renders ≤100 items. The snapshot
_is_ used for instant first paint (so it's not discarded), but it's built at full
registry caps (500/collection).
**Fix:** have `prefetch.mjs` emit a trimmed home seed (~100–150 items) plus
precomputed per-verb counts; drop `no-store` so the ETag can serve 304s.
_Effort: medium._

### 6.2 Home rebuilds the whole feed every 30 s, no resolver reuse — **high**
`Home.jsx:394` re-runs `buildUnifiedFeed` on the shared tick: ~1 `getAuthorFeed`
+ ~27 `listRecords` + hydration + iNaturalist, **per tick**. Worse,
`feedBuilder.js:568` builds a _fresh_ `createSubjectResolver` each time because
Home passes none, so hydration caching never carries across ticks.
**Fix:** create one module-level resolver and pass it via
`options.subjectResolver`; lengthen the feed poll to 2–5 min (keep 30 s for
NowPlaying/NowStatus); short-circuit with the existing `getLatestCommit` repo-rev
check before rebuilding. _Effort: medium._

### 6.3 Main bundle eagerly ships the OAuth stack to every visitor — **high**
The entry chunk is **358 KB gzip**; a sourcemap breakdown shows it's mostly the
OAuth tree (zod, jose, `@atproto/oauth-*` ≈ 620 KB source) because
`oauthClient.js:8` does a static `import` and the session provider inits at App
mount — for a capability only the owner and guestbook signers use.
**Fix:** convert `getOauthClient()` to `await import('@atproto/oauth-client-browser')`
(mirroring the Agent pattern), gate startup `init()` on a cheap localStorage
"has-session" hint, and dynamically import `obscenity` from the guestbook read
path. _Effort: medium._

**Medium:** live-first pages fetch their full snapshot in parallel and `no-store`
defeats caching (`useLiveFeed.js:57`); brand-mark sky avatars are 893×892 JPEGs
(287–462 KB) shown at ~20 px (`skyAvatars.js:17` — pre-gen small variants with
`sharp`); render-blocking Google Fonts loads 5 families for a 2-family theme
(`index.html:86`); 100+ non-memoized `motion.li` cards, no windowing
(`Home.jsx:634`); bottom-bar counter runs `getBoundingClientRect` on every
`.feed-item` per scroll frame (`ChromeBar.jsx:1150`); Listening blocks on 10
sequential `listRecords` round-trips (`Listening.jsx:30`). **Low:** lazy
highlight.js pulls `lib/common` (every grammar) (`LeafletDocument.jsx:352`).

---

## 7. React architecture & code quality

Context providers are memoized with fail-fast consumer hooks; async-effect
hygiene (cancellation, observer/timer cleanup) is near-perfect; the latest-value-
ref pattern is used deliberately. Issues are resilience and a few duplication
hotspots.

### 7.1 No error boundary anywhere — **high**
Grep finds no `ErrorBoundary`/`componentDidCatch` in `src/`. Every route —
including record routes fed by arbitrary live PDS data — renders in one
unprotected tree. _(Adjusted note: stale post-deploy chunk hashes are handled by
`asset-recovery.js`, so that specific trigger is covered — but any render throw,
or a genuinely rejected dynamic import, still blanks the page.)_
**Fix:** a top-level `ErrorBoundary` rendering a "something broke — reload" card
with the chrome alive, plus one wrapping each lazy `Suspense`. _Effort: small._

### 7.2 Owner deletes leave stale rows on /posting and /logging — **medium**
`Posting.jsx:36` and `Logging.jsx` don't filter `removedUris` the way
Home/Listening do, so just-deleted records linger until refresh.
**Fix:** centralize into a `useVisibleFeedItems(items)` hook applied everywhere.
_Effort: small._

### 7.3 Duplication hotspots — **medium**
`at://` URI parsing is re-implemented in ~14 files with behavioral drift
(`atproto.js:292`) — export one `atUriParts`/`ownerDidFromAtUri` and delete the
copies. Admin `RecordList` and `ListeningManager` duplicate pagination +
multi-select + bulk-delete wholesale (`Admin.jsx:1192`) — extract
`usePagedRecords` + `useRkeySelection`. `eslint-disable react-hooks` comments
exist but no linter runs (§11).

**Low:** EditMode context is a god-object every FeedItem subscribes to
(`useEditMode.jsx:173`); `RecordEditor` JSON field rewrites the textarea
mid-typing (cursor jump) (`:783`); six independent scroll listeners in ChromeBar
with an un-broken per-frame walk (`:1150`); three competing "saved/copied" flash
timer patterns that leak across unmount (`RecordEditor.jsx:281`); Admin uses
`window.location.assign` for in-app nav, forcing full reloads (`:1439`);
`HeroSentence` measures every A×B phrase combination (`:232`).

---

## 8. Data-layer robustness

Thoughtful merge model, timestamp-aware ordering (with documented rationale for
mixed offsets), versioned caches, and tiered guestbook degradation. Gaps are in
failure semantics.

### 8.1 Mirror advances its sync cursor before writes succeed — **high**
`inaturalistMirror.js:196` puts the two summary records (carrying
`lastSyncedAt`/`syncTotalCount`) **first** in the write batch and stamps them from
the live signature before any observation record is written. If later writes in
the pool fail, the freshness marker has already advanced past data that never
landed — those observations are silently skipped on every future incremental run.
**Fix:** write observation records first, summaries last, and only advance the
marker when `fail === 0` (otherwise keep the prior marker or record failed ids to
re-pull). _Effort: small._

### 8.2 Snapshot-fallback / error results cached as fresh live data — **medium**
`Home.jsx:329` writes the feed cache even when data came from the snapshot
fallback or an error path, so `isCacheFresh` later treats degraded data as a good
live result.
**Fix:** only `writeFeedCache` on a successful live fetch, or tag
`source:'fallback'` and treat it as not-fresh. _Effort: small._

### 8.3 Prefetch has no retry; transient failures ship empty snapshots — **medium**
`prefetch.mjs:74` — a transient upstream failure can write an empty snapshot
marked `ok:true`, serving thin content for up to 6 hours.
**Fix:** retry-with-backoff (2–3 attempts) around `fetchJson`, and compare counts
against a sanity floor (or the deployed snapshot) before overwriting; fail the
build on gross under-count. _Effort: medium._

### 8.4 No request timeouts in the data layer — **medium**
`atproto.js:5` — a hung fetch permanently wedges Home's refresh loop with no
timeout anywhere.
**Fix:** thread `AbortSignal.timeout(15_000)` through `fetchJson`/`listRecords`/
`getAuthorFeed`; add a watchdog in Home's refresh. _Effort: medium._

**Also:** `/api/rebuild` abuse (§1.5). **Low:** Home's memoized snapshot promise
never retries after a miss, contradicting its own comment (`Home.jsx:74`);
auto-update loop-guard silently disables itself when `sessionStorage` is
unavailable (`useAutoUpdate.js:71`); album-art cache never prunes stale entries
(`albumArt.js:59`).

---

## 9. Visual design consistency & CSS architecture

The token system is a real strength; these are drift and dead-token cleanups that
keep it honest.

### 9.1 Undefined `--text-md` flattens h4–h6 in documents — **medium**
`LeafletDocument.css:42` uses `var(--text-md)`, which isn't defined in
`theme.css`, so those headings fall back to inherited size.
**Fix:** use `--text-lg`/`--text-base`, or define `--text-md`. _Effort: small._

### 9.2 Hairline control primitive re-implemented ~60× across 28 files — **medium**
The same bordered button/chip is hand-rolled everywhere with drifting hover
washes (`Lightbox.css:153` +27 files).
**Fix:** extract one `.ctl` class (with filled/primary modifiers) into
`styles/controls.css`, or at minimum tokenize the hover wash
(`--control-hover-bg`). _Effort: medium._

### 9.3 Phantom surface tokens silently no-op — **medium**
`blocks.css:153` references `--surface-soft`/`-2`/`-3`, which aren't defined.
**Fix:** map them to real `color-mix` washes in `theme.css`, or delete.
_Effort: small._

### 9.4 `Feed.css` is a 2081-line shared library wired by import side effects — **medium**
Pages get shared feed/reveal styles only because they happen to import
`Feed.css`.
**Fix:** split into co-located per-card files, or promote the genuinely shared
layer to `src/styles/` imported once. _Effort: large (do incrementally)._

**Low:** unused Google Font families in the `<head>` request (`index.html:86` —
_adjusted: the URL is dead config but the woff2 binaries aren't fetched_);
raised-surface ink re-tune misses the dock/sheets it targets (`theme.css:207`);
33 font-sizes bypass the scale, some below `--text-xs` (`Xray.css:166` —
_adjusted from "48"_); untokenized destructive color (`NavMenuPanel.css:136`);
two circular avatars in an all-square system (`Feed.css:1069`); ad-hoc responsive
cutoffs in mixed units, no breakpoint tokens (`StateStats.css:299`); global
`.lucide` stroke override kills per-icon weights (`app.css:26`).

---

## 10. SEO, meta & sharing

The crawler story is unusually thoughtful (per-route middleware cards, dynamic
OG, Standard Site tags, ~20 legacy 301s). The gaps are discoverability basics.

### 10.1 No robots.txt / sitemap.xml; both serve the SPA shell — **high**
No `public/` static dir exists, and the catch-all rewrite (`vercel.json:23`)
serves `index.html` (HTTP 200, `text/html`) at `/robots.txt` and `/sitemap.xml`.
**Fix:** add static `public/robots.txt` (allow all; disallow `/admin`, `/oauth/`,
`/api/`; `Sitemap:` line) and generate `public/sitemap.xml` in `prefetch.mjs` from
the snapshots it already loads. _Effort: medium._

### 10.2 Meta injection `$`-corruption — **high** (see §1.4)

**Medium:** soft 404s — unknown routes and missing records return HTTP 200
(`vercel.json:23`; inject `noindex`/404 in middleware when `recordMeta` fails); no
`rel=canonical` while each record has 2–3 live URLs (`middleware.js:224`); blog
has no RSS/Atom feed (`Blogging.jsx:62` — emit `public/feed.xml` in prefetch and
advertise via `<link rel=alternate>`); middleware matcher misses many shareable
routes → generic home card (`:50`); crawlers see no body content, only head meta
(`index.html:91` — large; consider injecting a minimal SSR article body for
`/blogging/:slug`). **Low:** no JSON-LD / article OG semantics for posts
(`middleware.js:226`).

---

## 11. Tooling, testing & project health

Build identity is thoughtfully commit-keyed, snapshots are self-describing, the
data layer is isomorphic and testable. The gaps are the usual quality-gate
absences.

### 11.1 Zero tests for 58 k lines — **high**
No test files, framework, or `test` script. `src/lib` is full of pure,
deterministic logic where regressions are silent — `dayOfLife.js`'s own header
documents a past off-by-one bug class.
**Fix:** add vitest (drop-in for Vite). Start with the highest-leverage pure
modules: `dayOfLife`, `time` (relative/group/compare), `threadGrouping`,
`inaturalist` classification, `feedBuilder` merge/dedup. _Effort: medium._

### 11.2 Add ESLint (react-hooks) + Prettier — **medium**
No lint/format config exists, yet `eslint-disable react-hooks` comments do —
dead annotations documenting exceptions no tool enforces.
**Fix:** flat-config ESLint with `react`/`react-hooks`, Prettier, a `lint`
script, and a CI job (below). _Effort: small._

### 11.3 Replace dead CI; add a real check — **medium**
`.github/workflows/rss.yml` and `versioning.yml` are Eleventy-era and reference
files that no longer exist; nothing validates a build.
**Fix:** delete them; add one workflow running `npm ci && npm run build:offline`
(+ lint/test once they exist). _Effort: small._

### 11.4 Dependency hygiene — **medium**
`npm audit` reports 4 fixable vulns (`npm audit fix`, no code changes — bumps
`react-router-dom`/`vite`). Core `@atproto/*` packages are a breaking minor-line
behind (`api` → 0.20.x, `oauth-client-browser` → 0.4.x) — upgrade together and
retest OAuth + record CRUD. `lucide-react` is pinned very old (`^1.x`).

### 11.5 Add a type layer incrementally — **medium**
**Fix:** `jsconfig.json` with `checkJs` scoped to `src/lib` (or per-file
`// @ts-check`) plus JSDoc `@typedef`s for the core record/feed-item shapes —
editor-time checking, zero build change, before considering full TS.

**Low:** README architecture table points at files that no longer exist
(`README.md:132`); add `.env.example` (~20 env vars across `api/`, `scripts/`,
`arena-mirror/`; several look like drifted aliases); pin Node (`engines` +
`.nvmrc`); add a cheap snapshot-degradation guard so thin builds are visible
(`prefetch.mjs:74`).

---

## 12. Cross-cutting gaps (completeness pass)

- **Admin editor ships in every visitor's bundle — medium.** `App.jsx:33`
  eagerly imports `EditModeBar`/`EditSheet`, and `EditSheet.jsx:10` statically
  imports `RecordEditor` — contradicting the documented lazy-loading intent that
  keeps it out of `Exploring`. Dynamically import `RecordEditor` inside its
  consumers or gate on the owner session. (Overlaps §6.3.)
- **PWA is advertised but has no offline behavior — medium.** `manifest.js:22`
  declares `display:standalone` and `index.html` carries install hints, but
  there's no service worker — installs break with no network.
  Add a minimal precache SW (e.g. `vite-plugin-pwa`) or drop the standalone hints.
- **Print styles only on the resume — medium.** Only two `@media print` blocks
  exist; the black-ink remap is scoped to `.resume`, so every other page prints
  near-invisible light ink at dark sky hours. Move the remap to `:root`/`body`
  inside `@media print` and add page-break rules.
- **Guestbook trust boundary — medium.** Foreign records render unclamped fields
  (`GuestbookEntryRow.jsx:117`; lexicon caps not enforced at hydration),
  `signGuestbook` never validates `location` length, and moderation can hide
  individual records but not block a signer. Clamp at hydration, validate
  `location`, add a `hiddenDids` blocklist to the book.
- **No privacy disclosure — low.** `@vercel/analytics` mounts unconditionally
  (`App.jsx:179`), guestbook geolocation calls `bigdatacloud.net`, and Google
  Fonts is third-party — with no privacy note. Behavior is privacy-conscious; the
  gap is disclosure. Add a short privacy blurb (the `/sharing` ethos page is a
  natural home).
- **are.na mirror captures no license/attribution — low** _(adjusted: creator &
  source metadata _are_ captured; license/rights aren't, and attribution isn't
  rendered)_. Capture rights where are.na exposes them and surface attribution in
  the curating UI.

---

## Suggested sequencing

1. **This week (small, high-value):** §1.1–1.4 security, §7.1 error boundary,
   §4.1 not-found conflation, §8.1 mirror cursor, §10.1 robots/sitemap,
   §11.4 `npm audit fix`. Nearly all are small.
2. **Next (high-impact, medium):** §6.1–6.3 home-feed weight + bundle,
   §2.1 focus management, §3.1–3.2 contrast + focus visibility, §5.1 keyboard
   occlusion, §11.1 vitest on `src/lib`.
3. **Then (polish, ongoing):** the medium/low tail — CSS control primitive,
   duplication extraction, SEO refinements (canonical, RSS, soft-404), print
   styles, PWA decision, ESLint/CI, type layer.

A lot of the high items are one-file, small-effort fixes — the ratio of impact to
effort here is unusually good because the foundation is already solid.

---

## Appendix — methodology & caveats

- **Process:** 3 survey agents → 11 dimension reviewers (103 findings) → 1
  adversarial verifier per finding (batched) → completeness critic (8 gaps) →
  its own verification. Refuted findings were dropped; severity down-grades and
  correction notes are folded in above and flagged _(adjusted)_.
- **The one refuted finding:** "guestbook moderation handlers have no error
  handling" — refuted because the only call site (`GuestbookEntryRow.jsx`) already
  wraps them in `try/catch` and surfaces the error.
- **Not independently runtime-tested:** contrast ratios were computed from token
  values and bundle sizes read from a production build; behavioral findings were
  traced through the code, not reproduced in a live browser session. Spot-check
  the high-severity items against the running site before acting.
- **Line numbers** reflect `main` near commit `2f528ba` and will drift.
- **What this review did _not_ cover:** the Apple Shortcuts / Scriptable widgets
  (`scripts/scriptable/`), the standalone `arena-mirror/` sub-package internals
  beyond its security surface, and lexicon schema design (the schemas are
  documented and were treated as contracts).
