# dame.is — design audit

*An audit of the live site's design, layout, visual language and UX, taken on 27 October 2026 (day 12,227). Mockups for the main proposals are in [`index.html`](index.html) (open it in a browser); every finding is in [`findings.md`](findings.md).*

**How it was done.** 106 Playwright captures of https://dame.is — 24 page types plus 4 record pages at 1440×900 and 390×844, the home page, an essay and a moth night at five sky hours (midnight, 6 am, 1 pm, 7 pm, 9 pm), and 16 interaction states (menus, sheets, x-ray, lightbox, focus, card layout, deep scroll) — each with computed metrics (tap targets, overflow, type and colour inventory, contrast). Nine reviewers then audited the captures and the source, one lens each: visual identity, typography, layout, navigation, the home feed, collections, the component system, interaction and states, and mobile + accessibility. Each lens's findings went to an independent verifier whose job was to refute them against the evidence; two were refuted and dropped, and dozens were corrected in severity or detail. A completeness pass added ten cross-cutting gaps, verified the same way. The result: **130 verified findings (12 high, 59 medium, 59 low), merging into about 80 distinct issues.**

Screenshot names in the evidence (`home__mobile__h13__s0.png`, `extra/…`) refer to that capture corpus, which is not committed; the crops that matter are reproduced in the mockups. Code references are `file:line` against `main` at `5cf9f42`.

---

## Verdict

dame.is has something most personal sites lack: a point of view you can recognise at a glance. The ruled "dame is…" sentence, a single serif voice, square hairline geometry, a palette that follows Dame's own sky and an x-ray that shows the record behind the page add up to something no template produces. The 130 findings are not a case against that idea. They mostly mark places where the idea hasn't been carried all the way through.

Three things matter most:

- **The sky palette has no contrast floor.** The quiet "pencil" ink carries every timestamp, every ledger verb and the hero's "dame is", and it passes AA in only 2 of 24 hours.
- **The home ledger keeps its desktop grid on a phone.** Dame's words get a 206px column and the labels shrink to 9.6px.
- **Several paths are broken.** On ten record types the section crumb leads to a 404. Back can take a visitor off the site. On a small phone, the compass (the only way into the menu) is pushed off the edge of the screen.

Behind those are quieter gaps:

- The book devices the brief depends on (drop caps, a reading measure, colophons, end-marks) are designed but never reach the essays.
- The collections open as text lists, with their pictures behind a toggle most visitors will never find.
- The mid-level components have been rebuilt page by page.

Almost every fix reuses something the codebase already has. The work ahead is less a redesign than finishing the job: bringing every page up to the standard the best pages already meet.

---

## What's working, and must be protected

- **The hero sentence is a true signature.** "dame is" + role + clause sits on hairline rules that continue under every wrapped line, so it reads as handwriting on ledger paper (`app.css:120-152`; `home__desktop__h13__s0.png`, `home__mobile__h19__s0.png`). It holds up at every hour and at both widths. It also reserves the height of its tallest variant, so the rotation never shifts the feed.
- **One serif voice, applied strictly.** All visible text is Crimson Pro. IBM Plex Mono appears only for at:// URIs, CIDs and code, and the metrics' Plex counts on home turned out to be hidden x-ray spans. Headings, chrome, buttons and the ledger all speak in the same serif.
- **The sky is an idea nobody else has, and it is at its best after dark.** The 6 am navy and amber, 7 pm indigo and orchid, and 9 pm plum-black pages (`home__desktop__h06/h19/h21__s0.png`) have a mood no stock theme has. The hour chip and its 24-swatch "time of day" strip (`state-skyhour-open__desktop__h13.png`) show the idea off well. *Caveat: these same hours are where the metadata ink is least legible; see Theme 1.*
- **Disciplined geometry.** Every radius is 0 (`theme.css:97-99`). About 90 public borders are 1px `--rule` or `--rule-soft` hairlines. Lucide icons are forced to stroke 1.5 (`app.css:31-33`), matching the hairline weight. Drop shadows appear only on overlays such as the lightbox and modal, plus some intentional hour glows.
- **Running heads that teach the protocol.** On detail pages, the breadcrumb strip prints the record's NSID at the right (`/ blogging / … · SITE.STANDARD.DOCUMENT`). While a feed scrolls, the strip names the day and the lexicon under you (`TODAY · APP.BSKY.FEED.POST`, `NIGHT OF OCT 16, 2026 · IS.DAME.MOTHING.OBSERVATION`). This is a book's running head, adapted to AT Protocol.
- **The gerund grammar.** "dame.is/blogging", the "Dame is…" menu and the "dame.is playing tennis" status line all read as sentences. Common guesses are caught by redirects (/about→/themself, /resume→/available, /guestbook→/welcoming). The menu itself is an `is.dame.nav` record, so many of the navigation fixes below are content edits, not deploys.
- **The ledger idea, on desktop.** Verb | content | time columns, hairline rows, serif day headers and dashed continuation rules for threads read like a commonplace book. The ledger is about twice as dense as the cards layout (13,616px vs 26,849px for the same 71 rows). Listening sessions fold into one row and expand in place into a dashed-ruled track list, which is good progressive disclosure.
- **X-ray on a blog post is the best book-meets-protocol moment on the site.** It puts `blocks.text` sidenotes in the margin and an "Atmosphere record" tree (pds → repo → collection → record → cid) opposite (`state-xray-on-blogpost__desktop__h13.png`).
- **Strong detail pages:**
  - the moth-night gallery (specimen plates, session tally, "first sighting", "earlier night");
  - the Ratioed piece, with its lede sentence, stat grid, "Who was there" faces, Provenance table and lifelines chart;
  - the album shelf and album page;
  - the lightbox, whose controls move into the site's own bottom bar;
  - the DocumentMeta colophon band (PUBLISHED / ELAPSED / TAGGED).

  These are the templates the rest of the site should learn from.
- **Sound engineering underneath:**
  - Chrome and content share one column at every width (`--chrome-pad-x`).
  - None of the 74 captures has horizontal overflow.
  - Motion is principled: two main easing curves, compositor-only slides, and reduced-motion respected almost everywhere.
  - There is one visible 2px focus ring site-wide (`reset.css:97-100`).
  - Bottom-bar chips get 44px hit areas on touch.
  - Skeletons breathe between two flat rules instead of shimmering.
  - The fixes from the earlier review have landed: viewport-fit=cover, skip link, error boundary, focus ring, coarse-pointer targets.
- **A clear hiring path.** "Resume" is the only filled CTA under the hero, "available for hire" is the first menu row, and /available shows role, location and contact above the fold at both widths.

**What not to change:** square corners, the single serif, hairline rules, the single always-on sky theme (no warm-paper blend, no silent OS dark-mode swap), the ledger as the home feed's form, and Dame's tuned chrome colours. Every recommendation below works inside these.

---

## Themes

Ten clusters, ordered by impact. In each "Covers" list, the first ID of each group is the best-evidenced version. The IDs in parentheses were merged into it.

### 1. The sky needs a floor: legible at every hour, paper by day, steady on arrival

**The problem.** The palette is derived each hour with no contrast check:

- **The secondary ink fails at most hours.** `--ink-faint` carries the ledger verbs and times, the day stats, the link-card hosts and the hero's "dame is". It measures 2.49:1 at 6 am, 2.63:1 at 7 pm and 2.50:1 at 8 pm, clears 4.5:1 only at 7 am and 9 am, and at 7 am is almost identical to the accent, so the hero's three-tone sentence collapses into two.
- **By day, in-page surfaces turn chrome-cyan.** At 1 pm the owner's tuning (surfaceSep 200) separates the chrome from the near-white page. The same multiplier also scales `--page-edge`, so image mats, moth caption slabs and Exploring cards turn the same saturated cyan as the chrome, and photographs sit in UI-coloured frames.
- **First paint cycles through three palettes.** The tuning record arrives after paint, so a cold load goes white → retired parchment → untuned cyan → tuned page, and the brand mark pops in and pushes the wordmark 34px right.
- **After dark, content images glare.** White screenshots become the brightest objects on the night page.

**Evidence:**
- Contrast recomputed from `skyTheme.js` and the live `is.dame.sky` record (a WCAG script run over all 24 hours).
- `extra/mobile/ledger-labels-by-hour.png`, `home__desktop__h06__s0.png`, `home__desktop__h19__s0.png`, `extra/identity/home-h07.png`.
- `curating-channel__desktop__h13__s0.png` (#b7f1fa mats).
- `extra/interaction/load-home-desktop-800ms/1500ms/3000ms.png`.
- `home__mobile__h00__s0.png`.
- Code: `skyTheme.js:235,289` (no floor), `:241,:295` (surfaceSep scales page-edge), `main.jsx:37`, `useTheme.jsx:128-157`, `theme.css:4-8`.

**Direction.** Keep every hue choice the owner tunes and solve only lightness:
- **Contrast floor.** Add a post-derivation pass in which faint and accent reach ≥ 4.5:1 on the page and on raised surfaces, muted reaches ≥ 6:1, a filled label reaches ≥ 4.5:1, and a minimum ΔE separates faint from accent. Back it with a node test over 24 hours and a ratio row in the Sky studio. Floored values still read as their hour: dusk faint becomes a soft lilac (#bfa7c3), dawn a warm grey-rose (#a59b9e).
- **Quiet in-page surfaces.** Take mats, caption slabs and tiles off surfaceSep and derive them from the existing `--nest-step` ink-into-page mix, so they always sit one quiet step off the paper.
- **Final palette on the first frame.** Bake `is.dame.sky` into the bundle, as `is.dame.nav` already is, and paint the final palette before the first frame. Move the `:root` fallbacks off parchment and reserve the mark's box.
- **Night images.** At dark hours, dim content images slightly. The lightbox restores full brightness.
- **The hour chip and its sheet** should say what they are ("1 PM ET"), tell frozen from live, and be usable by thumb. Readers who pick an hour should keep it, and "your sky" stays an opt-in mode, never an automatic swap.

**Covers:** MOB-01 (IDN-02, FEED-04, TYP-01) · IDN-01 (SYS-04) · INT-02 (IDN-13) · IDN-07 · INT-06 (MOB-07) · GAP-06 · GAP-10

### 2. The ledger, re-set for a phone and as a set of links

**The problem.**
- **On a phone, the grid squeezes the content.** At 390px the ledger keeps its three desktop columns: 80px verb, 206px content, 56px time. Dame's posts run about 27 characters per line, images and quotes render at 57% of the available width, and the labels drop to 9.6px to fit.
- **Larger text breaks it entirely.** The label columns are in rem, so a reader who enlarges text grows the labels and shrinks the content: 114px at 150%, and one letter per line at 200% (a WCAG 1.4.4 / 1.4.10 failure).
- **On desktop, content ends on three different right edges.** Images stop at 666, quotes at 762 and text at 934, while the time sits alone at 1146.
- **Rows give no sign they can be clicked.** A click on blank row space navigates, but nothing shows it: no hover, no cursor change. The only link is the faint verb, and it opens the record rather than the section. Thread continuations, about a third of rows, have no keyboard route to their own record. Home's main content has no links into /mothing, /listening or /logging.
- **Single-kind pages waste their first column.** They repeat "posting", "listening" or "dame.is" on every row, and /logging spends about 126px of scaffolding per one-entry day.

**Evidence:**
- `home__mobile__h13__s0/s1.png`, `posting__mobile__h13__s1.png`.
- `extra/mobile/textzoom-150-posting.png`, `textzoom-200-posting.png`.
- `extra/layout/proto-mobile-ledger-after.png` (a restack prototype: content goes from 206px to 358px wide, +74%).
- `extra/feed/row-hover__desktop.png`, which is byte-identical to `row-nohover`.
- `logging__desktop__h13__s1.png`.
- Code: `Feed.css:2409-2427`, `:1827-1835`, `FeedLedgerRow.jsx:139-147,176`, `FeedItem.jsx:188-211,300-308`.

**Direction.** One grammar at every width: the margin note sits before the entry.
- **Phones.** Under about 36rem, or via a container query so that text zoom also triggers it, each row opens with a running-head caption: verb at left, time at right, 12–13px in floor-contrast ink. The record then runs the full 358px.
- **Desktop.** Text, images and quotes share one right edge at the measure. Verb and time stack in the left margin as a margin note, and the right margin is free for quiet engagement notes.
- **Links.** The time becomes the row's permalink (`<a><time>`) on every row, continuations included. The verb links to its section, or to the home ledger filtered to that verb.
- **Hover and focus.** Rows get a quiet hover and focus-within state: a 2px accent pencil-mark in the gutter and underlined verb and time.
- **Single-kind pages** honour `showVerb={false}`. /logging becomes a diary with a running date in the margin.

**Covers:** MOB-02 (LAY-01, FEED-01, TYP-11) · FEED-03 (INT-07, NAV-04) · LAY-04 (FEED-07) · FEED-10 (COL-09) · LAY-08

### 3. A ledger that tells the truth about itself

**The problem.**
- **Deep in the feed, the ledger is a skewed sample.** Every collection is fetched once, capped at 100 records. Busy collections run out after a few days while sparse ones reach back years. Dame's own posts stop after Oct 25, and September shows only status logs and follows. Oct 23 has no posts at all, though Dame posted 61 times that day, and the feed ends at "January 1, 2011" with no end-mark. The day headers still imply completeness, and the filter counts of "100" look like totals.
- **Reposts outweigh Dame.** They are tinted, bordered Bluesky cards with unclamped text, and they take about 34% of the feed's height. A quote inside Dame's own post is clamped to two lines, the reverse of what authorship would suggest.
- **Times and headers contradict themselves.** One row can carry two clocks ("11:16 pm" next to "17h ago"). Threads list oldest-first inside a newest-first column and cross midnight without a date. Year-only works print "12:00 am". The day headers mean different things on different pages ("23 items, 289 interactions" on home, "Day 12,227" on /posting and /logging).
- **The filter sheet is hard to read.** It is a ragged cloud of chips in which the white "off" chips stand out more than the tinted "on" ones.

**Evidence:**
- `extra/feed/home-feed-end__desktop.png`, `state-home-scrolled-deep__desktop__h13.png`.
- A live probe of all 189 day groups, plus the public `getAuthorFeed` (61 posts on Oct 23).
- `home__desktop__h13__s1.png` (reposts), `home__desktop__h13__s2.png` (time order 1:27 → 1:29 → 1:46 → 1:44 → 1:41).
- `state-filters-open__desktop__h13.png`, `state-filters-open__mobile__h13.png`.
- Code: `Home.jsx:47-51` (100 per collection), `threadGrouping.js:85-133`, `FeedLedgerRow.jsx:235-296`, `FeedFilters.css:10-14,190-201`.

**Direction.**
- **A completeness horizon.** Compute the oldest date at which every active collection is still complete, stop there, and close with a printed colophon: "End of the ledger · complete back to Sunday, October 25", with links to each gerund page. Later, paginate each collection by cursor so the horizon moves.
- **Reposts as citations.** Set them as epigraphs: a hairline left rule, a single small-caps attribution line, two lines of text and an in-place "+ more", so the ruled rhythm stays intact.
- **One clock per row.**
- **Threads** get a margin bracket, a "thread · 5" label and a time range, and any member from another day carries its date.
- **Year-only works** move to an "Earlier works" coda that shows years, not clock times.
- **One day-header format** everywhere: "Today · Tuesday, 27 October" with "day 12,227 · 23 records" as the running head at the right.
- **The filter sheet** becomes an index: grouped lines with ■/□ marks, a one-line gloss for each verb, dot leaders, counts labelled "since Oct 25", and a separate "only" link.

**Covers:** FEED-02 · FEED-05 (IDN-05, FEED-11) · FEED-06 · FEED-08 (LAY-12, INT-08, MOB-13) · FEED-09 · FEED-12 · FEED-13

### 4. The book devices are designed but not applied

**The problem.** The brief is "a book's interior", and the essays are where readers spend the most time, yet they get the least book treatment:
- **No drop cap on any essay.** Drop caps appear on the résumé and the Exploring intro only. The shared rule targets the retired `.blog-prose` markup, and essays now render through `.leaflet-doc`.
- **Lines run too long.** Long-form is set at 16.8px with a median of about 85 characters per line, because `--measure: 65ch` is measured in Crimson's wide zero.
- **Paragraphs are signalled inconsistently.** The first break in each run gets space plus an indent, and every later break gets only the indent.
- **Typewriter punctuation reaches the biggest type.** Straight quotes appear even in the 48px H1 ("like it's"), along with "..." and " - ".
- **The heading ladder is nearly flat.** h3 is 1.07× the body size, and h4–h6 inherit body size through an undefined `--text-md`. The longest guide has 46 such headings.
- **Lines end in runts** (single short words on the last line).
- **Essays have no ending.** There is no end-mark and no next essay; they run straight into comments and the footer.
- **Photographs are held to the measure.** Photo series sit inside the 588px column as 288px thumbnails, with holes beside the tall frames, even though `--doc-overhang` is already computed to let figures widen.
- **Printing works only for the résumé.** An essay printed after dark comes out pale grey.

**Evidence:**
- `blogpost__desktop__h13__s0.png`, `__s1.png`, `__bottom.png`; `available__desktop__h13__s0.png` (where the drop cap does work).
- `extra/typography/headings-h4-desktop.png`, `creating-work-photos__desktop__h13__s1.png`, `extra/gaps/print-compare.png`.
- Code: `typography.css:154-158,192`, `LeafletDocument.jsx:278-281`, `LeafletDocument.css:3,11-18,31-42,293-302`, `theme.css:83`, `Blogging.css:115-130`.
- PDS punctuation census: roughly 700 straight vs 200 curly quote marks across 26 documents.

**Direction.**
- **Drop cap.** Two selector lines (`.leaflet-doc > .leaflet-paragraph:first-child::first-letter` in both rules), plus a visual regression check so it can't silently break again.
- **Size and measure.** Set long-form at 20px / 1.55 with the measure expressed in `em` (about 70 characters per line); phones at 18px.
- **Paragraphs.** Indent-only, with credits trimmed so they sit under their figure.
- **Punctuation.** A display-only smart-punctuation pass applied after facet slicing. X-ray keeps showing the raw text: the page is the typeset edition, the inspector the manuscript.
- **Headings** are told apart by style as well as size.
- **Wrapping.** `text-wrap: balance` for headings and `pretty` for paragraphs.
- **An ending.** A centred ❧ end-mark, then a colophon with previous and next essays.
- **Plates.** Galleries break the measure into the computed overhang as justified rows with plate numbers.
- **Print.** Print tokens on `:root` and a printed colophon (URL, at:// URI, date).
- **Ornament.** One family (❧, or a drawn moth-wing) for end-marks, day dividers and empty-image placeholders, replacing the 🦋 emoji.

**Covers:** TYP-02 (IDN-03) · TYP-03 · TYP-04 · TYP-07 · TYP-08 · TYP-13 · COL-04 (LAY-09, IDN-06) · IDN-12 · GAP-08

### 5. Collections hide their own pictures

**The problem.**
- **Visual collections open as text.** One global "feed layout" preference defaults to the text-only ledger, so the portfolio (/creating), the image galleries (/curating), the essays (/blogging) and the moth archive (/mothing) all open as bare text lists. The richer views (cover plates, a numbered table of contents with summaries and full dates, specimen tiles) already exist. The only way to them is two unlabeled glyphs that appear only while the compass menu is open.
- **Phone grids fall to one column.** Three of them miss two columns by 6–42px, so the 222-image channel becomes an 82,547px scroll of one letterboxed photo per screen.
- **/mothing reads like a spreadsheet.** It lists all 519 observations as 40px-thumbnail rows on one 32,683px page, and its beautiful night galleries sit behind headings with no visible link cue on touch.
- **Smaller gaps.** Album titles are cut to 10–12 characters. The 13.6k px Ratioed essay has no contents. The lightbox has no swipe, caption or provenance.

**Evidence:**
- `creating__desktop__h13__s0.png`, `curating__desktop__h13__s0.png`, `blogging__desktop__h13__s0.png` vs `extra/collections/cards-*.png`.
- `state-nav-open__desktop__h13.png`, `curating-channel__mobile__h13__s0.png`.
- `mothing__desktop__h13__s0.png`, `mothing-night__desktop__h00__s0.png`, `extra/collections/albums-wait__desktop.png`.
- Code: `useFeedLayout.jsx:6`, `ChromeBar.jsx:672-684`, `Curating.css:12`, `Mothing.css:90,213-216,272-284`, `ExploringHome.css:50`.

**Direction.**
- **Each section gets its native form by default**, with a visible small-caps "plates · index" switch beside the heading, remembered per section:
  - /creating: a catalogue of 4:3 plates;
  - /curating: contact-sheet rows;
  - /blogging: a numbered contents page with dot leaders to a date folio;
  - /mothing: an almanac of nights.

  The home feed keeps its own preference.
- **Phone tracks** use `minmax(min(…), 1fr)`: a 3-up contact sheet for channels, 2-up specimen plates for moths. The album shelf already shows the pattern.
- **Coverless works** get a typographic plate instead of an empty box.
- **The lightbox** gains swipe and a caption line with the record link.

**Covers:** COL-01 (IDN-04) · LAY-03 (COL-02) · COL-03 · COL-10 · COL-13 · INT-14

### 6. Records are landing pages, but read like debug output

**The problem.** Every home-ledger row, and most shared links, land on a record page:
- **The "up" path is broken.** For 10 of the 17 feed verbs (reposting, liking, following, observing…) the section crumb leads to "Nowhere to be found", and on a fresh tab the bottom bar's Back falls back to the same 404. When a visitor arrives in the same tab from search or an aggregator, Back leaves the site.
- **Posts and plays have no heading.** The trail ends in a TID ("3myujs5nl522g") and the loudest element on the page is a highlighted at:// string.
- **Width and furniture vary.** Records are 484px or 588px wide depending on content. Two button styles stack, and an empty "Replies" section fills the lower half.
- **Detail pages don't share a template.**
  - Content starts at x=230, 426 or 478.
  - Some pages carry a third back link above the H1 and some don't.
  - Some print "WRITTEN — · UPDATED —".
  - Only Ratioed and moth nights offer next and previous.
- **Moving between pages flickers.** Tapping a row 4,000px down briefly shows the home hero, ghosted under the new page's running head.

**Evidence:**
- `record-reposting__desktop__h13__s0.png` → `extra/nav/reposting-crumb-click__desktop.png`.
- `record-posting__mobile__h13__s0.png`, `record-logging__desktop__h13__s0.png`, `record-listening__desktop__h13__s0.png`.
- `album__desktop__h13__s0.png`, `extra/interaction/route-120ms.png`, `extra/layout/lay-measure.json`.
- Code: `ChromeBar.jsx:449-452,610-618,1083-1096`, `App.jsx:89-108`, `Blogging.css:399-402`, `Record.jsx:253-292`, `RouteTransition.jsx:33-55`.

**Direction.** One detail "plate" with fixed slots:
- **Breadcrumb.** The parent resolves through the verb registry: the section index if one exists, otherwise the home ledger filtered to that verb. The last crumb is a human label ("Oct 25 · 9:28 pm").
- **Heading.** An H1 in the hero's two-tone voice ("dame was / letting the possums go on a full moon").
- **Colophon.** One line in Dame's time: "Sunday, October 25, 2026 · 9:28 pm ET · day 12,225".
- **Actions and URI.** One row of actions, and the at:// URI as a quiet mono folio broken at its "/" boundaries.
- **Sequence.** Previous and next within the collection.
- **Replies.** An empty section collapses to one line.
- **Back** means "up one level" whenever there is no in-app history. In-page eyebrows go.
- **Layout.** Long-form and record columns hang from the same left edge as the breadcrumb, and the freed right margin holds marginalia.
- **Transitions.** The route transition resets scroll only after the old page has faded.

**Covers:** NAV-01 · INT-01 · COL-05 (NAV-06) · COL-06 (LAY-05, LAY-07) · SYS-10 (NAV-11) · NAV-09 · INT-05

### 7. First impressions and the map

**The problem.**
- **The only statement about Dame keeps changing.** It is the rotating hero sentence, which rewrites itself every 4–8 seconds indefinitely and has no pause on touch (WCAG 2.2.2). Nothing stable beside it says who Dame is or what the site is, and the ⓘ sheet explains atproto rather than Dame.
- **The compass menu is a bare list.**
  - It lists 9 gerunds with no gloss, so "mothing" and "themself" are left to guesswork.
  - The current row and the hovered row look identical.
  - On desktop, about 290px of the sheet above the list is dead space.
  - Opening it swaps the left tools for an unlabeled layout toggle.
- **Pages don't speak the "dame is ___" grammar.** The italic-accent `.gerund` title style is defined but never used, and /welcoming is titled "Guestbook".
- **Several pages dead-end.**
  - /themself, the target of /about, is a dead end because its record is missing, and its footer prints "WRITTEN — · UPDATED —".
  - /sharing shows the owner's authoring instructions to visitors.
  - The 404 offers one link.
  - An empty filter result offers no reset.
- **Archives have no search.** They run 16k–42k px with nothing to search them by, although search is built and switched off.
- **The hiring story is split.** It is spread across a résumé and an essay that pitch different roles and use different inboxes.

**Evidence:**
- `home__mobile__h13__s0.png`, `state-info-open__desktop__h13.png`.
- `state-nav-open__desktop__h13.png`, `extra/nav/nav-open-on-blogging-hover__desktop.png`.
- `themself__desktop__h13__s0.png`, `sharing__desktop__h13__s0.png`, `notfound__desktop__h13__s0.png`, `extra/gaps/search-hidden-logging-q-tennis.png`, `extra/gaps/jobpost__desktop.png`.
- Code: `HeroSentence.jsx:136-159,210-215`, `ActionDock.css:69-91,163-172`, `app.css:103-106`, `ChromeBar.jsx:48-51`, `Sharing.jsx:25`, `NotFound.jsx:4-15`.

**Direction.**
- **The hero holds.** It settles after three rotations or once the visitor scrolls past it, and a tap holds it. A fixed standfirst under it says who Dame is and links into two or three sections.
- **ⓘ opens with Dame and the sections**, then the protocol, then a key to the toolbar.
- **The compass becomes a table of contents:**
  - "dame is" set large;
  - gerund rows with a one-line gloss and a live folio;
  - a manicule marking the current page;
  - hover shown by underline;
  - grouped rows;
  - a search field at the top;
  - a compact sheet over a page-coloured veil.
- **Section titles** read "dame is / *blogging*".
- **Empty pages get a voice.** "This page intentionally left blank", a /themself fallback built from the Bluesky profile with a "Find Dame" ledger, and owner hints shown to the owner only.
- **/available becomes the hiring hub**, with a marginalia column.

**Covers:** MOB-10 (INT-12) · NAV-02 · NAV-03 · IDN-08 (TYP-12) · NAV-08 · NAV-13 · INT-09 (NAV-14, SYS-12, LAY-10, NAV-10, COL-11) · NAV-07 · GAP-07 · GAP-05

### 8. The chrome is the live layer, but it doesn't step aside or explain itself

**The problem.**
- **It takes too much of the screen.** On desktop, 167px of atmosphere tiers and breadcrumb stay pinned above long-form, plus the 58px bottom bar: 25% of a 900px screen, rising to 30% at page end. A landscape phone gets the desktop default and loses 52–58% of the screen. Portrait phones hide the atmosphere behind an unlabeled 28px chevron.
- **The tools are unlabeled.** The bottom bar is 6–8 identical icon squares. Six have no tooltip on desktop, and 770px of empty bar sits between the two clusters. "1PM" reads as a clock. The scrolled-past counter is a bare number. The microscope that opens x-ray is explained only in the fourth paragraph of the ⓘ sheet.
- **The bottom bar can't shrink.** It has no overflow strategy, so at 320px (or at 390px with 125% text) the compass is clipped off-screen.
- **States lie on touch.** On touch, `:hover` sticks, so a closed toggle still looks open. The compass's open state drops to 2.03:1.
- **Live signals don't age.** "LISTENING TO" stays on a song played eight hours ago. The vitals row is the only unlabeled row.
- **Overlays behave inconsistently.** Sheets anchor and dismiss differently. The back gesture navigates away instead of closing the open sheet, and an open sheet carries over onto the previous route.

**Evidence:**
- `blogpost__desktop__h13__s1.png`, `extra/gaps/landscape-blogpost__mobile.png`, `home__desktop__h13__s0.png`.
- `extra/mobile/bottombar-posting-320.png`, `extra/mobile/textzoom-125-posting-bar.png`, `extra/mobile/sticky-hover-info.png`.
- `state-chrome-toggle__mobile__h13.png`, `state-guestbook-sign__mobile__h13.png`.
- Code: `ChromeBar.css:40-56,536-551,764-771`, `useChromeBar.jsx:5-17`, `NowPlaying.jsx:17-31`, `BottomSheet.jsx`.

**Direction.**
- **Condense while reading.** The atmosphere tiers act as a masthead that scrolls away, or condenses past the hero. One 58px pinned running head folds the breadcrumb in. Collapse defaults depend on height as well as width.
- **Label the tools.** On desktop, small-caps labels go in the empty bar: "1 PM ET SKY · FILTER · ABOUT · INSPECT … 69 OF 142 · TOP · HOME · CONTENTS". Every chip gets a title. ⓘ opens with a key.
- **Give the bar priorities.** The compass is pinned; Home and About move into the dock when space runs out.
- **Make states honest on touch.** Hover rules apply only under `(hover: hover)`, and an open chip shows ×.
- **Let the signals age:** "last played · 4h", and "DAME'S PHONE · 4M AGO" on the vitals row.
- **One SheetHeader** for every sheet. Overlays push a history entry so Back closes them.

**Covers:** LAY-02 (MOB-05, INT-13) · GAP-03 · NAV-05 (MOB-09, INT-11) · MOB-03 · MOB-06 · MOB-08 · NAV-12 · GAP-04 · INT-04 (SYS-06, MOB-12) · MOB-04

### 9. One volume, many hand-built parts

**The problem.** The tokens and primitives are disciplined, but mid-level components have been forked page by page:
- **Buttons.** About 11 treatments for a quiet action, 27–40px tall, including four separately styled "load more" buttons.
- **Selected states.** Five grammars for "selected", including one the compass draws at 2.03:1.
- **Stats.** Six stat-block idioms. On /listening, "463" sits 11px above its neighbours.
- **Section heads** at 12, 14, 22 and 28px. "36 SIGNATURES" is the loudest text on its page after the H1.
- **Type sizes.** 26 rendered sizes, 13 of them between 9.28px and 12.6px. Some of these sit inside hidden x-ray spans, but the visible ones still include 9.28px table heads and 9.6px ledger labels.
- **Small caps** are synthesized by the browser, at four trackings, and turn "dB" into "DB" and "1mo" into "1MO".
- **Dates and times.** Five date formats and three time styles. Two rounding rules print "2 years ago" and "1y ago" for the same record on the same page. Three clocks (Eastern for the sky, the viewer's zone for the ledger, UTC for long dates) make the day-of-life folio one day high everywhere west of Greenwich.
- **Tokens.** `--text-md` and `--surface-*` are undefined, so h4–h6 and some hovers fail silently.
- **Forks.** A forked cover thumbnail lost its error fallback and shows broken-image glyphs. The link card is built twice. Bar charts misalign row to row.

**Evidence:**
- `extra/sys/button-zoo.png`, `selected-states.png`, `stat-zoo.png`.
- `listening__desktop__h13__s0.png`, `welcoming__desktop__h13__s0.png`, `extra/typography/zoom-footer-available-2x.png`.
- `extra/gaps/tz-evening-record-NY-3myqkzyynpy23.png`, `ratioed-participants__desktop__h13__s2.png`.
- Code: `app.css:226-269`, `Record.css:49-68`, `ListeningStats.css:33-57` / `StateStats.css:31-55` / `Albums.css:59-83` (identical), `ChromeBar.css:677-681`, `time.js:16-28,73-95,145-158,190-194`, `dayOfLife.js:16-27`, `ListeningStats.jsx:188-195`.

**Direction.** A small kit in the house idiom, all square, serif and hairline:
- **Button**: quiet, primary, text and icon, each at sm (28px) and md (36px).
- **One selected state**: an accent wash with an accent hairline. A solid fill is reserved for the primary action.
- **Segmented**, extracted from the three identical copies.
- **Figures**, in DocumentMeta's grammar: label above, ink tabular numeral on a shared baseline, ruled cells, no boxes.
- **Eyebrow and SectionHead.** Two tiers plus the H1; counts move to a right-aligned meta, as in the day header.
- **One label style**: real uppercase at 12px, one tracking, units exempt.
- **Thumb** with loading, empty and error states, and **LinkCard**.
- **Time**: one clock (America/New_York), one house style ("3:17 pm", "January 29, 2025", "Jan 2025"), relative times only under a week.
- **Tokens**: `--text-2xs` as an 11px floor, `--wash-hover` / `--wash-selected`, control heights, two breakpoints.
- **Guards**: stylelint rules, and an owner-only colophon page that renders the kit under four sky hours.

**Covers:** SYS-01 · SYS-02 (MOB-11) · SYS-03 (LAY-06, COL-07, IDN-11) · SYS-05 (TYP-09) · TYP-05 · TYP-06 · TYP-10 (COL-08, SYS-11) · GAP-02 · SYS-07 · SYS-08 (IDN-09) · SYS-09 · COL-12 (LAY-11)

### 10. The protocol moments undersell themselves

**The problem.** A handful of features make the AT Protocol tangible, and each loses its impact at the last step:
- **X-ray on home hides the content it should explain.** Every ledger row is replaced by an at:// string and a CID, so a reader can't tell which post is which. The x-ray line is `aria-hidden`, and the chrome's live signals and the hero have no record attached, which undercuts the promise "the record behind each element".
- **At-URIs break mid-token** ("is.dam / e.now").
- **The guestbook is uninviting.** It is the site's one invitation to take part, yet it asks for a handle before you can write a word, behind a grey 50%-opacity button that looks broken. Its entries read like social replies, with a CID line given the same weight as the guest's location.
- **Bluesky links detour.** Every timestamp and @handle opens an unexplained "Open in…" chooser that never remembers your choice.
- **Share cards lose the best material.** Shared post links unfurl without their photo, and image-only posts answer HTTP 404 + noindex at the edge.

**Evidence:**
- `state-xray-on__desktop__h13.png` vs `state-xray-on-blogpost__desktop__h13.png`.
- `record-logging__mobile__h13__s0.png`.
- `state-guestbook-sign__mobile__h13.png`, `welcoming__desktop__h13__s1.png`.
- `extra/gaps/waypoints-desktop.png`, `extra/gaps/og-post-gm-cooper.png`.
- curl `/posting/3myujs5nl522g` → 404.
- Code: `Xray.css:79-95`, `LedgerXrayLine.jsx:15`, `SignInPanel.css:31-56`, `GuestbookEntryRow.jsx:139-146`, `useWaypointsModal.jsx:37-63`, `og/records.js:163,353`.

**Direction.**
- **X-ray works as marginalia everywhere.** Content stays legible. The verb column becomes the collection NSID and the time column the rkey and CID. A tapped row opens the record tree. The chrome signals get dotted underlines naming their lexicon, or saying "not a record". The HUD says "71 records in 6 collections — tap a row".
- **At-URIs break at their "/" boundaries.**
- **The guestbook asks for the words first.** It opens on the note, with a live preview of the entry as it will appear, then a single "Sign with atproto →". Entries are laid out as a ruled register.
- **The chooser explains itself.** It gets a one-line explanation, a descriptor per app ("Anisota — made by Dame") and "always open here".
- **Post share cards** carry the photo as a plate, and an existing post never returns a 404.

**Covers:** INT-03 (IDN-10) · TYP-14 · INT-10 · COL-14 · MOB-14 · GAP-09 · GAP-01

---

## Roadmap

Effort: **S** is under a day, **M** a few days, **L** a week or more. The "Now" items are the most visible problems with the cheapest fixes, plus the two structural fixes that unblock the rest: the contrast floor and the responsive ledger. The Status column was checked against the code after #331 and #332, and updated again after the batch that implemented c-05, c-10, c-11, one clock and share cards; done rows are struck through.

| Bucket | Item | Effort | Findings | Status |
|---|---|---|---|---|
| **Now** | ~~Sky contrast floor: a post-derivation lightness pass (faint and accent ≥ 4.5:1, muted ≥ 6:1, filled labels ≥ 4.5:1, ΔE between faint and accent), a 24-hour unit test, a ratio row in the Sky studio; the compass's open state stays dark~~ | M | MOB-01, IDN-02, FEED-04, TYP-01, SYS-02, MOB-11 | ✓ Done: Floored per hour with a 24-hour test (#331, #332) |
| **Now** | Responsive ledger: a running-head caption above a full-width body under ~36rem or via container query; no label below 12px | M | MOB-02, FEED-01, LAY-01, TYP-11 | Mostly: on a phone, home, /posting, /logging and /listening are one column with a caption beneath each entry (gerund, time, and a post's counts; /listening keeps its cover beside the song). On a desktop a post's counts sit on a quiet line under it. The 12px label floor hasn't been checked page by page |
| **Now** | ~~Paths that work: crumbs resolve through the verb registry (filtered ledger for verbs without an index); Back uses router state and means "up" on a deep link~~ | S | NAV-01, INT-01 | ✓ Done: Crumbs link only to real routes; generated `/{verb}` indexes; Back walks history |
| **Now** | ~~Bottom bar survives small screens: the compass is pinned, low-priority chips move into the dock, hover is guarded for touch, an open chip shows ×~~ | M | MOB-03, MOB-06 | ✓ Done: Compass pinned last, chips that don't fit move to the compass sheet, touch-safe hover, × on an open chip |
| **Now** | ~~Drop caps on `.leaflet-doc` (two selectors and a regression check), plus a ❧ end-mark~~ | S | TYP-02, IDN-03 | ✓ Done |
| **Now** | ~~Phone grids: `minmax(min(…),1fr)` tracks for curating, moth plates and exploring~~ | S | LAY-03, COL-02 | ✓ Done: Exploring stats are now a two-up Figures band |
| **Now** | ~~Steady first paint: bake `is.dame.sky` into the bundle, pre-paint the final palette, move `:root` fallbacks off parchment, reserve the mark's box~~ | S | INT-02, IDN-13, IDN-07 | ✓ Done: Sky painted at boot; 1 KB mark |
| **Now** | Hero holds: stop after 3 rotations or off-screen, tap to hold, run the marquee once | S | MOB-10, INT-12 | Partly: Rests off-screen; ticker runs once. Tap-to-hold dropped by choice in #332 |
| **Now** | ~~Ledger rows as links: time as permalink on every row, verb links to its section, quiet hover and focus-within mark~~ | S | FEED-03, INT-07, NAV-04 | ✓ Done: Time is the permalink on every row, verb links to its section, hover and focus mark |
| **Now** | ~~Visitor-facing dead ends: /themself fallback, /sharing hint for the owner only, a 404 with a voice, hide em-dash footers and the useless scroll chip~~ | S | INT-09, NAV-07, COL-11, NAV-10, NAV-14, SYS-12 | ✓ Done: /themself fallback, /sharing for visitors, 404 lists the site |
| **Now** | Small correctness fixes: reuse AlbumCover in /listening, define `--text-md`, sign-in error in `--danger`, `text-wrap`, upright code, scope the `p + p` indent to prose | S | SYS-08, IDN-09, SYS-09, TYP-08, TYP-13, TYP-14, LAY-10 | Partly: Upright code inside italics is still open |
| **Now** | ~~Never 404 an existing post: title from image alt text when the text is empty; add reposting and the other verbs to `RECORD_SECTIONS`~~ | S | GAP-01 | ✓ Done |
| **Next** | ~~Ledger horizon: stop at the completeness date with a colophon; label capped counts "100+" / "since Oct 25"~~ | M | FEED-02 | ✓ Done: Closing colophon; capped counts read "100+" |
| **Next** | Reposts and quotes typeset as citations; one clock per row; no repeated URL on link-only posts | M | FEED-05, IDN-05, FEED-11, FEED-12 | Partly: Link-only posts print the link once. Citations and one clock per row were built, then put back to the earlier boxes at Dame's request |
| **Next** | Threads bracketed with a time range and cross-day dates; one day-header format; an "Earlier works" coda for year-only works | M | FEED-06, FEED-09, FEED-13 | Partly: One day-header format and the "Earlier works" coda are done. The thread bracket and folio were built, then put back to the earlier rows at Dame's request |
| **Next** | Desktop ledger: one right edge for all content; verb and time as a left-margin note | S | LAY-04, FEED-07 | Open |
| **Next** | ~~Filter sheet as an index (■/□, gloss, dot leaders, counts, a separate "only")~~ | M | FEED-08, LAY-12, INT-08, MOB-13 | ✓ Done |
| **Next** | ~~Single-kind pages: honour `showVerb={false}`; /logging as a diary with running dates; covers on /listening sessions~~ | S | FEED-10, COL-09, LAY-08 | ✓ Done; /logging later went back to a day header like the other pages |
| **Next** | Native section layouts by default (plates, contact sheet, numbered contents) with a visible per-section "plates · index" switch; album tiles with a folio line | M | COL-01, IDN-04, COL-10 | Partly: Section switch, plates, contact sheet, almanac; album folio line open |
| **Next** | In-page surfaces off surfaceSep and onto the nest-step mix (scoped class, not `:root` tokens) | M | IDN-01, SYS-04 | Partly: Page edge done; raised/deep surfaces still scale with surfaceSep |
| **Next** | ~~Chrome condenses while reading: tiers as masthead, breadcrumb folded into the pinned row, height-aware default~~ | M | LAY-02, MOB-05, INT-13, GAP-03 | ✓ Done: Running head plus masthead; height-aware default |
| **Next** | ~~Tools that say what they do: desktop small-caps labels, a title on every chip, a "69 of 142" folio, a key in ⓘ, a vitals label and freshness, now-playing that ages, a larger chevron and crumb targets~~ | S | NAV-05, MOB-09, INT-11, NAV-12, GAP-04, MOB-08 | ✓ Done |
| **Next** | Compass as table of contents: glosses, live folios, a current-page manicule, underline hover, grouped rows, search at the top, gerund page titles | M | NAV-03, IDN-08, TYP-12, NAV-08, NAV-13, GAP-07 | Open: Dame chose to keep the compass a plain list |
| **Next** | ~~Sheets: a shared SheetHeader, a compact nav sheet over a veil, a history entry per overlay, a thumb-zone close~~ | M | INT-04, SYS-06, MOB-12, MOB-04 | ✓ Done: Shared header, veil, thumb-zone close, Back closes the open overlay |
| **Next** | ~~Record plate: human H1, ET colophon, one action row, previous/next, a quiet URI folio, collapsed empty replies, in-page eyebrows removed~~ | M | COL-05, NAV-06, NAV-09, COL-06, SYS-10, NAV-11, LAY-07 | ✓ Done |
| **Next** | ~~Route transition: reset scroll after the exit fade, or fade in only~~ | S | INT-05 | ✓ Done |
| **Next** | ~~One clock and one date style: a `<Time>` component on America/New_York, dayOfLife from Eastern calendar days shared with og/time.js~~ | M | GAP-02, TYP-10, COL-08, SYS-11 | ✓ Done |
| **Next** | ~~Long-form setting: 20px with an em measure, indent-only paragraphs, display-only smart punctuation, a styled heading ladder~~ | M | TYP-03, TYP-04, TYP-07, TYP-08 | ✓ Done |
| **Next** | The kit: Button, the selected state, Segmented, Figures, Eyebrow/SectionHead, the label style, LinkCard | M | SYS-01, SYS-03, SYS-05, TYP-05, TYP-09, LAY-06, COL-07, IDN-11, TYP-06, SYS-07 | Partly: Built and in use; the switch to real-capital labels is held for Dame to see first (typography.css) |
| **Next** | ~~First visit: a fixed standfirst under the hero; ⓘ rewritten to start with Dame and the sections~~ | S | NAV-02 | ✓ Done: ⓘ rewritten; standfirst dropped by choice in #332 |
| **Next** | ~~Share cards with photo plates; repost cards with the original author~~ | M | GAP-01 | ✓ Done |
| **Later** | ~~/mothing as an almanac of nights (tallies, most-seen plates, a filmstrip per night, months collapsed)~~ | L | COL-03 | ✓ Done |
| **Later** | ~~X-ray as marginalia on every page, including the chrome signals and the hero; the URI as an accessible description~~ | L | INT-03, IDN-10, TYP-14 | ✓ Done: URI description on ledger rows only |
| **Later** | Guestbook: compose first with a live preview, register-style entries, CID moved to x-ray | M | INT-10, COL-14, MOB-14 | Partly: Live preview open |
| **Later** | Plates: galleries break the measure as justified rows; lightbox swipe, caption and record link | M | COL-04, LAY-09, IDN-06, INT-14 | Partly: Lightbox record link open |
| **Later** | One text block: long-form and records hang from the breadcrumb edge, with a marginalia column | L | LAY-05, COL-06 | Partly: Essays done; record pages open |
| **Later** | Ratioed: a contents row, headings aligned with their breakout figures, shared tracks for the participants board | M | COL-13, COL-12, LAY-11 | Partly: Participants board tracks done; contents row, heading alignment, bar label column open |
| **Later** | Sky sheet: a labelled scrubber, frozen vs live, a remembered hour, an opt-in "your sky" | M | INT-06, MOB-07, GAP-06 | Partly: Remembered hour and "your sky" open |
| **Later** | Night treatment for content images | S | GAP-10 | Open |
| **Later** | One ornament family (❧ or a moth-wing) for end-marks, day dividers and empty images; retire 🦋 | S | IDN-12 | Partly: Fleuron on essay ends, the ledger's end and missing moth photos; 🦋 retired; day dividers open |
| **Later** | ~~Print styles for long-form, with a printed colophon~~ | S | GAP-08 | ✓ Done |
| **Later** | /available as the hiring hub (marginalia column, link to the essay, Bluesky and GitHub) | S | GAP-05 | Open |
| **Later** | The "Open in…" chooser explains itself and remembers | S | GAP-09 | Open |
| **Later** | Cursor-paginated collections so the ledger horizon moves as the reader scrolls | L | FEED-02 | Open |
| **Later** | Oldstyle prose figures (self-host upstream Crimson Pro) | M | TYP-06 | Open |
| **Later** | Guards: stylelint allow-lists, two breakpoints, an owner-only kit/colophon page | S | SYS-09 | Open |

---

---

## Mockups

Thirteen concepts carry the roadmap into drawings, built in the site's own language — Crimson Pro, square corners, hairline rules, and the real sky tokens at the hour named — with the current screen beside each one. Open [`index.html`](index.html).

| | Concept | Findings answered |
|---|---|---|
| [c-01](index.html#c-01) | **The ledger.** On a phone, verb and time ride above the post; on a desk, the time moves in beside it | LAY-01, FEED-01, MOB-02, TYP-11, FEED-07, LAY-04, FEED-03, INT-07, NAV-04 |
| [c-02](index.html#c-02) | **The sky palette.** A sky that stays legible at every hour, and paper by day | MOB-01, IDN-02, TYP-01, FEED-04, IDN-01, INT-02, IDN-13, INT-06, MOB-07 |
| [c-03](index.html#c-03) | **Collections.** The portfolio and the galleries open on their pictures, not on a list of titles | COL-01, IDN-04, COL-02, LAY-03, COL-04, LAY-09, IDN-06, COL-11, COL-08, INT-14 |
| [c-04](index.html#c-04) | **Collections.** /mothing becomes an almanac of nights, and each night opens as a drawer of plates | COL-03, COL-02, LAY-03, LAY-06, COL-07, IDN-06 |
| [c-05](index.html#c-05) | **Chrome.** The chrome steps aside while you read, and every tool says what it does | LAY-02, MOB-03, NAV-05, MOB-09, MOB-06, INT-01, MOB-05, INT-13, INT-11, NAV-12, MOB-08, NAV-11, IDN-07 |
| [c-06](index.html#c-06) | **Navigation.** The compass menu becomes the site’s table of contents | NAV-03, IDN-08, TYP-12, NAV-13, NAV-08, SYS-02, MOB-11, INT-04, MOB-12 |
| [c-07](index.html#c-07) | **Records.** Every record is a page you can land on | NAV-01, COL-05, NAV-06, NAV-09, NAV-11, SYS-10, COL-06, NAV-14 |
| [c-08](index.html#c-08) | **Reading.** Set essays like a book: one text block, a drop cap, a 66-character line, and the next essay at the end | IDN-03, TYP-02, TYP-03, TYP-04, TYP-07, TYP-08, TYP-13, NAV-09, IDN-12, LAY-05 |
| [c-09](index.html#c-09) | **First impressions.** A first page that introduces Dame, and an about page that exists | NAV-02, NAV-07, MOB-10, INT-12, INT-09, COL-11, NAV-10 |
| [c-10](index.html#c-10) | **The ledger.** Dame’s posts at full voice, other people cited in the margin, and a ledger that says where it ends | FEED-05, IDN-05, FEED-06, FEED-09, FEED-11, FEED-12, FEED-02, FEED-10, LAY-08, COL-09, SYS-08 |
| [c-11](index.html#c-11) | **System.** One set of controls: a button, an “on”, a figures band, two label voices and a sheet header, used everywhere | SYS-01, SYS-02, SYS-03, SYS-05, SYS-06, SYS-07, SYS-11, TYP-05, TYP-06, TYP-09, TYP-10, LAY-06, COL-07, IDN-11, FEED-08, LAY-12, INT-08, MOB-13 |
| [c-12](index.html#c-12) | **Signature features.** X-ray keeps the page and writes its records in the margins, on every page | IDN-10, INT-03 |
| [c-13](index.html#c-13) | **Visitors.** The guestbook becomes a visitors’ book you write in first and sign once | INT-10, COL-14, TYP-09, SYS-12, COL-11 |

## Relationship to `RECOMMENDATIONS.md`

That earlier review covered security, performance, data robustness and code health as well as accessibility. This one is about design and UX. Where the two overlap, the items from the earlier review that have since landed (viewport-fit, skip link, error boundary, the global focus ring, coarse-pointer hit areas, the static themes' `--ink-faint`) are credited above; the ones still visibly open are re-reported here with fresh evidence, chiefly the sky theme's missing contrast floor.
