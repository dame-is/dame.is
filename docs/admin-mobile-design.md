# The phone admin

**Design for `/admin` below `60rem`. Replaces §8 (MOBILE) of `docs/admin-rebuild-spec.md`.**

Status: design, not built. Written against the build measured on 2026‑08‑15 at 390×844 and
320×568 through the harness. Every "today" number below is measured, not estimated.

The design language does not change: serif everywhere, zero border-radius, small-caps
letterspaced labels, IBM Plex Mono for rkeys and at-uris, colours from `theme.css` tokens only.
No new dependencies — `motion`, `lucide-react`, `useFocusTrap`, `usePreventScrollChain` and
`useKeyboardInset` are all already in the tree. Nothing outside `src/admin/**` and the studio
components changes behaviour on a public route.

---

## 0. The frame, and the numbers this is measured against

Token values inside `.wb` (it re-scopes six global tokens, `adminShell.css:224`):
`--space-1 4px · --space-2 8px · --space-3 9.6px · --space-4 12.8px · --space-5 17.6px ·
--space-6 32px · --space-7 48px · --space-8 64px`. `--chrome-pad-base` resolves to **16px** at
≤700px. The site already holds every form control at 16px font / ~44px box below 700px
(`app.css:35-40`), so text inputs are the one control family that is already right.

Two new additive names on `.wb` (additive, not a redefinition of the closed six):

```css
.wb { --wb-bar-h: 3.5rem; /* 56px */ --wb-hit: 2.75rem; /* 44px */ }
```

**Today at 390×844:** top bar 56 + chip row 48 = 104px of chrome, pane 740px.
The chip row is a 3034px horizontal scroller (7.78 viewport widths, 20 chips at 28px painted /
41px effective, no mask, no scrollbar), and the "Any collection" escape hatch sits at x=2832.

**This design at 390×844:** top bar 56 + pane 732 + bottom bar 56 = 844. Same 112px of chrome,
except the 56px at the bottom is under the thumb and carries the surface switcher, the status and
the primary action, and the 7.78 screens of horizontal swiping are gone.

**At 320×568:** top bar 56 + pane 456 + bottom bar 56.

---

## 1. The argument

At a desk the owner *builds* the site: writes a long post in the blocks editor, tailors a résumé
version bullet by bullet, colour-grades twenty-four hours of sky, re-measures a catalogue,
migrates a collection. Those jobs need two panes, a pointer and a keyboard, and they are what the
workbench is for. On a phone the owner does three things, and only three: **triage** (is anything
waiting on me — drafts, stray records, a publication with no URL), **one-record repair** (fix a
typo, change a title, add a tag, hide a gallery, publish the draft, delete the bad post), and
**capture** (write a `now` status, log a line — the one act of creation a phone is actually good
at, because `is.dame.now` is a one-field record). Everything else on a phone is either a thing
you *look up* — what did I publish last, what is this record's rkey — or a thing you should not
be doing at all. So the phone admin is designed as a triage-and-repair tool that can reach all
twenty-one surfaces, not as the workbench with a column deleted. Concretely that means: the
dashboard leads with what needs you rather than with four numbers; the list gets six records on
the first screen instead of two; the record editor's Save is under the thumb instead of floating
mid-form; the surface directory becomes a sheet you summon instead of a ribbon you swipe; and the
three surfaces that exist to do desk work (sky tuning, the catalogue's measurement tables, the
legacy migration) say so honestly instead of rendering broken.

---

## 2. Navigation

### 2.1 The bottom bar is the admin's chrome

Below 60rem the horizontal chip row is **deleted**. `AdminRail` renders `null` when `stacked`.
In its place, `.wb` gains a third flex row after `.wb-shell`:

```
┌────────────────────────────────────────────┐
│ ▪ dame.is ADMIN              View site ↗  │  56px   top bar
├────────────────────────────────────────────┤
│                                            │
│   pane — the whole rest, one scrollport    │  732px
│                                            │
├────────────────────────────────────────────┤
│ ▤ Blogging ▾     20 loaded        + NEW   │  56px   bottom bar (+ safe area)
└────────────────────────────────────────────┘
```

`.wb-bar` is a **flex row of the fixed frame, not a sticky box inside the pane**. That one
decision retires an entire class of defect: a sticky box is clamped to its containing block, which
is why today's save strip floats exactly 64px (`--space-8`, the pane's `padding-bottom`) above the
frame edge with live form fields scrolling through the gap under it, and why the sky hour bar
floats 56px up clearing a `ChromeBar` this route does not render. A frame row cannot float, cannot
be clamped, needs no `env()` arithmetic against furniture that is not there, and needs no
`scroll-padding-bottom` — the scrollport now ends where the bar begins, so no focused field can
ever land underneath it.

The spec's original reason for choosing sticky over fixed ("it needs no measured custom property
and cannot double-count against `.app-shell`'s padding-bottom sum") is void here: `.app-shell-admin`
already sets `padding-bottom: 0`, and the bar is not `fixed` — it is a flex item of an already-fixed
frame.

**Three slots.** Left is always outward (go elsewhere / go back). Centre is always status. Right is
always the surface's primary action.

| surface | left | centre | right |
|---|---|---|---|
| dashboard | `▤ Front desk ▾` | — | `↻ Refresh` |
| record list | `▤ Blogging ▾` | `20 loaded` | `+ New` |
| record list, selecting | `Cancel` | `3 selected` | `Hide` · `Delete (3)` |
| record detail | `‹ Blogging` | `▪ 1 field changed: Title` | `Save` · `⋯` |
| studio | `▤ Sky theme ▾` | studio status | `Save` (when it registers one) |

- Every slot control is ≥ 44×44 including its `::before` growth, and `.wb-bar` itself is 56px so
  a 44px control has 6px of clearance top and bottom.
- Slot 3 never shrinks. Slot 1 shrinks to icon + caret. Slot 2 truncates with an ellipsis, then
  hides below 340px. That is the 320px degradation rule for the whole bar.
- Slot 2 is the *only* place a count is stated on a list surface. The head's `20 loaded` line and
  the `Select all` row both go, which also retires the "two right-aligned meta columns miss each
  other by 8px" defect.
- The centre slot on a record is exactly today's `AdminStatusStrip` content — the hairline square,
  the dirty sentence, the shared-records note. `AdminStatusStrip` renders `null` when `stacked`;
  the bar renders the same markup with the same classes so there is one dirty sentence in the
  codebase, not two. On desktop the strip is untouched.
- **Save stays a plain `<button type="button" onClick>` rendered outside `.blocks-editor`.** The bar
  is a sibling of `.wb-shell`, so this is satisfied more strongly than it is today. Non-negotiable
  (`AdminStatusStrip.jsx:14-20`).
- `Delete` leaves the bar on a record. It lives in the `⋯` overflow behind a named confirm ("Delete
  *On keeping a website like a garden*? This cannot be undone."), because today it sits 8px from
  Save at 32px tall — the destructive and the primary action share a thumb's worth of screen.

**Keyboard.** `.wb` is `position: fixed; inset: 0`, i.e. the **layout** viewport, which an iOS
keyboard covers rather than shrinks (the comment at `adminShell.css:63-65` claims otherwise;
`useKeyboardInset.js`'s own header documents the truth). So `AdminShell` calls
`useKeyboardInset(stacked)` and publishes it:

```jsx
<div className="wb" style={kb ? { '--wb-kb': `${kb}px` } : undefined}>
```
```css
@media (max-width: 60rem) { :root[data-admin-shell] .wb { bottom: var(--wb-kb, 0px); } }
```

The frame shrinks from the bottom, the bar rides on top of the keyboard, and the pane — `flex: 1;
overflow-y: auto` — simply gets shorter. This is the same compensation `ActionDock` and
`BottomSheet` already perform; no viewport-meta change, so `index.html` (public) is untouched.

### 2.2 The Surfaces sheet

Slot 1 opens a sheet. Closed, the control **is the orientation cue** — it shows the surface you
are on, which is the one job the chip row had:

```
▤ Blogging ▾          17px lucide glyph · label in serif 16px · caret
                      44px tall, aria-expanded, aria-controls
```

Open, it grows up out of the bar to just below the top bar, and scrolls:

```
┌────────────────────────────────────────────┐
│ ▪ dame.is ADMIN              View site ↗  │   the top bar is never covered
├────────────────────────────────────────────┤
│              ────                          │   32×2px --rule, centred (decorative)
│  RECENT                                    │   12px / 0.18em / --ink-faint
│  ▤ Logging                            42   │   48px row · icon · serif 16 · mono tnum
│  ▤ Curating                            6   │
│  ─────────────────────────────────────     │   1px --rule-soft
│  ▤ Front desk                              │
│  CONTENT                                   │
│  ▤ Blogging                           20   │   ← is-open: accent ink + 2px accent left edge
│  ▤ Creating                            8   │
│  ▤ Logging                            42   │
│  ▤ Posting                          100+   │
│  ▤ Curating                            6   │
│  ▤ Listening                               │
│  SITE                                      │
│  … 7 rows …                                │
│  STUDIOS                                   │
│  … 4 rows …                                │
│  ▸ LEGACY (4)                              │   collapsed by default, 48px disclosure
├────────────────────────────────────────────┤
│  Open any collection                       │   sticky foot inside the sheet, 48px
├────────────────────────────────────────────┤
│ ▤ Blogging ▾     20 loaded        + NEW   │   the bar stays live under the sheet
└────────────────────────────────────────────┘
```

- Rows are 48px, full-bleed tap targets, `[icon] [label] ……… [count]`. The count comes from
  `useAdminData` — the same de-duplicated cache the rail already reads, so it costs no request.
  A surface with no count shows nothing; a countable surface that came back empty is dimmed at
  `opacity: .55` exactly as `.wb-rail-btn[data-absent]` is today.
- **Recent** is the last three distinct surface keys, written by `useShellState` on every surface
  change into `sessionStorage['dame.admin.recent']`. Session, not local: a working set is a
  session's memory, and a new session should start from the desk. It is what makes the two- or
  three-surface owner never scroll this sheet at all.
- **Legacy is collapsed.** It is four derived record-lists plus the blog migration, visited about
  once a year. Collapsing it takes the sheet from ~1010px of rows to ~810px in a ~684px panel:
  one short flick instead of two.
- **Open any collection** is a sticky foot, not the twenty-second row — today it is 7.3 screens
  out at the far right of a ribbon whose own source comment says it "must never scroll out of
  reach". Tapping it replaces the row with a 44px text input + `Go`, validated for NSID shape
  (dot-separated segments, no leading digit) with the refusal *"That is not an NSID — try
  `app.bsky.graph.follow`"*. It replaces `window.prompt` (`AdminRail.jsx:133`), which is OS chrome
  in a system that draws everything itself.
- Mechanics: portalled to `document.body`; `useFocusTrap` moves focus in and restores it to the
  trigger on close; `usePreventScrollChain` on the panel; Escape closes; backdrop is a transparent
  click-catcher (no tint — the sheet reads as chrome, matching `BottomSheet.css:9-14`); motion is
  `height: 0 ↔ auto`, 340ms, `ease [0.32, 0.72, 0, 1]`, zero under `prefers-reduced-motion` —
  the same contract as every other upward-expanding surface on this site.
- Choosing a surface runs the existing `go({...explicit nulls})` so the unsaved-changes guard fires
  exactly as a rail click does today, then closes the sheet.

### 2.3 Back

`column` stays **derived from the URL and only from the URL** (`useAdminShell.jsx:289`) — the audit
is right that this is the single reason the on-screen back and the browser back cannot desync. It
does not change.

- On a record, slot 1 reads `‹ Blogging` and calls `go({ r: null, mode: null })`. The top-left
  `.wb-editor-back` link (22.4px tall, in the hardest corner of the screen) is deleted.
- The browser back button and slot 1 are the same URL change, so they behave identically.
- **Returning must be non-destructive.** Today, drilling into record 21 of 42 and coming back
  gives `scrollTop: 0`, an empty filter, a cleared selection and `document.activeElement === BODY`.
  Fix: lift the list's view state out of the pane and into the shell (§7), so unmounting the column
  costs nothing. On remount, restore `scrollTop` in a layout effect and move focus to the row you
  came from (`lastOpenRkey`, already tracked as `openRowRef`).
- Unsaved-changes on a POP: `useBlocker` is unavailable here (the app mounts `BrowserRouter`, not a
  data router — `main.jsx:71`). Use the history-sentinel pattern in `useShellState`: while
  `dirtyRef.current.dirty`, push one duplicate entry and listen for `popstate`; on pop, confirm with
  the same single sentence `go()` uses, and re-push if declined. Migrating to a data router is out
  of scope and must not be smuggled into this change.

### 2.4 What I rejected, and why

1. **Keep the ribbon; fix the targets and add an edge fade.** Cheapest, and it fixes the two
   correctness bugs (41px targets whose `::before` boxes overlap by 12px so 14 of 19 adjacent
   chip pairs steal each other's taps; no overflow cue). It does not fix the actual problem:
   3034px is 7.78 screens, the four group headings are `clip-path`-hidden so the row is 21
   undifferentiated chips, and the escape hatch is unreachable. A fade tells you there is more; it
   does not make twenty-one destinations reachable.
2. **A fixed five-tab bottom bar (Desk · Blogging · Logging · Curating · More).** Rejected: it
   hardcodes an editorial claim about which five of twenty-one matter, which is wrong for any week
   spent in Ratioed or Resume; "More" then carries seventeen items, so you build the sheet anyway
   *and* spend four permanent slots on guesses. Recents in the sheet gives the same shortcut
   without the guess, and adapts.
3. **A native `<select>` of the 21 surfaces in the top bar.** Genuinely the cheapest correct fix —
   a free 44px OS picker. Rejected: it cannot show counts, cannot show groups meaningfully, cannot
   host "Any collection", and renders as OS chrome in a house that draws all of its own controls
   (the same objection this codebase already makes to `window.prompt`).
4. **Route every surface change through the Front Desk.** Rejected: two taps plus a scroll for
   every switch, and it turns the dashboard into a toll booth.
5. **A hamburger drawer from the left edge.** Rejected: its handle lives in the top-left corner,
   the least reachable point on a phone, and a left-edge drawer fights iOS's own back-swipe.
6. **Keeping the rail as a bottom scroller instead of a sheet.** Rejected for the same reason as
   (1) — horizontal scrolling is still the wrong shape for a grouped, counted, twenty-one-item
   directory, wherever it sits.

---

## 3. The screens at 390

All offsets are measured from the top of the pane's scrollport (viewport y = 56). Pane inset is
**16px** (`--chrome-pad-base`) on both columns — today the list pane insets 12.8px and the detail
pane 16px, so their content edges disagree by 4.8px.

**One structural rule for all four screens.** `.wb-pane-detail`'s block padding moves onto its
children:

```css
@media (max-width: 60rem) {
  .wb-pane-detail { padding: 0 var(--chrome-pad-base); scroll-padding-top: 0; }
  .wb-pane-detail > .wb-editor,
  .wb-pane-detail > .wb-studio,
  .wb-pane-detail > .fd { padding-block: var(--space-4) var(--space-6); }
}
```

Without this, any `position: sticky; top: 0` element inside the pane pins 16px down from the
scrollport edge and live content scrolls visibly through the band above it — the same failure as
today's tab bar, just smaller. With it, `top: 0` pins flush at viewport y = 56.

### 3.1 Dashboard — inverted

The order today is counts → needs → latest → directory, 2161px (2.92 screens), with "Needs you"
— the entire reason to open the admin on a phone — starting at pane-y 453 and running past the
fold. On a phone it reads: **what needs you, what changed last, then the numbers, then one door
to everything else.**

| pane‑y | block | h |
|---|---|---|
| 0 | padding-top `--space-4` | 12.8 |
| 13 | `<h1>Front desk</h1>` `--text-2xl` / `--leading-tight` | 36 |
| 49 | gap `--space-5` | 17.6 |
| 67 | **NEEDS YOU** small-caps 12px / 0.18em + note (2 lines) | 46 |
| 113 | 3 need rows, each 48px stacked (label over action) + per-record 44px rows | ~264 |
| 377 | gap `--space-6` | 32 |
| 409 | **LATEST RECORDS** + note | 42 |
| 451 | 8 record rows × 48 | 384 |
| 835 | gap `--space-6` | 32 |
| 867 | counts **scanline** | 56 |
| 923 | gap `--space-6` | 32 |
| 955 | `All 21 surfaces →` 48px row → opens the Surfaces sheet | 48 |
| 1003 | padding-bottom `--space-6` | 32 |
| **1035** | total (1.41 screens) | |

**Cut:** the pane blurb ("Counts, what needs you, and the way in to everything else.") — it
explains the page to a first-time reader; the owner has read it. **Cut:** the whole `.fd-surfaces`
directory, 758px of tiles that the Surfaces sheet now renders better and reaches from anywhere;
its replacement is the one 48px row at the foot. **Cut:** `Open any collection`, which lives in
the sheet.

**Moved:** `Refresh counts` — today a 29.2px button orphaned on its own right-aligned line at
pane-y ≈ 130 — becomes the bar's right slot. It flips to `Refreshing…` + `disabled` + `aria-busy`
while in flight; today it gives no feedback at all.

**Promoted, and re-laid-out:** `.fd-need-link` stacks (`flex-direction: column; align-items: start`,
drop the `margin-left: auto` on the action) so the action verb stops pinning to line 1 while the
label wraps under it. Each need row and each per-record link gets `display: block` +
`padding-block: var(--space-2)` for a ≥44px box — padding rather than a grown `::before`, because
these are stacked and pseudo-boxes would collide.

**Collapsed:** the four count tiles (236px, and their labels break the row's shared baseline by
19.2px whenever one wraps) become **one scanline**, two lines at 390 and 320:

```
25 PUBLISHED  ·  3 DRAFTS  ·  4 HIDDEN
12 SIGNATURES
```

Numbers in `--code`, `font-feature-settings: 'tnum' 1`, `--text-lg`; labels in the small-caps
voice at `--text-xs` / 0.18em / `--ink-faint`. The captions ("blog and portfolio, excluding
drafts") move to `title` attributes. The guestbook's degraded state is `— SIGNATURES` with the
explanation in its title, not a 119px box holding one sentence. This is 56px doing the work of
236, and it cannot break its own baseline because it is one line box, not four blocks.

### 3.2 Record list — a thumb list

Today: the head is 202px and `position: static` (so the filter, the sort, the segment and the live
Delete cluster are gone forever after one swipe — measured at y = −919 after scrolling to the
list end), the page-content card takes another 154px *between the toolbar and the rows*, and the
first record is at viewport y 518 — **two rows on the first screen**.

```
STICKY HEAD  (pinned at pane-y 0, i.e. viewport y 56)
  0    padding-top 12.8
  13   title row 44px:   Blogging  (--text-lg serif)            [↻]
  57   control row 44px: [⌕ Filter ]              [Newest · All ▾]
  105  1px --rule
BODY
  106  row 1 …  20 rows × 66px
  1426 [Load more] 44px
  1470 gap 32
  1502 `Page content — served from your PDS ›`  48px disclosure
  1550 padding-bottom 32
BAR
  ▤ Blogging ▾        20 loaded        + NEW
```

First record at viewport y **162**: **six rows on the first screen instead of two.**

- **Sticky restored.** Delete the `position: static` override at `recordListPane.css:349-363` and
  let the base `position: sticky; top: 0` stand. The comment justifying it ("the shell releases
  `.wb-pane-list` to scroll with the DOCUMENT") is factually stale — `adminShell.css:693-699` gives
  the pane `flex: 1; overflow-y: auto` in the same media block, and `:root[data-admin-shell]` sets
  `overflow: hidden` on both `<html>` and `<body>`. The pane is its own scrollport at every width.
  Rewrite the comment with the fix.
- **Cut the nsid chip** (`site.standard.document` under a title that says "Blogging") — developer
  orientation, still present on the record detail.
- **Cut the `Select all` row** (39px) and **cut the per-row checkbox column** in normal mode. That
  buys back 24px of a 390px row and removes a 13px target that today is *made visible* on touch
  (`.wb-list-check { opacity: 1 }`) without being made reachable — visibility without
  reachability, which is the whole failure in miniature. Selection becomes a mode (§5).
- **Filter behind a 44px toggle** rather than a permanent 43px input eating the first screen. Tap
  `⌕ Filter` → the input replaces the control row in place (`aria-expanded`), autofocused, with a
  `Cancel`. While a query is active the closed toggle reads `⌕ "gard" ×` and the × clears it —
  which also fixes the empty state that today has no way out of itself (Chrome draws no clear ×
  on an unfocused `type="search"`).
- **Sort and visibility merge into one chip** — `Newest · All ▾` — opening a small sheet (the same
  `AdminSheet`) with 3 sort rows and 3 visibility rows at 48px each. They are set-once-then-forget
  controls; a filter is per-use. This is what makes two 44px controls fit one 358px row where a
  toggle + a 163px segment + a 110px select could not. The visibility labels come from the
  collection's own model (`visibilityModelFor().chipLabel`) so hero phrases say Enabled/Disabled
  rather than Visible/Hidden while their rows say DISABLED.
- **Refresh** stays in the head as a 44px target painting a 20px glyph (today: a 14×14px button
  whose whole box is the glyph). It is a rare control, so top-of-screen is honest for it. No
  pull-to-refresh: it would fight the sticky head and a scrollport that is not the document.
- **Rows keep their 65px two-line shape** — the audit is right that this part is already good.
  Three fixes: the whole row is the link; `.wb-list-dot` hangs in the gutter (absolute, or negative
  margin) so a row's title and its rkey share one left edge on the four surfaces that draw a status
  square as they already do on the four that do not; and with the checkbox gone the row content
  starts at the same x as the head instead of 36px right of it.
- **Page-content card moves below the rows** and collapses to a 48px disclosure. Nothing may sit
  between a list's controls and the records they act on — today it is a stop in the keyboard walk
  between `Select all` and the first row.
- `Load more` stays a button (no infinite scroll), gets a 44px box, and **restores focus** to
  itself after the page lands; `.admin-multiselect-count`'s replacement in the bar carries
  `aria-live="polite"` so the new count is announced.
- **Empty states carry their exit**: "No records yet — *create the first one*" wired to the New
  href; "Nothing matches *gard* — *clear the filter*" wired to `setQuery('')`.

### 3.3 Record detail — the form and one bar

```
  0    padding-top 12.8
  13   DOCUMENT              small-caps kicker 12px / 0.18em / --ink-muted
  29   On keeping a website  --text-xl serif, --leading-tight, up to 2 lines
       like a garden
  87   3l22xtpmjz5p          mono 12px chip
  107  gap 12.8
  120  STICKY [ Edit ][ Preview ]   44px, top: 0  → pins at viewport y 56
  164  gap 12.8
  177  TITLE *               label 12px small-caps
  193  [input]               44px
  241  DESCRIPTION …
  …
  end  padding-bottom 32
BAR
  ‹ Blogging      ▪ 1 field changed: Title       [SAVE] [⋯]
```

- **The heading names the record, not the lexicon.** Today it reads `Document` under a back link
  reading `← Blogging`; on Curating it is `Curating` under `← Curating`. Use `rowLabel(value,
  collection, lex)` — the accessor the list rows already use — with the rkey as the fallback, and
  demote the lexicon label to the small-caps kicker.
- **Tab bar pins at `top: 0`.** Today it computes `top: 97.6px` = `var(--chrome-top-h,
  var(--chrome-h)) + 2.6rem`, both terms measuring against furniture this route does not render, so
  it pins 114px into the pane and slices the PATH (SLUG) label in half. Delete the constant. (And
  publish nothing to `--chrome-top-h`: `ChromeBar` leaves it as an *inline* style on `<html>` that
  no stylesheet rule can outrank, which is why arriving at `/admin` from a public page moves the
  strip to y=213 today. `top: 0` does not read it.)
- **Drop `role="tab"` / `role="tablist"`.** They are three buttons with `aria-pressed`, which is
  what they behave like: there is no `[role=tabpanel]` anywhere, no `aria-controls`, all three have
  `tabIndex 0`, and Arrow keys do nothing. Honest markup is cheaper than implementing the contract.
- **JSON moves to the `⋯` overflow.** A 12-character-wide monospace textarea is not where you fix a
  lexicon violation, but it must stay reachable to *read* what a record actually is.
- `⋯` (44px square, right of Save) holds: `Edit raw JSON`, `Delete record…`, `Copy at-uri`,
  `View on site ↗`.
- A record that does not exist renders a **state, not a form**: today `?c=is.dame.now&r=doesnotexist`
  draws an empty editable form with Save armed, and pressing Save *creates* the record. Render
  "That record is gone — it may have been deleted." with `Back to Logging`, and register no bar
  actions.
- **Failed saves report in the bar**, not 1819px above it. Widen the `onStatus` payload with
  `error` so the bar can say "Not saved — the JSON is invalid (line 1, column 3)" with the square
  in the attention colour. Note the spec freezes `onStatus`'s shape (`admin-rebuild-spec.md:174`);
  this is the one place that freeze has to be lifted, and it should be lifted deliberately.

### 3.4 Studios

Studios are a `.wb-studio` inside the same pane, so they inherit the frame, the bar and the sheet
for free. Uniformly, at stacked widths:

```
  0    padding-top 12.8
  13   <h1> studio title      --text-2xl
  49   blurb                  --text-sm / --ink-muted     (kept — studios are rarely visited,
  …                                                        the blurb is real orientation)
  …    studio body, one column, container-queried on `wbpane`
BAR
  ▤ Sky theme ▾     status     [SAVE]
```

- `.wb-pane-head > * { margin: 0 }` — today `h1` keeps `margin-bottom: 17.6px` and `p` keeps
  12.8px from `typography.css`, so the head's declared 9.6px gap is really 27.2px and 22.4px and
  the head is 137.5px tall at 390 before any content.
- Every studio that registers Save/Delete (`nav`, `publications`, `resume`, `resume-tailor`)
  registers into the bar unchanged — `registerActions` is the same channel.
- Studios that own a full-width toolbar (`listening`'s Delete, `ratioed`'s six bulk buttons) move
  their bulk actions into the bar's selection mode or its overflow rather than a static toolbar
  that scrolls two screens away.
- Per-studio gates: §6.

### 3.5 At 320

Nothing new, four degradations, all declared once:

- Bar slot 1 drops its label to icon + caret; slot 2 hides below 340px; slot 3 never shrinks.
- Counts scanline wraps to two or three lines; it is a wrapping line box, so it cannot break a
  baseline.
- The record heading clamps to 3 lines with `overflow-wrap: anywhere` (a hand-typed NSID title is
  the one unbounded string here — today `com.example.a.very.long…` is clipped mid-word with no
  ellipsis because `overflow-wrap` is `normal`).
- `.admin-collection-nsid` swaps `word-break: break-all` for `overflow-wrap: anywhere`, so
  `fm.teal.alpha.feed.play` stops rendering as two chip fragments reading `fm.teal.alp` /
  `ha.feed.play`.

---

## 4. Thumb zones

On a 390×844 phone held one-handed the comfortable arc is roughly the bottom 45% and the
horizontal centre; the **top-right corner is the hardest point on the screen**. Today every
primary action is in the top 15%: `New` at y=117, `Refresh counts` at y=229, the back link at
y=120 in the top-*left*, `View site` at y=14 — and the bottom 300px of every list surface holds
nothing at all.

**In the bar (repeated actions, every session):** switch surface, back out of a record, Save, New,
Refresh counts, and the whole selection cluster (Cancel / Hide / Delete). Anything you do more
than twice in a sitting.

**Stays at the top (once-a-session, or destructive-by-accident-if-near-the-thumb):** `View site`,
the list's `Refresh`, the page-content migration disclosure, the studio blurbs. `Delete` is
deliberately *not* in a bar slot on a record — it sits in the `⋯` overflow behind a named confirm,
because a destructive control 8px from the primary one is a mis-tap waiting to happen.

**Bar behaviour with the keyboard up:** the frame's `bottom` is `var(--wb-kb)`, so the bar sits
directly on the keyboard's top edge and Save stays visible and tappable while you type. Because
the bar is outside the scrollport, no field can scroll under it and no `scroll-padding-bottom`
compensation is needed. Two rules on top of that:

- While the sheet is open the bar stays live beneath it and the sheet's own floor is
  `max(bar height + safe area, --kb-inset)` — the same `max()`, not a sum, that
  `BottomSheet.css:32-35` documents.
- Slot 2's dirty sentence must not reflow the bar per keystroke: `.wb-bar-status` is
  `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap` and the slot
  widths are fixed by slots 1 and 3.

**Hit targets.** One rule closes twenty-seven separate defects. The `::before` growth trick is
already written in this codebase, documented, borrowed from the public chrome — and applied to
exactly one class (`.wb-rail-btn`). Mint it as a utility in `adminShell.css` and apply it
everywhere:

```css
@media (pointer: coarse) {
  .wb-hit { position: relative; }
  .wb-hit::before { content: ''; position: absolute; inset: -8px; }
  .wb-hit-lg::before { inset: -14px; }
}
```

Applied to: `.wb-list-refresh`, `.wb-list-seg-btn`, `.wb-tab`, `.wb-top-out`, `.fd-action`,
`.fd-need-link`, `.fd-surface-link`, `.ratioed-panel-edit`, `.ratioed-panel-uri`,
`.rs-version-raw`, `.rf-icon-btn`, `.nav-item-btn`, `.sky-step`, `.admin-gate-button-tight`.
Where the painted control must stay small (a checkbox, a hairline slider) the *target* grows
underneath it and nothing visual changes. Where a control is stacked with siblings (the need rows,
the sheet rows) use `padding-block` instead, because grown pseudo-boxes would overlap — which is
exactly what the chip row does today: a 4px intra-group gap against −8px insets means 14 of 19
adjacent chip pairs steal each other's taps, verified with `elementFromPoint`.

---

## 5. Gestures and affordances

One gesture is proposed. Two are rejected. Each has a non-gesture equivalent that is the primary
path, because a gesture the owner has not discovered is a feature that does not exist.

**Proposed — long-press a list row → selection mode.** *Phase 2, not the first build.*
Non-gesture equivalent, which ships first and is the discoverable path: `⋯ → Select records` in
the bar's overflow on a list surface. Entering the mode reveals a 24px checkbox on every row (the
gutter the status square already occupies), swaps the bar to
`[Cancel] [3 selected] [Hide] [Delete (3)]`, and leaves on Cancel, on Escape, or on a surface
change. Implementation when it comes: `pointerdown` + 500ms timer, cancelled by `pointermove`
> 10px or `pointerup`, with `contextmenu` prevented while stacked. It is a shortcut on top of a
control, never the only way in.

**Rejected — swipe-left on a row to reveal Hide / Delete.** The audit asked for it; I think it is
the wrong trade here. `bulkDelete` calls `deleteRecord` against a live PDS with no undo anywhere
in the data layer, the confirm is a `window.confirm` naming only a count, and the row is 65px —
a mis-swipe is unrecoverable and the affordance is invisible. Selection mode gives the same
capability with a Cancel, multi-select, and a named confirm. If a per-row swipe is ever built, it
should reveal **Hide** only (reversible) and never Delete.

**Rejected — pull-to-refresh.** It fights a sticky head in a scrollport that is not the document,
and both the list and the dashboard already carry an explicit, labelled Refresh whose busy state
this design fixes.

**Not touched — the iOS back-swipe.** The browser owns the left screen edge; our back is a 44px
bar control plus the browser's own gesture, and both are the same URL change.

**Affordances that are not gestures, and are load-bearing:**

- `.admin-link-subtle` gets a resting affordance (accent ink, or a 1px underline with an offset).
  Today `← All publications`, `Edit raw JSON` and `theme only` are `--ink-soft`, 14px, no
  underline, no border, no background — distinguishable from prose by weight of ink alone. On a
  phone that is not a control.
- `a.admin-gate-button:hover:not(:disabled) { color: var(--page) }` — one additive rule fixing
  four anchor gate-buttons whose label currently vanishes on hover because
  `typography.css:46`'s `a:hover { color: var(--accent) }` outranks the button's own colour and
  the background is repainted to the same value. Irrelevant on touch, free, and it is the same
  class family.
- A real `--danger` token in `theme.css` with a sky-mode derivation independent of the sky's hue.
  `.admin-danger` currently paints in `--tan`, which under `data-theme="sky"` is
  `hsl(<sky hue>, …)` by construction — computed #223fa0 at hour 9, #2224a0 at 17, #227da0 at 12:
  the same hue as `--accent` for most of the day. A bulk delete must be legible as a bulk delete at
  every hour. `.admin-error`'s hardcoded `rgba(168, 140, 95, 0.08)` goes with it.

---

## 6. What the phone does not do

Each gate states the honest reason and shows something real, never a dead end.

**Sky theme studio — the tuning half.** Thirteen 2px-tall range inputs, a 24-cell arc at 13px per
hour (10px at 320), and a live preview card the fixed hour bar cuts in half. Nobody colour-grades
an hourly palette on a phone, and pretending otherwise costs a broken layout. The phone shows: the
`Use this override` toggle, the live preview card, an hour stepper at 44px (`‹ 7 PM NIGHT ›`), a
read-only swatch strip of that hour's palette, and *"Fine-tuning the palette is available on a
larger screen."* The hour bar stops being body-portalled and `position: fixed` when stacked and
becomes an in-flow block in the pane — which is also what retires its 56px dead band, its
occluded Save, and its 50-stop tab order (it is currently the last thing in the tab order because
it is a child of `<body>`).

**Ratioed catalogue — the measurement tables.** 5566px of scroll, nineteen `view the piece` links
at 57×11px, eight visually identical panels, and each panel's `<dl>` labels two different
quantities "alive". The phone shows the two counts, the bulk actions as a 44px list (`Delete all`
moved to the overflow, behind a confirm, carrying the count it is about to destroy), and a compact
per-piece row: title · state chip · one number, tapping through to `edit record`. The measurement
`<dl>` is behind a per-card `Measurements ▸` disclosure. Not a hard gate — a four-column
transposed table is unreadable on a phone but the numbers should still be reachable.

**Legacy blog migration — desktop only.** It reads local markdown from the repo and writes records;
it is a one-time job whose rows are 45–60-character slugs currently squeezed into a 14ch gutter and
stacked ten lines tall. The phone shows the count and *"Migration runs from a desktop."*

**Resume tailor — the bullet board.** Keep the surface: flipping a version active or fixing a
headline from a phone is real work. Gate the per-bullet include/exclude board behind a per-entry
`Bullets — 3 of 5 shown ▸` disclosure, retitle version rows with the version's title (today it is
a raw 12-character rkey printed twice in the same row), and merge `record` / `rename` / `view` /
`rename key` — four 19px text links — into one 44px overflow.

**Raw JSON.** Reachable from the record overflow, read-first. Not a tab on a 390px screen.

**Blocks editor reordering.** Editing, inserting and deleting a block stay (that is how you fix a
paragraph). Drag handles are 17.6px wide and drag-reorder on a scrolling touch surface is a
project of its own — gate reordering to desktop with *"Reorder blocks on a larger screen"* until
it gets one.

**Bulk delete of 240 listening plays.** The list stays. `Delete` acts on the current selection with
a named confirm; `Delete all loaded` moves to the overflow. And fix the state bug while there: after
a bulk delete the studio says "No plays yet." while 140 plays are still on the PDS, because the
pager gate is `!done && records.length > 0` and the delete emptied `records`.

---

## 7. The diff

### New files

| file | why a new component rather than a reflow |
|---|---|
| `src/admin/AdminActionBar.jsx` | There is no bottom bar to reflow. `AdminStatusStrip` is a *record* control that is the first child of the detail pane by design (`AdminStatusStrip.jsx:8-12`, and desktop's top-sticky depends on it); the bar is a *frame* row that must exist on the dashboard and every studio too, and must hold navigation. It renders the strip's markup in its centre slot so the dirty sentence stays defined once. |
| `src/admin/AdminSheet.jsx` | `BottomSheet` positions itself entirely in terms of public-chrome constants — `--chrome-h`, `--edit-bar-h`, `--chrome-top-h` — none of which describe `/admin`. Two of the three are wrong here and the third is an inline style `ChromeBar` leaves on `<html>` that no admin rule can outrank. Reusing it would mean either editing a public stylesheet (forbidden) or fighting an inline style. `AdminSheet` reuses the same *hooks and motion contract* (`useFocusTrap`, `usePreventScrollChain`, `useKeyboardInset`, `height 0↔auto`) and positions against the admin frame. It serves both the Surfaces sheet and the list-options sheet. |
| `src/admin/AdminSurfaceSheet.jsx` | The sheet's content: recents, groups, counts, collapsed Legacy, the Any-collection form. Reads `allSurfaces()` + `useAdminData` — no data source is duplicated. |
| `src/admin/adminBar.css` | Bar + sheet rules. Kept out of `adminShell.css`, which is already 798 lines. |

### Changed files

**`src/admin/AdminShell.jsx`**
Render `<AdminActionBar/>` as `.wb`'s third row when `stacked`; render `<AdminStatusStrip/>` inside
the pane only when `!stacked`. Publish `--wb-kb` from `useKeyboardInset(stacked)`. Move the Cmd/Ctrl+S
listener from the `.wb` element's `onKeyDown` to a `document` listener scoped to the shell's lifetime
(today it silently does nothing whenever focus sits on `<main>` or `<body>`, which is where clicking
plain text puts it, because `.wb` is a *descendant* of `#main-content`). Add an admin-scoped
"Skip to editor" link — the site's `Skip to content` targets `#main-content`, which in the admin
wraps the top bar and the whole workbench, so it skips nothing.

**`src/admin/useAdminShell.jsx`**
Add `listView` (per-surface `{query, sort, visibility, selected, scrollTop, lastOpenRkey}`) with a
setter, so unmounting the list column costs nothing and the bar/sheet can drive sort and visibility.
Add `barSlots` / `registerBar` (same shape and lifecycle as `registerActions`). Add
`sheet` / `setSheet` (`'surfaces' | 'list-options' | null`). Add `recents` written to
`sessionStorage` on surface change. Add the `popstate` sentinel guard described in §2.3.

**`src/admin/AdminRail.jsx`**
`if (stacked) return null;`. Extract the group/filter logic into an exported
`useSurfaceList()` so the rail, the sheet and the Front Desk read one list. Delete the
`!stacked` guard on the `scrollIntoView` effect (desktop currently never scrolls the open chip into
view, so the rail marks nothing at all for the last five of twenty-one destinations below ~986px
of viewport height). Replace `window.prompt` in `openAny` with the sheet's form.

**`src/admin/AdminTopBar.jsx`**
`View site` becomes `<Link to="/">` routed through `go()` so it neither hard-reloads the SPA nor
discards unsaved edits without asking (it is the only nav control in the shell that is a raw
anchor). The three breadcrumb links and the wordmark route through `go()` for the same reason.
Hide the hour chip when `stacked` (inert, duplicated by the sky studio); on desktop drop its border
so it stops reading as a button beside `View site`.

**`src/admin/AdminStatusStrip.jsx`**
`if (stacked) return null;`. Export `dirtySentence` for the bar. Three states instead of two:
`Loading…` while `actions.loading`, `Not created yet` while `actions.isNew && !dirty`,
`No unsaved changes` only for a loaded saved record. Render `error` when the widened `onStatus`
payload carries one.

**`src/admin/adminShell.css`**
Rewrite the `@media (max-width: 60rem)` block. Delete every chip-row rule
(`:659-755`). Add the `.wb-bar` row and `.wb { bottom: var(--wb-kb, 0px) }`. Unify both panes'
inset to `--chrome-pad-base`. Move `.wb-pane-detail`'s block padding onto its children (§3).
Delete `.wb-strip`'s stacked block and the `[data-surface='sky']` lift with it. Add the `.wb-hit`
utility. Add `.wb-pane-head > * { margin: 0 }`. Snap `.wb-rail-btn` 0.9rem, `.wb-top-out` 0.82rem
and `.wb-top-hour` 0.72rem onto the type scale.

**`src/admin/panes/RecordListPane.jsx`** — slim head (§3.2); read/write view state from the shell;
register bar slots; selection mode; move the page panel below the rows; restore focus after
`Load more`; empty states carry their action; `aria-label={`Select ${label || rkey}`}` on row
checkboxes; suppress the count line while `loading && records.length === 0` (today it asserts
"0+ loaded" before anything is known).

**`src/admin/panes/recordListPane.css`** — delete `position: static` (`:349-363`) and rewrite its
stale comment; new head layout; hang `.wb-list-dot` in the gutter; 44px targets; `.wb-list-title`
`overflow-wrap: anywhere`.

**`src/admin/panes/RecordDetail.jsx`** — title the record via `rowLabel`; kicker + rkey; tabs become
`aria-pressed` buttons and lose `role="tab"`; JSON moves to the overflow; delete `.wb-editor-back`
(the bar owns back); register bar slots; render a not-found state instead of a live form.

**`src/admin/panes/recordDetail.css`** — `.wb-editor-tabs { top: 0 }` in the stacked block, constant
deleted; `.record-preview + .wb-editor-note { max-width: 100% }`.

**`src/admin/panes/StudioPane.jsx`** — pass `stacked` down so a studio can render its gate.

**`src/admin/FrontDesk.jsx` + `frontDesk.css`** — stacked ordering (needs → latest → counts →
`All 21 surfaces →`); counts scanline; drop the blurb and `.fd-surfaces` when stacked; stack
`.fd-need-link`; 44px need rows; `Refresh counts` moves to the bar and gains a busy state; mint
`.fd-section-heading` so the six section heads stop being overridden to 0.05em tracking by the
`.small-caps` class paired with them; reserve `.fd-panel` min-heights so the page does not jump
225px when the counts land.

**`src/components/RecordEditor.jsx`** — widen the `onStatus` payload with `error` / `notFound`
(deliberate lift of the §6.2 freeze — record it in the decisions log); refuse to save when a
required field is empty and name the field; render a not-found state in place of the form.

**Studio components** — `SkyThemeStudio.jsx/.css` (in-flow hour bar + tuning gate),
`RatioedPanel.css` + `RatioedCatalogue` (per-card disclosure, 44px links, type off 9.28px),
`resume/ResumeStudio.jsx` + `resumeStudio.css` (version row titles, merged overflow, square the
radio), `resume/ResumeWorkbench.jsx` (bullet-board disclosure, key entries by ref URI not index so
a reorder stops discarding focus and card state), `ListeningManager.jsx` (bar registration, pager
gate, focus restore), `LegacyBlogMigration.jsx` (desktop gate), `NavMenuPanel.css` (44px reorder
buttons that do not share an edge).

**`src/pages/Admin.css`** (append-only) — `a.admin-gate-button:hover:not(:disabled) { color: var(--page) }`;
`.admin-link-subtle` resting affordance; `.admin-input { min-height: var(--wb-hit) }` under the
breakpoint so `<select>` stops landing 5.4px short of its sibling `<input>`; `.admin-collection-nsid`
`overflow-wrap: anywhere`; point `.admin-error` and `.admin-danger` at the new `--danger` token.

**`src/styles/theme.css`** — add `--danger` / `--danger-wash`, with a sky derivation that does not
track the sky's own hue. This is the one file outside the admin that the public site shares; the
change is **additive only** (two new tokens, no existing token redefined), so no public rule
changes behaviour.

**`docs/admin-rebuild-spec.md`** — replace §8 with this document; record the `onStatus` lift and
the chip-row removal in `docs/admin-rebuild-decisions.md`.

### Explicitly not changed

`index.html` (the viewport meta is shared with the public site — the keyboard is handled with
`useKeyboardInset` instead), `src/components/BottomSheet.*`, `ActionDock.*`, `EditModeBar.*`,
`ChromeBar.*`, `RouteTransition.jsx`, `src/lib/guestbook.js`, and every `.admin-*` selector's
existing declarations (Admin.css is frozen public API — `Exploring.css` `@import`s it and
`EditSheet` renders `RecordEditor` app-wide; every change above is an *added* rule or an added
selector, never an edited one).

---

## 8. Acceptance checks

Measured at 390×844 and 320×568 with `hasTouch`, `matchMedia('(pointer: coarse)')` true.

1. `document.querySelector('.wb-rail')` is `null` when stacked. No element in the admin has a
   `scrollWidth` more than 1.05× its `clientWidth` on the inline axis.
2. Every focusable element inside `.wb`, including `::before` growth, measures ≥ 44px on both axes.
   Zero exceptions. (Today: 41px is the best case and 13px the worst.)
3. On a record: `.wb-bar` bottom === `window.innerHeight`, and `elementsFromPoint` swept every 8px
   through the pane returns no pane content behind the bar or the pinned tab bar.
4. `.wb-editor-tabs` pinned rect top === pane scrollport top, at `scrollTop` 0, 400 and the end.
5. Scroll a 42-record list to `scrollTop` 1200, type a filter, select a row, open a record, press
   the bar's back: `scrollTop` is 1200 ± 2, the filter and selection are intact, and
   `document.activeElement` is the row's link — not `BODY`.
6. Front desk: the first "Needs you" row is above the fold at both widths. Pane `scrollHeight`
   ≤ 1.6 × `clientHeight` at 390. A `PerformanceObserver` for layout-shift records CLS < 0.01
   across load at the harness's default latency.
7. Record list: ≥ 6 rows visible on the first screen at 390. The head's pinned rect top === the
   pane's scrollport top after a 900px scroll.
8. Every surface is reachable in ≤ 2 taps from every other surface (slot 1 → sheet row), and
   `Open any collection` is on screen without scrolling once the sheet is open.
9. With a text field focused and a software keyboard simulated (`--wb-kb: 300px`), `.wb-bar` sits
   flush on the keyboard's top edge and Save is fully visible.
10. Browser back from a dirty record raises the same one-sentence confirm a bar navigation does.
11. `npx vitest run` and `npx eslint .` hold at or better than the recorded baseline; no public
    route's rendered geometry changes (spot-check `/`, `/blogging`, `/welcoming`, `/exploring`).
