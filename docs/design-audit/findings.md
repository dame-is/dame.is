# dame.is — design audit: every finding

*The appendix to [README.md](README.md). Findings are grouped by the report's ten themes. Each was re-checked by an independent verifier; "adjusted" means the verifier corrected its detail or severity, and the corrected text is what appears here.*


Each primary entry is followed by the findings merged into it. Severity, verdict and the verifier's corrections are carried over unchanged. Where a verifier corrected a number or a claim, the correction is in the verification note, and it takes precedence over the original evidence line.

Totals: 130 findings (12 high, 59 medium, 59 low), 80 distinct issues after merging.

### Theme 1 — The sky needs a floor

#### INT-02 · First load flashes three palettes and swaps the feed twice, with no home skeleton

`high` · `visual` · effort M · verdict *confirmed* · lens: Interaction, motion, feedback & states · **merges:** IDN-13

**Pages:** / (first visit), every route on cold load

**Observation.** Timeline on a fresh desktop load: white (150 ms) → retired parchment theme (400–800 ms, CSS loaded before JS) → built-in 1 pm sky #cbf0f6 with dash placeholders and a lone faint 'Fetching latest activity…' line (1.5 s) → tuned sky #f0fcfe with the snapshot feed (3 s) → live feed replaces the snapshot rows in place (~6 s). The hero also swaps from fallback phrases to PDS phrases. None of the palette swaps is animated. On mobile /mothing the skeleton is label/bar/time rows, while the real rows have a 40 px thumbnail, a name and an italic Latin name, and the stats and 'most seen' blocks pop in above the list. Measured CLS stays low (0.03), so the problem is perceived instability, not layout shift.

**Recommendation.** (1) Add a ~1 KB inline &lt;head> script with a 24-entry hour → {page, ink, surface} table that sets data-theme='sky' and the core --sky-* variables before the first paint, and change the :root fallbacks away from parchment. (2) Bake is.dame.sky/self into the bundle at build time, as is already done for is.dame.nav (vite.config.js:34), so tuning is present at first paint. (3) Add html{transition: background-color .6s, color .6s} for the hourly tick and the sky picker. (4) Give home a ledger-shaped skeleton (verb bar | two-line body | time bar ×6) under the hero. (5) Merge live items into the snapshot by key instead of swapping, and if new items land above the fold, show a quiet '2 new ↑' running-head note rather than prepending.

**Evidence.**
- extra/interaction/load-home-desktop-800ms.png (full-screen parchment rgb(241,234,212))
- extra/interaction/load-home-desktop-1500ms.png (rgb(203,240,246), chrome shows '—' placeholders, feed area only says 'Fetching latest activity…')
- extra/interaction/load-home-desktop-3000ms.png (rgb(240,252,254), snapshot feed)
- extra/interaction/load-home-desktop-6000ms.png (live feed replaces the snapshot: top row changes to 'moats don't work…', meta still 'Fetching latest activity…')
- home__desktop__h13__early.png vs home__desktop__h13__s0.png (bg 203,240,246 → 240,252,254; '22 items, 286 interactions' → '23 items, 289')
- mothing__mobile__h13__early.png (intro copy and skeleton shape differ from the settled page)
- src/styles/theme.css:4-8 (:root --page #f1ead4, the retired parchment theme)
- src/main.jsx:32-36 (data-theme=sky set only once the module runs)
- src/hooks/useTheme.jsx:128-157 (is.dame.sky/self tuning fetched at runtime, then repaints)
- src/pages/Home.jsx:703-707 (no skeleton, a single status line)
- src/pages/Mothing.jsx:210-214 (ledger mode uses the generic FeedSkeleton, not a moth-row shape)

#### IDN-13 · The palette and avatar jump on first load because the sky tuning arrives after first paint  
*Merged into INT-02.*

`low` · `functional` · effort S · verdict *confirmed* · lens: Visual identity & aesthetic

**Pages:** all pages (first visit)

**Observation.** The pre-paint script applies the built-in hourly palette. The owner's tuning record (which overrides the page colour at 16 of 24 hours, plus surfaceSep, warmth and glow) only arrives after a fetch. At 1pm the first paint is a mid-cyan page that then snaps to near-white, and the header wordmark shifts right when the avatar mark loads.

**Recommendation** (carried forward in INT-02). Inline the sky.json tuning (it is already snapshotted at build time) into index.html, or import it synchronously into main.jsx, and call setSkyTuning() before the pre-paint applySkyTheme so the first frame uses the final palette. Reserve the mark's box from the first frame (see IDN-07).

**Evidence.**
- home__desktop__h13__early.png: page #cbf0f6 (untuned 1pm derivation), no avatar mark, 'dame.is' at x=230
- home__desktop__h13__s0.png: page #f0fcfe (tuned), mark present, 'dame.is' at x=264
- src/main.jsx:37: pre-paint applySkyTheme(easternHour()) runs with no tuning installed
- src/hooks/useTheme.jsx:128-150: is.dame.sky is installed asynchronously (fetchSnapshot('sky') and then the live PDS record)

**Prior review:** RECOMMENDATIONS §3.3 — still open (it notes the pre-override first paint)

#### MOB-01 · The sky palette's --ink-faint fails AA at 22 of 24 hours, and it colours the smallest text on mobile

`high` · `accessibility` · effort M · verdict *confirmed* · lens: Mobile experience & accessible design (MOB) · **merges:** IDN-02, FEED-04, TYP-01

**Pages:** /, /posting, /logging, /listening, /creating, /curating, /mothing, /blogging

**Observation.** The static light theme's --ink-faint was retuned to about 4.65:1 (theme.css comment), but the site only ships the sky theme, and that maps --ink-faint to a per-hour value with no floor. Across the day the faint ink sits between 2.5:1 and 4.2:1 on the page. This ink colours the ledger's gerund and time labels, day-stat lines, link-card hosts and the hero's 'dame is' lead. On phones the ledger labels also shrink to 9.6px Crimson Pro, which has a low x-height. At 6am, 7pm and 8pm even the 36px hero lead fails the 3:1 large-text minimum.

**Recommendation.** Add a post-derivation contrast pass in buildBaseVars / paletteForHour. For each text token (inkFaint, inkMuted, accent, and the raised variants against surface-raised and surface-deep), step HSL lightness away from the page in 0.005 increments, keeping hue and saturation, until the token clears 4.5:1. Floored values stay recognisably 'of the hour': 06h #796d71→#a59b9e, 13h #3c8b90→#367d82, 19h #9c77a2→#bfa7c3, 20h #6c5b8b→#9687b1, 21h #716a7c→#877f92. Once lightness alone can no longer separate muted from faint, separate them with small caps, letter-spacing or italic rather than lightness. Separately, stop shrinking ledger labels below 12px on mobile (see MOB-02). Add a unit test that asserts every hour's text tokens are ≥4.5:1, so future tuning records can't regress this.

**Evidence.**
- shots/extra/mobile/ledger-labels-by-hour.png: the same 'Today / posting / 3:17 pm' strip at 13h, 06h, 19h, 21h and 00h. The labels are barely visible at 06h, 19h and 21h.
- shots/home__mobile__h06__s0.png, home__mobile__h19__s0.png: the hero lead 'dame is', '23 items, 289 interactions', the 'posting' verbs, times and the 'dame.is' link-card host all fade into the page.
- Computed from src/lib/skyTheme.js plus the live is.dame.sky tuning; tokens match metrics/home__mobile__h13.json. --ink-faint on --page is 3.79:1 at 13h, 2.49 at 06h, 2.63 at 19h, 2.50 at 20h and 3.37 at 21h. It clears 4.5:1 only at 07h (5.50) and 09h (4.97).
- Other tokens also fail on --page: --ink-muted 3.98:1 at 19h; --accent (links, hero clause) 4.05 at 19h, 4.21–4.29 at 11, 12, 15 and 16h; the Resume and compass fill label 3.31 at 19h.
- src/lib/skyTheme.js:235 and :289: inkFaint is derived as page lightness ±0.18 / +0.13, with no contrast check in buildBaseVars.
- src/styles/reset.css:66-71: the codebase's own comment says --ink-faint 'collapses to 2.05:1 on the 06:00 page and 2.17:1 at 19:00 — a hint nobody can read at dawn or dusk'.
- src/components/Feed.css:2420-2423: ledger verb, time and day-meta drop to calc(--text-xs × 0.8) = 9.6px at ≤600px, all in --ink-faint.
- metrics/home__mobile__h13.json: contrastFailCount 31, e.g. '3.79:1 @9.6px "posting" (ledger-verb)'.

**Prior review:** RECOMMENDATIONS §3.1 / §3.3 — still open (fixed only in the unused static light/dark themes; the shipping sky theme still has no contrast floor)

#### IDN-02 · The secondary-ink role changes character every hour: it fails at dawn and dusk and becomes the accent colour at 7am  
*Merged into MOB-01.*

`high` · `accessibility` · effort M · verdict *confirmed* · lens: Visual identity & aesthetic

**Pages:** /, all pages (ledger verbs, timestamps, section meta, hero lead, chrome labels)

**Observation.** The hero's three-tone grammar (muted lead → ink role → accent clause) and the ledger's quiet verb and time columns all depend on --ink-faint being a stable, legible 'pencil' tone. With the live tuning applied, it clears AA against the page in only 2 of 24 hours. At 6am, 7pm and 8pm it falls below 3:1, which fails even for the 48px hero lead. Its hue also wanders: grey at 8am, teal at 1pm, dusty mauve at 7pm. At 7am it lands almost exactly on the accent, so the sentence loses its structure. The 7pm primary button label is 3.3:1. The theme.css comment claims '~4.80:1' for the midnight faint, but the live value is 4.02:1.

**Recommendation** (carried forward in MOB-01). Add a post-override solving pass that keeps the owner's inkWarmth/inkContrast hue choices but moves OKLab L until faint is ≥4.5:1 on --page and on --surface-raised, muted ≥6:1, and accent ≥4.5:1. Darken or lighten the accent fill, not the label, until the fill label is ≥4.5:1. Also enforce a minimum ΔE (~15) between faint and accent so the hero lead can never collapse into the clause. Add a node test over h0–23 using skyTheme.js, skyTuning.js and the sky.json snapshot (skycontrast.mjs is a working template), and show the per-hour ratio row in the Sky studio so the owner sees a failure while tuning.

**Evidence.**
- Computed with src/lib/skyTheme.js + skyTuning.js + the live sky.json snapshot for h0–23 (a WCAG script run over all 24 hours): --ink-faint vs --page is ≥4.5:1 only at 7am (5.50) and 9am (4.97); 6am 2.49, 8pm 2.50, 7pm 2.63, 9pm 3.37, 1pm 3.79, midnight 4.02
- home__desktop__h06__s0.png, home__desktop__h19__s0.png: 48px hero lead 'dame is' at 2.49:1 and 2.63:1 (below even the 3:1 large-text bar); ledger 'posting', '3:17 pm' and '23 items, 289 interactions' nearly vanish
- extra/identity/home-h07.png: faint #183295 ≈ accent #153184, so 'dame is' and the clause are the same blue
- extra/identity/home-h08.png: faint is a neutral grey #6b7080 on a periwinkle page
- Pixel-measured 'Resume' button at 7pm: label #41348d on fill #c37eb9 = 3.33:1 (home__desktop__h19__s0.png)
- src/lib/skyTheme.js:235, :289 (inkFaint lightness offsets, no contrast floor); :344-366 applyOverride/warmContrast pulls faint toward the horizon pop
- src/styles/app.css:154-156 (.hero-sentence-lead = --ink-faint), :174-176 (clause = --accent), :249-259 (primary button)
- src/components/Feed.css:1854-1858 (ledger verb = --ink-faint)

**Prior review:** RECOMMENDATIONS §3.3 — still open (and §3.4: accent-fill label still 3.3:1 at 7pm)

#### FEED-04 · The labels that structure the ledger (verb, time, day stats) are the smallest and lowest-contrast text on the page  
*Merged into MOB-01.*

`high` · `accessibility` · effort M · verdict *confirmed* · lens: Home feed / activity ledger UX

**Pages:** /, /posting, /logging

**Observation.** The verb and time columns, plus the day stats, are what make the ledger a ledger. They are all set in --ink-faint at 9.6–13.2px. In the sky palette that colour sits between 2.49:1 and 4.23:1 against the page for 22 of 24 hours. At dawn (h06) and dusk (h19–20) the labels nearly disappear (home__desktop__h06__s1.png). On mobile the rule `calc(var(--text-xs) * 0.8)` also drops the 1.1 --mono-scale, so Crimson Pro, which has a small x-height, renders at 9.6px.

**Recommendation** (carried forward in MOB-01). Use --ink-muted for the verb and time text (6.19:1 at h13 and 3.98:1 at h19, still to be tuned), and keep --ink-faint for rules only. Alternatively, add a floor to skyTheme.js so --sky-ink-faint reaches at least 4.5:1 against --sky-page every hour. Keep labels at least 12px on mobile: drop the 0.8× step once FEED-01 stacks the labels and frees the width. Small caps with 0.06em tracking can carry the 'marginal note' look instead of pale colour.

**Evidence.**
- home__desktop__h06__s1.png and home__desktop__h19__s1.png (verbs/times nearly invisible)
- home__mobile__h19__s0.png
- Live computed sizes: desktop verb 13.2px, time 11.22px, day-meta 11.22px; mobile verb/time/day-meta 9.6px
- skycontrast.mjs over is.dame.sky tuning: --sky-ink-faint on --sky-page = 2.49 (h06), 2.63 (h19), 2.50 (h20), 3.79 (h13); ≥4.5:1 only at h07 and h09 (22 of 24 hours fail)
- metrics/home__desktop__h06.json contrastFailExamples: '2.49:1 @13.2px "posting" (ledger-verb)', '2.49:1 @11.22px "3:17 PM" (ledger-time)'
- src/components/Feed.css:1854-1881 (both use --ink-faint), 1814-1820, 2419-2423 (mobile 0.8× drops --mono-scale)

**Prior review:** RECOMMENDATIONS §3.1 — still open in the sky palette (light/dark were re-tuned; sky --ink-faint still 2.49–4.23:1 for 22/24 hours)

#### TYP-01 · Metadata type falls to 9.28–11.4px (9.6px on mobile ledgers) and is set in --ink-faint, which drops to 2.5:1 at some hours  
*Merged into MOB-01.*

`high` · `accessibility` · effort M · verdict *adjusted* · lens: Typography & reading experience

**Pages:** /, /posting, /logging, /listening, /mothing, /blogging, /creating, /curating, /creating/ratioed, /creating/ratioed/participants

**Observation.** The visible sub-12px metadata is: on mobile, the ledger verb, time and day-stats at 9.6px (home, posting, logging, listening, creating and curating ToCs); on desktop, ledger time and day-header meta at 11.22px (the desktop verb is 13.2px); ratioed ISO dates and table heads at 9.28–10.6px; and the chrome signal labels at 11.4px. All are in --ink-faint, which measures 3.79:1 at h13 and 2.49–2.63:1 at h06 and h19. The '11.4px ×616' and '26 distinct sizes' figures are inflated by hidden x-ray spans and should not be quoted as visible type.

**Recommendation** (carried forward in MOB-01). Set a hard floor: nothing renders below 12px (0.75rem). Replace the ad-hoc multipliers (×0.8, ×0.85, 0.58–0.68rem) with one metadata token, e.g. --text-meta: 0.8125rem (13px), lining tabular figures, colour --ink-muted. On mobile, keep the size and change the layout instead: drop the 5rem/3.5rem side columns and make verb and time a running-head line above the entry. Add the post-derivation contrast floor so --ink-faint is never below 4.5:1 for text in skyTheme.js, or reserve --ink-faint for rules and decoration only.

**Evidence.**
- home__mobile__h13__s0.png ('posting', '3:17 pm', '23 items, 286 interactions' at 9.6px)
- home__mobile__h06__s0.png (same labels nearly invisible on navy)
- home__desktop__h19__s0.png
- logging__mobile__h13__s1.png
- ratioed__mobile__h13__s0.png
- metrics: mobile font-size histogram has 9.6px ×239, 9.28px, 9.92px, 10.08px, 10.37px; desktop has 11.22px ×231 and 11.4px ×616; 26 distinct sizes overall vs 8 tokens
- Feed.css:2418-2424 mobile override font-size: calc(var(--text-xs) * 0.8) = 9.6px for .ledger-verb/.ledger-time/.day-header-meta (also drops --mono-scale)
- Feed.css:1814-1817 and 1872-1875: 0.75rem × 0.85 × 1.1 = 11.22px
- RatioedBlock.css:183,443 and RatioedParticipants.css:77: 0.58rem = 9.28px uppercase table heads
- --ink-faint on --page by hour (metrics tokens): h06 2.49:1, h19 2.63:1, h21 3.37:1, h13 3.79:1, h00 4.02:1; the 48px hero lead 'dame is' is also 2.49:1 at h06
- Measured Crimson Pro x-height is 0.42em (Georgia 0.46), so 9.6px Crimson has about a 4px x-height

**Prior review:** RECOMMENDATIONS §3.3 — still open (sky-hour --ink-faint below AA); §9 'Low' sub-xs font sizes — still open

**Verification note (adjusted).** The core claim holds. Feed.css:2418-2424 sets .ledger-verb, .ledger-time and .day-header-meta to calc(0.75rem*0.8) = 9.6px on mobile. Feed.css:1814-1817 and 1872-1875 put ledger-time and day meta at 11.22px on desktop. RatioedBlock.css:183,443 uses 0.58rem (9.28px), with 0.62 and 0.68rem elsewhere. All of these are coloured --ink-faint (rgb 60,139,144 on home mobile). Recomputing from the metrics tokens gives faint-on-page contrast of h06 2.49, h19 2.63, h21 3.37, h13 3.79 and h00 4.02, which matches the audit. In home__desktop__h19__s0.png and home__mobile__h06__s0.png, '23 items, 289 interactions', 'posting' and '3:17 pm' are close to invisible. Some of the cited evidence is inflated, though. The '11.4px ×616' desktop count and much of the 26-size spread come from hidden x-ray spans (span.did/.nsid/.rkey/.ledger-xray-cid, which a probe showed are all display-hidden Plex Mono). The visible 11.4px items are only the roughly 7 chrome signal labels per page. On desktop, .ledger-verb renders at 13.2px (×1.1 mono-scale in serif mode), not below the floor. High severity is still warranted: this is the home feed's metadata, it fails AA on every capture, and at dawn and dusk it is effectively unreadable.

#### IDN-01 · In daylight the sky paints the chrome and every in-page surface vivid cyan, so the 'book page' reads as an app screen

`medium` · `visual` · effort M · verdict *adjusted* · lens: Visual identity & aesthetic · **merges:** SYS-04

**Pages:** /, /blogging/*, /curating/*, /mothing/*, /creating, all detail pages

**Observation.** At 1pm the hour-13 tuning (surfaceSep 200) separates the chrome from the near-white page. The primary chrome strip and bottom bar are #a3edf9; the vitals and listening rows are a lighter #d3f6fc. Because skyTheme.js:241 (and :295 at night) also multiplies --sky-page-edge by surfaceSep, every in-page object filled with --page-edge picks up chrome-strength cyan. That includes the curating mats (#b7f1fa), moth caption slabs and cards-layout captions. Photographs and captions then sit in the same saturated colour as the UI furniture. The saturated dusk pages (6pm #909fea, 7pm #41358d) are a deliberate part of the sky arc and are not a defect.

**Recommendation.** Keep the page and chrome colours the owner tunes per hour. Decouple in-page surfaces from surfaceSep: stop multiplying --sky-page-edge by sep (skyTheme.js:241, :295), or add a separate in-page token. Derive mats, caption slabs and tiles from the existing --nest-step ink-into-page mix, so they always sit one quiet step off the page while surfaceSep keeps acting only on chrome. If the owner wants softer daytime chrome, add a 'chromeChroma' knob to the is.dame.sky tuning record next to surfaceSep rather than hard-capping it. Optionally add a thin SKY_BANDS[h] top→bottom gradient 'horizon' hairline on the bars. Do not blend a warm paper neutral into the sky page; that undoes the single sky palette.

**Evidence.**
- home__desktop__h13__s0.png: page #f0fcfe (OKLab chroma ≈0.013) vs top and bottom bars #a3edf9 (chroma ≈0.075, about 6× the page)
- blogpost__desktop__h13__s0.png: chrome covers 224 of 900px (top 166 + bottom 58) on detail pages
- curating-channel__desktop__h13__s0.png: every image letterboxed in a #b7f1fa cyan mat
- mothing-night__desktop__h13__s0.png and extra/identity/creating-cards-h13.png: cyan caption slabs
- extra/identity/home-h18.png, extra/identity/blogpost-h18.png: at 6pm the reading page itself is #909fea (chroma ≈0.11); 7pm #41358d (chroma ≈0.14)
- live is.dame.sky record (shots/../dl/sky.json): hour 13 has page #f0fcfe, surfaceSep 200
- src/lib/skyTheme.js:241-242 and :295-296: surfaceSep scales --sky-page-edge as well as --sky-surface-raised
- src/pages/Curating.css:27, src/pages/Mothing.css:116: mats and captions use var(--page-edge)
- extra/identity/admindoc-0.png: the reference doc's warm paper #ddd3b2 with accent used sparingly

**Verification note (adjusted).** The measurements hold. I sampled home h13: page #f0fcfe (OKLab C 0.013), primary top strip and bottom bar #a3edf9 (C 0.075), curating mat #b7f1fa. Chrome takes 188px of 900 on home and 224px on detail pages. skyTheme.js:241/:295 does scale --sky-page-edge by surfaceSep, and sky.json sets hour 13 to surfaceSep 200. Curating.css:27 and Mothing.css:116 paint tiles with --page-edge (42 uses repo-wide). Two parts are overstated. (1) The chrome's saturation is the owner's explicit per-hour tuning, not an accident. Only the knock-on effect on in-page surfaces (mats, caption slabs) is clearly unintended. (2) The 6-7pm 'coloured glass' complaint is taste, and it contradicts the audit's own strength #3, which praises the 7pm indigo page. 'Reads as an app screen' is subjective. The page is coherent and legible, so high overstates the impact. The recommendation also works against the identity. It mixes 55% warm paper into the day page, caps dusk page chroma, and cites the admin doc's 'paper-and-moss' palette as the target. That is the retired static theme the owner deliberately replaced with the single always-on sky theme (main.jsx:28-30).

#### SYS-04 · Cards sit on three surface levels, and at night tiles sink while embeds rise  
*Merged into IDN-01.*

`low` · `visual` · effort S · verdict *adjusted* · lens: Component system & visual consistency

**Pages:** /, /posting, /mothing/:night, /curating/:channel, /exploring, /creating/:work, /available

**Observation.** By day, moth tiles, curating tiles and Exploring lexicon cards are painted --page-edge (#b7f1fa at 1pm), a saturated cyan close to the chrome bars. Post, quote and link embeds use the quieter oklab nest mix (#e5f1f3), and the Leaflet link card and résumé work rows use the page colour. At midnight the two families do step in opposite directions (#131313 vs #1f2020 on #181919), but the deltas are about 1.05–1.08:1 and barely visible. This is cross-page inconsistency, and its main visible cost is that the Exploring cards read like chrome by day.

**Recommendation** (carried forward in IDN-01). Unify card fills on the nest mix without declaring it as :root tokens. Add one shared class, e.g. .surface { background: var(--page-edge); background: color-mix(in oklab, var(--ink) calc((var(--nest, 0) + 1) * var(--nest-step)), var(--page)); border: 1px solid var(--rule-soft); }, so the mix resolves at the element against whatever --page/--ink are in scope, exactly as PostEmbed does. Apply it to lexicon cards, curating tiles and moth caption strips, and keep --page-edge for chrome. If --surface-soft/-2/-3 must exist for the blocks.css references, declare them on the consuming selectors (or on *), not on :root, so the sky studio's subtree re-theming still works.

**Evidence.**
- extra/sys/card-surfaces.png
- Pixel samples at 1pm: page #f0fcfe · quote / link embed #e5f1f3 · moth tile caption & lexicon card #b7f1fa · Aturi link card #f0fcfe (no fill)
- Pixel samples at midnight: page #181919 · quote embed #1f2020 (lighter) · moth tile caption #131313 (darker)
- home__desktop__h13__s1.png, home__desktop__h00__s1.png, mothing-night__desktop__h13__s0.png, mothing-night__desktop__h00__s0.png, exploring__desktop__h13__s1.png, curating-channel__desktop__h13__s0.png, creating-work-software__desktop__h13__s0.png
- src/components/PostEmbed.css:162-168, 251-258 (oklab nest mix)
- src/pages/Mothing.css:116, src/pages/Curating.css:27, src/components/ExploringHome.css:111 (--page-edge)
- src/components/LeafletDocument.css:137-150, src/pages/Resume.css:220-229 (page fill / none)
- src/styles/theme.css:209-232 (the nest scale's own comment: everything 'painted --page-edge … read as one flat card')

**Prior review:** related to RECOMMENDATIONS §9.3 (phantom --surface-* tokens) — still open

**Verification note (adjusted).** The daytime observation is accurate. Lexicon cards (exploring__desktop__h13__s1), curating tiles (curating-channel__desktop__h13__s0) and moth captions all use --page-edge, a saturated cyan close to the chrome bars, while embeds use the grey-cyan nest mix (PostEmbed.css:162-168, 251-258). The midnight 'opposite depth' claim is technically true but barely perceptible: tile caption to page is 1.055:1 and embed to page 1.079:1. Each page is also internally consistent, so visitors meet the difference across pages, not side by side. More importantly, the recommendation conflicts with a documented constraint. theme.css:227-230 says the nest scale is deliberately a step rather than named levels, because the mix must re-resolve against whatever --page/--ink are in scope (the sky studio re-themes subtrees). A --surface-1 declared on :root would bake in :root's --page and inherit that fixed value into re-themed subtrees.

#### GAP-06 · The sky ignores the reader: OS dark mode is ignored and a chosen hour is lost on reload

`low` · `accessibility` · effort S · verdict *adjusted* · lens: Gap pass (cross-lens)

**Pages:** all pages

**Observation.** The palette always follows Dame's Eastern hour. A different hour picked in the sky sheet lasts for the session but is lost on reload or the next visit. prefers-color-scheme is never consulted, so readers abroad at night, or with OS dark mode, start every visit on Dame's current, possibly bright, palette.

**Recommendation.** Keep Dame's live sky as the default for everyone. Persist the reader's hour choice per viewer (localStorage in try/catch) and mark the chip when it is not live. Add a second mode at the top of the sky sheet: "Dame's sky · 1 PM ET" | 'Your sky · 2 AM', which runs the same 24 palettes on the reader's local hour. Use prefers-color-scheme: dark only to suggest 'Your sky' (a dot on the chip or a one-line hint), never to swap the palette silently.

**Evidence.**
- extra/gaps/pref-dark-os-tokyo-2am__mobile.png: OS dark mode on, a reader in Tokyo at 2 am local; the blog post renders in the pale 1 pm daylight palette (body rgb(240,252,254)); matchMedia('(prefers-color-scheme: dark)') = true
- gap/pref.cjs: picking '12am' in the sky sheet sets the body to rgb(24,25,25), and after reload it is back to rgb(240,252,254)
- src/hooks/useTheme.jsx:74 skyOverride = useState(null) (not persisted); src/main.jsx:37 pre-paints applySkyTheme(easternHour()); grep finds no prefers-color-scheme or prefers-contrast in src/
- extra/gaps/pref-forced-colors__mobile.png shows forced-colors works well

**Verification note (adjusted).** Verified in code. The single always-on 'Dame's sky' is a deliberate identity decision and following OS dark mode is not a WCAG requirement, so low. Automatically switching to a night palette for dark-mode users would break the promise that the page shows Dame's current hour; an opt-in 'Your sky' mode is the on-brand form.

#### GAP-10 · After dark, white screenshots become the brightest thing on the page

`low` · `visual` · effort S · verdict *confirmed* · lens: Gap pass (cross-lens)

**Pages:** /, /posting, /blogging/:slug, /creating/:slug, /curating/:channel

**Observation.** The night palettes are carefully tuned, but content images render at full daylight brightness. Photographs sit well on the dark page; UI screenshots and white link thumbnails don't — they are the brightest things on screen at 12 am.

**Recommendation.** When the sky palette is dark (skyTheme already emits color-scheme), dim embedded and feed images slightly, e.g. img.feed-media, .post-embed img { filter: brightness(.85) contrast(1.05) }, and restore full brightness on hover, focus and in the lightbox. Optionally flag predominantly-white images at snapshot time and dim them further (~.75). Keep a --rule hairline frame on images so white edges don't dissolve into light day palettes.

**Evidence.**
- home__mobile__h00__s0.png: at midnight (page ≈ #181919) the first ledger row is a pure-white dril-tweet screenshot about 205×130 CSS px, directly under the hero
- home__desktop__h00__s1.png: a white 'oliver★' screenshot and link-card thumbnails glow against the night page
- grep 'brightness(' over src/**/*.css: only SkyHourSheet/SkyThemeStudio swatches, plus grayscale in Xray.css and RatioedLive.css; no night treatment for content images
- Counter-example: mothing-night__desktop__h00__s0.png and extra/identity/curating-channel-h00.png, where photographs look good at night

#### IDN-07 · The chrome avatar mark shrinks the lettered sky-avatar to an illegible 21px smudge that repeats the wordmark in sans-serif

`low` · `visual` · effort S · verdict *adjusted* · lens: Visual identity & aesthetic

**Pages:** all pages (top chrome)

**Observation.** The chrome mark is Dame's live hourly Bluesky avatar at ~21px. Its sans 'dame' lettering is tiny and repeats the serif wordmark beside it. Its visibility depends on the asynchronously loaded is.dame.sky record, so it appears after first paint and shifts the 'dame.is' wordmark ~34px to the right.

**Recommendation.** Keep the live avatar, but reserve its 1.3em box from the first frame and fill it with a CSS SKY_BANDS[h] top→bottom gradient as the placeholder, swapping in the avatar once decoded. The wordmark then never moves, and the first frame already says 'this hour's sky'. If the owner prefers the gradient permanently, offer it as a mark style in the is.dame.sky record rather than replacing the avatar outright. Show the full lettered avatar at size in the sky-hour sheet.

**Evidence.**
- extra/identity/desktop-avatar-zoom.png: 8× zoom of the mark at h00/h06/h13/h19/h21
- extra/identity/mobile-topbar-hours.png
- extra/identity/sky-avatars-source.png: the source art (grainy gradient + chrome-embossed sans 'dame')
- home__desktop__h13__early.png vs home__desktop__h13__s0.png: the mark pops in late and pushes 'dame.is' about 34px right
- src/components/ChromeBar.css:366-374 (.chrome-mark-img 1.3em square, 1px --rule border, background var(--surface-soft) — an undefined token)
- src/components/ChromeBar.jsx:317-327

**Verification note (adjusted).** The mark is ~21px at 1x with 'dame' in sans lettering, and it does duplicate the wordmark (extra/identity/desktop-avatar-zoom.png). 'Illegible smudge' is overstated, since the letters are faintly readable even in the zoom. The layout shift is real. home__desktop__h13__early.png shows no mark and 'dame.is' at x=230, then x=264 once loaded. The mark is gated on the sky record (useTheme.jsx setMarkVisible(skyMarkVisible(record))) and the span renders only when showAvatar is true (ChromeBar.jsx:316). --surface-soft is undefined but falls back to transparent harmlessly. The mark is a deliberate, owner-toggleable link to the live Bluesky avatar. Swapping it for a synthetic CSS gradient removes that AT-Protocol-native signal, which the finding itself calls the mark's value. This is polish plus a small layout-shift bug, so low.

#### INT-06 · Sky-hour picker: frozen and live look identical, and the swatches are unlabeled and tiny on phones

`low` · `ux` · effort M · verdict *adjusted* · lens: Interaction, motion, feedback & states · **merges:** MOB-07

**Pages:** all (bottom bar hour chip)

**Observation.** When the sky is frozen on another hour, the sheet's 'Live' control looks the same as the live-state label. The closed bar shows only the chosen hour ('7PM') with no frozen marker. The 24-cell ribbon has no hour labels or real-time caret, and its cells are ~10×20 px on phones, although ←/→ step buttons give a larger alternative. The override resets on reload.

**Recommendation.** Header: 'TIME OF DAY · live, 1 pm ET' with a small accent dot when live. When frozen: 'Frozen at 7 pm' plus a visible outlined 'Return to live ↺' button. Chip: show a frozen state (dotted border or a small ✳ after '7PM'). Under the ribbon, set tick labels in small caps (12a · 6a · noon · 6p) and a caret under the real current hour. On phones, render 2 rows × 12 cells at 28 px tall, or a horizontally scrollable ribbon with 28 px cells, and give the cells hit areas extended by ::before like .chrome-nav.

**Evidence.**
- extra/interaction/skyhour-override-7pm-sheet-desktop.png (after picking 7 pm the header still reads a faint 'LIVE', same style as when live)
- extra/interaction/skyhour-override-7pm-closed-desktop.png (sheet closed: the only cue is '7PM' on the chip)
- state-skyhour-open__mobile__h13.png
- Measured: mobile swatches 10.3 × 20 px with 2 px gaps (SkyHourSheet.css:83, 87-115)
- src/components/SkyHourSheet.jsx:36-48 (Live label vs Live button share one style, SkyHourSheet.css:28-45)

**Verification note (adjusted).** Accurate details: 'Live' as a button and 'Live' as a label share one faint mono style (SkyHourSheet.jsx:36-48, .css:28-45). After closing, the only cue is the chip text '7PM' (the pink ring in the closed screenshot is the focus outline). The cells have no hour labels or now-marker. Mobile cells are about 10×20 px (height 20 px at ≤560 px). The stakes are lower than stated, though. The override is plain React state (useTheme.jsx:74), not persisted, so it lasts only until reload and only for the visitor who chose it. The chip always shows the chosen hour. Larger prev/next step buttons already sit beside the ribbon as a touch alternative. This is polish, not medium friction.

#### MOB-07 · Sky-hour sheet: 24 unlabeled 10×20px swatches, and the midday swatches vanish into the sheet  
*Merged into INT-06.*

`medium` · `accessibility` · effort M · verdict *adjusted* · lens: Mobile experience & accessible design (MOB)

**Pages:** all pages (1PM chip → Time of day sheet)

**Observation.** The time-of-day arc is 24 ~10×20px cells with 2px gaps and 24×20px steppers. Cells carry accessible names (role=tab, aria-label '1pm' etc.) but no visible hour ticks, so sighted visitors can't tell which sliver is which hour, and the pale 11am–2pm cells have no edge against --surface-deep.

**Recommendation** (carried forward in INT-06). On coarse pointers, turn the arc into a scrubber: one 44px-tall ribbon you press and drag across, with the palette live-previewing under your finger and a floating label ('6 AM') riding above the touch point. Put tick labels under the ribbon (12a · 6a · 12p · 6p) in small caps. Outline each swatch with a 1px --rule hairline so pale hours keep their edges. Make the steppers 44×44. Expose it as role='slider' with aria-valuetext='6 AM, dawn'.

**Evidence.**
- shots/state-skyhour-open__mobile__h13.png, shots/extra/mobile/skyhour-sheet-crop.png.
- Measured at 390px: each .sky-hour-sheet-cell is 10×20px with 2px gaps, and the ‹ › steppers are 24×20px (SkyHourSheet.css:61-66 width 1.5rem; :87-95; :111-114 height 20px ≤560px). There is no coarse-pointer enlargement.
- The 11am–2pm swatches (≈#e9f8fb–#f0fcfe) sit on --surface-deep #d3f6fc with no outline. In the crop the 2pm cell is almost invisible.
- There are no hour labels or ticks: only the selected cell's hollow outline tells you where 'now' is.

**Verification note (adjusted).** The sizes are verified: SkyHourSheet.css gives cells height 20px at &lt;=560px with 24 columns and 2px gaps (~10px wide at 390px), steppers 1.5rem wide, and no coarse-pointer enlargement. skyhour-sheet-crop.png shows the 2pm cell nearly invisible against the sheet. 'Unlabeled' is only true visually: each cell is role=tab with aria-label={skyHourKey(h)} (e.g. '1pm') inside a role=tablist 'Hour', so screen-reader users do get hour names. The steppers are also undersized (20px tall), so the 2.5.8 'equivalent control' exception doesn't rescue it.

### Theme 2 — The ledger, re-set for a phone and as a set of links

#### MOB-02 · At 390px the home ledger gives content 206px of 358, shrinks labels to 9.6px, and collapses entirely under larger text

`high` · `ux` · effort M · verdict *confirmed* · lens: Mobile experience & accessible design (MOB) · **merges:** LAY-01, FEED-01, TYP-11

**Pages:** /, /posting, /logging, /listening, /mothing, /creating, /blogging, /curating

**Observation.** The ledger's three-column 'verb | content | time' grid is a strong desktop idea that the mobile breakpoint only narrows. The two label columns and gaps still take 152px of a 358px column, which leaves 206px for the content: post text, quoted posts and images. Images therefore render at about 57% of the available width, quote cards wrap after 3–4 words, and the labels are cut to 9.6px to fit. Because the columns are in rem, any user who enlarges text makes the label columns grow while the content column shrinks, until it reaches 22px.

**Recommendation.** Below roughly 36rem, or better with a container query when the body column would be under about 18rem (so text zoom also triggers it), restack each ledger row. The first line is a caption: verb on the left and time on the right, at 12px small caps letter-spaced 0.12em in floor-contrast ink. The record then follows at the full column width. Keep the hairline row rules, the dashed thread-continuation rule and the day header ('Today ······ 23 items'). Drop the verb on continuations, as now. Keep the three-column grid at 600px and above. Apply the same restack to the flat ledgers (/creating, /blogging), where the kind label becomes the caption.

**Evidence.**
- Measured at 390×844: .ledger-verb 80px | .ledger-body 206px | .ledger-time 56px, with two 8px gaps (Feed.css:2414-2418: --ledger-verb-col 5rem, --ledger-time-col 3.5rem). At 320px the body is about 136px (shots/extra/mobile/bottombar-posting-320.png: one-to-three words per line).
- shots/home__mobile__h13__s0.png and __s1.png: embedded posts, link cards and the dog photo are 206px wide, centred between two mostly empty label gutters. posting__mobile__h13__s1.png shows the same.
- shots/state-cards-layout__mobile__h13.png: the same post in cards layout uses the full 358px. shots/extra/feed/proto-mobile-restack-s0.png (feed lens) shows a full-width restack working.
- Text-size test (root font 125/150/200%, as with a browser default-font-size setting): body column 160px at 125%, 114px at 150% (shots/extra/mobile/textzoom-150-posting.png: one or two words per line), 22px at 200% (textzoom-200-posting.png: one letter per line).
- Feed.css:1827-1830: the grid is fixed rem columns, with no container query or stacking fallback.

#### LAY-01 · Mobile ledger squeezes every post into a 206px column  
*Merged into MOB-02.*

`high` · `ux` · effort S · verdict *adjusted* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** /, /posting, /logging, /listening

**Observation.** Under 600px the ledger keeps three columns (80px verb, 206px content, 56px time, 8px gaps), so record content gets 206px of the 358px column. Plain-text posts wrap at 5–7 words per line. Quote boxes inside reposts drop to about 170px and wrap at 3–5 words. 'posting' fills about 30px of its 80px column. On /logging every row repeats 'dame.is'. On /posting the verb column tells 'posting' from 'replying', so it is not redundant there.

**Recommendation** (carried forward in MOB-02). Under 600px, use the two-line row (grid-template-areas 'verb time' / 'body body'), so the verb and time sit as a small-caps running head over a full-width 358px body, as already proved in proto-mobile-ledger-after. Drop or inline the verb only on /logging ('dame.is playing tennis' as one sentence). Keep it on /posting, where it marks replies.

**Evidence.**
- home__mobile__h13__s1.png, home__mobile__h13__s2.png, state-home-scrolled-deep__mobile__h13.png
- extra/layout/chrome-end-home-mobile.png: a quote nested inside a repost wraps at ~170px, 4–5 words per line
- extra/layout/lay-measure.json ledger:mobile cols '80px 206px 56px', gap 8px: body 104→310
- Feed.css:2409-2420 (mobile --ledger-verb-col 5rem, --ledger-time-col 3.5rem), Feed.css:1827-1835 (3-col row grid)
- extra/layout/proto-mobile-ledger-after.png: the same rows with verb and time stacked; body measured 358px (+74%)
- state-cards-layout__mobile__h13.png: the cards layout already uses a verb/time line above full-width content

**Verification note (adjusted).** Verified: lay-measure ledger:mobile gives cols '80px 206px 56px' with an 8px gap. home__mobile__h13__s1/s2 and chrome-end-home-mobile show narrow ribbons, and a quote nested in a repost wraps at 3–5 words per line. Feed.css:2409-2420 and 1827-1835 match. proto-mobile-ledger-after shows the 358px body. One sub-claim is wrong: on /posting the verb column carries information. posting__mobile__h13__s1 shows 'replying' rows between 'posting' rows. Only /logging repeats the same label ('dame.is', per FeedLedgerRow.jsx LEDGER_VERB_LABELS). Plain-text posts wrap at 5–7 words per line, not 4–5.

#### FEED-01 · On phones the ledger squeezes Dame's words into a 206px column (~27 characters per line)  
*Merged into MOB-02.*

`high` · `visual` · effort M · verdict *confirmed* · lens: Home feed / activity ledger UX

**Pages:** /, /posting, /logging

**Observation.** At 390px the grid keeps all three desktop columns. The verb takes 80px and the time 56px, so only 53% of the screen is left for content. Dame's posts wrap at about 27 characters per line, so a 136-character post takes 5 lines. Below each post the embed ends at x=310, leaving a 64px empty strip under the time column (home__mobile__h13__s2.png: 'it's a conspiracy by big / paragraph'). The two label columns step down to 9.6px to fit. Cards use the full 358px and also show engagement, but switching layouts is hidden in the compass dock as two unlabeled glyphs (state-nav-open__desktop__h13.png).

**Recommendation** (carried forward in MOB-02). Make the ledger responsive instead of offering a separate layout. Below about 600px, stack each row: a running-head line with the verb in small caps on the left and the time on the right, then the content at full width (358px). Let embeds use the full column, with images capped at about 20rem tall. Keep the 3-column grid at 600px and wider. A CSS-only prototype gives 45 cpl and readable 12.5px labels at about the same total height (more text per line, larger images).

**Evidence.**
- home__mobile__h13__s0.png
- home__mobile__h13__s2.png
- posting__mobile__h13__s1.png
- state-cards-layout__mobile__h13.png
- extra/feed/proto-mobile-restack-s1.png (CSS prototype)
- Live probe @390px: verb col x=16 w=80, body x=104 w=206, time x=318 w=56; a 136-char post wraps to 5 lines (27 cpl); after restack it is 358px wide, 3 lines (45 cpl)
- Page height for 71 rows on mobile: ledger 16,885px vs cards 28,125px; desktop 13,616 vs 26,849
- src/components/Feed.css:2409-2427 (mobile: --ledger-verb-col 5rem, --ledger-time-col 3.5rem, labels calc(--text-xs*0.8)=9.6px)
- src/components/Feed.css:2263, 2296, 2318 (embeds capped at 20rem/26rem)

#### TYP-11 · Ledger post text runs 31 characters per line on mobile and 90 on desktop, at 1.3 leading  
*Merged into MOB-02.*

`medium` · `ux` · effort M · verdict *adjusted* · lens: Typography & reading experience

**Pages:** /, /posting, /logging, /listening

**Observation.** On mobile, the ledger content column is 206px (80px verb column, 56px time column, 2×8px gaps), so Dame's posts set at 16px run about 30 characters per line and embeds are capped at 206px. On desktop, posts can run about 88 characters per line at 1.3 leading, but most are 1–3 lines, so the impact is small.

**Recommendation** (carried forward in MOB-02). Merge with TYP-01 as a single mobile-ledger change. Below 600px, keep the ledger semantics but move verb and time into a running-head line above each entry ('posting' left, '3:17 pm' right, both at the TYP-01 metadata size in --ink-muted), so text and embeds use the full 358px. Optionally cap desktop .ledger-text at about 34em. Leave leading at 1.3–1.4 for short entries rather than matching the 1.6 used for long-form.

**Evidence.**
- state-chrome-toggle__mobile__h13.png and home__mobile__h13__s0.png (a two-sentence post wraps to 5 lines in the middle column)
- posting__desktop__h13__s1.png (posts wrap at about 88 characters with tight leading)
- measured grid on home: mobile 80px | 206px | 56px (+ 2 × 8px gaps), so .ledger-text is 206px wide ≈ 31 characters; desktop .ledger-text is 588px (capped by p { max-width: 65ch }) ≈ 90 characters
- .ledger-text 16px / line-height 20.8px (1.3) at Feed.css:1888-1891, while quoted embeds (.post-embed-quote-text) use 14px / 22.4px (1.6)
- Feed.css:2413-2418 mobile column widths

**Verification note (adjusted).** The mobile half is solid. The grid is 5rem | 1fr | 3.5rem with 8px gaps, so .ledger-text gets 206px. In state-chrome-toggle__mobile__h13.png, a 130-character post wraps to 5 lines at about 30 characters per line, and embeds are squeezed to 206px while the verb column is mostly empty. The desktop half is weak. Feed posts are typically 1–3 lines (posting__desktop__h13__s1.png), so an 88-character measure and 1.3 leading cost little at that length, and tighter leading for short feed entries than for long-form is defensible. The mobile fix is identical to TYP-01's running-head recommendation, so the two should be presented as one 'mobile ledger layout' change to avoid double-counting.

#### FEED-03 · Clicking a row navigates, but nothing shows it, and continuation rows can't be reached by keyboard

`medium` · `accessibility` · effort S · verdict *adjusted* · lens: Home feed / activity ledger UX · **merges:** INT-07, NAV-04

**Pages:** /, /posting, /logging

**Observation.** Ledger rows navigate when blank space is clicked but show no hover, focus-within or cursor change. The only link in a row is the verb label (13.2px desktop, 9.6px mobile). Thread continuations, about 20–25 of the first 71 rows on the live site, render an empty aria-hidden verb cell and a plain &lt;span> time, so keyboard and screen-reader users have no route to those posts' own pages. Their text is still readable inline, and the thread head is linked.

**Recommendation.** Make the time cell the row's permalink, like a page number in a book: an &lt;a> wrapping a &lt;time datetime> on every row, continuations included. Give rows a quiet hover and focus-within state: the verb and time turn accent-coloured and a 2% ink wash appears behind the row. Set cursor: pointer on navigable rows, or drop the blank-space click entirely and rely on the visible verb and time links.

**Evidence.**
- extra/feed/row-nohover__desktop.png vs extra/feed/row-hover__desktop.png (identical; no hover state)
- Live probe: hovering row body → cursor 'auto', li background transparent; clicking empty row space navigated to https://dame.is/posting/3myuievrrx22g
- Live probe: 23 of the first 71 ledger rows (all thread continuations) contain no link to their own record; time cell is a &lt;span> on every row
- src/components/FeedItem.jsx:188-211 (handleRowClick on &lt;li>, mouse/touch only)
- src/components/FeedLedgerRow.jsx:139-147 (continuations render an empty aria-hidden verb span), :176 (time is a plain span)
- src/components/Feed.css:2098-2106 (pointer cursor only on expandable/lightbox rows)

**Prior review:** RECOMMENDATIONS §2 (Low: ledger observation lightbox opens only on mouse row-click) — still open, and the same mouse-only pattern covers every ledger row

**Verification note (adjusted).** The facts hold. row-hover and row-nohover__desktop.png are byte-identical (same md5). Computed row cursor is 'auto'. No CSS rule styles .feed-item-ledger on :hover or :focus-within. FeedItem.jsx:188-211 handles the click on the &lt;li> only. FeedLedgerRow.jsx:139-147 renders continuations as an empty aria-hidden span, and :176 renders the time as a span. A re-probe found 25 continuation rows in the first 71, and 20 of them have no link to their record. High overstates it, though: the content of continuations is fully readable inline, the thread's head row keeps a visible verb link, and the missing piece is a per-post permalink and route rather than access to content. The prior review rated the matching mouse-only lightbox pattern Low. Medium fits: a real keyboard gap (WCAG 2.1.1) on a third of rows, plus a missing affordance.

#### INT-07 · Ledger rows give almost no hover or affordance for their main link  
*Merged into FEED-03.*

`medium` · `accessibility` · effort S · verdict *adjusted* · lens: Interaction, motion, feedback & states

**Pages:** /, /posting, /logging, /listening

**Observation.** The ledger row's links to its record page (the gerund and the time) are set in faint mono with no underline and read as labels. Hover only shifts the colour (about 1.34:1) with no underline, row cue or destination hint. The underlined links in a row are body links that go elsewhere. This is an affordance and discoverability issue, not a WCAG 1.4.1/1.4.11 failure.

**Recommendation** (carried forward in FEED-03). On a row's :hover / :focus-within, draw a 2 px accent rule in the left margin beside the verb (like a reader's pencil mark), underline the verb and time (text-decoration-color: var(--accent-soft)), and fade in a faint marginal note of the destination ('→ app.bsky.feed.post'). Keep it pointer:fine only, per the existing iOS tap-repaint caveat in typography.css.

**Evidence.**
- extra/interaction/hover-verb-before.png vs hover-verb-after.png (practically identical)
- Measured at 1 pm: a.ledger-verb #3c8b90 → #0f758a on hover, a 1.34:1 shift with no underline; cursor is the only other change
- src/components/Feed.css:1854-1870 (.ledger-verb faint mono, no decoration) and 2192-2196 (time link hover)
- embedded image card .post-embed-images has cursor:auto (no row-level click)

**Verification note (adjusted).** Confirmed. hover-verb-before and hover-verb-after are practically identical. Feed.css:1854-1870 gives a.ledger-verb faint mono with no decoration, and hover only changes the colour to --accent (also on a.ledger-time). The WCAG framing is wrong: 1.4.1 concerns links inside blocks of text, while the verb sits in its own column, and neither 1.4.1 nor 1.4.11 requires a hover state. This is an affordance and discoverability problem, not an accessibility failure. It still matters at medium because the verb and time are the only route to record pages from the home feed.

#### NAV-04 · Home ledger never links to sections: the verb opens the record and the time is plain text  
*Merged into FEED-03.*

`medium` · `ux` · effort S · verdict *confirmed* · lens: Navigation, wayfinding & information architecture

**Pages:** /, /posting, /logging, /listening

**Observation.** In the ledger the left-column gerund ("listening", "mothing", "logging") is the obvious link to that part of Dame's life, but it opens the single record. The right-column time, which on the web conventionally works as a permalink, isn't a link. Apart from the Resume / Projects / Blog buttons, home's main content has no link to any section, so a visitor who enjoys the moth rows has no route from the feed to /mothing.

**Recommendation** (carried forward in FEED-03). Split the two links by column. The gerund links to its section index (or the filtered ledger for verbs without one, see NAV-01), and the time becomes the record's permalink, styled like a page number with a hover underline. The whole-row click can keep opening the record. On section pages like /posting, where every row repeats the page's own gerund, the verb could link to the filtered home view or be dropped.

**Evidence.**
- probe VERBLINKS: "posting"→/posting/3myuk3qhfzs2g, "reposting"→/reposting/3myuh64psn623
- probe HOME-SECTION-LINKS: 0 links in &lt;main> to /listening, /logging, /mothing, /curating, /posting, /welcoming, /themself (only the 3 CTAs reach /available, /creating, /blogging)
- src/components/FeedLedgerRow.jsx:139-145 (verb cell &lt;Link to={href}> = record href), :176 (ledger-time is a &lt;span>)
- src/components/FeedItem.jsx:123 (href = hrefFor(item))
- home__desktop__h13__s0.png (verb | content | time ledger)

#### LAY-08 · Day-grouped single-type pages spend ~126px per one-entry day

`medium` · `ux` · effort S · verdict *confirmed* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** /logging, /posting, /listening

**Observation.** /logging shows one or two short statuses per day, but each day gets a full section: an 18px H3, a full-strength rule, the row with its own hairline, then a 48px gap. Two thirds of each day's height is scaffolding. The verb column repeats 'dame.is' on every row (intended to complete the sentence 'dame.is playing tennis'), but the 104px column and 12px gap split that sentence across a gutter. On mobile the same column costs 88px.

**Recommendation.** On sparse single-type feeds, move the date into the left margin column as a running date (shown on the first row of each day, e.g. 'Oct 24 · day 12,224'), drop the per-day H3, rule and 48px gap, and separate days with a slightly heavier hairline. Keep the full day headers only on the dense mixed home feed. Render the logging sentence inline ('dame.is playing tennis', with 'dame.is' in faint ink) rather than across two grid cells.

**Evidence.**
- logging__desktop__h13__s1.png: day headers at y=216, 342, 469, 595, so each single-status day costs ~126px (H3 + full rule + one 46px row + 48px group gap)
- logging__mobile__h13__s1.png: 'Yesterday' / 'October 25' / 'October 24' groups of 1–2 rows each with ~58px gaps
- metrics: logging page height 40,244px desktop / 42,360px mobile
- Feed.css:70-72 (.feed-day-group + .feed-day-group margin-top: --space-7)
- FeedLedgerRow.jsx:53-61 (logging rows labelled 'dame.is' in the verb column on every row)

#### FEED-10 · /posting and /logging repeat the same word in every row's verb column

`low` · `content` · effort S · verdict *confirmed* · lens: Home feed / activity ledger UX · **merges:** COL-09

**Pages:** /posting, /logging

**Observation.** Posting.jsx asks for showVerb={false}, but the ledger renderer ignores it, so a page titled 'Posting' prints 'posting' beside almost every row and spends 116px of column on it. On /logging every row begins 'dame.is' in the margin, about 116px from its status ('dame.is        going for a walk        3:34 pm'). The sentence the label is meant to complete is split apart by the grid.

**Recommendation.** Honour showVerb={false} in the ledger and use the two-column flat ledger on single-verb pages, printing a marker only for exceptions ('↳ reply', 'thread · 3'). Ship this together with or after FEED-03's time-as-permalink (&lt;a>&lt;time>) so that every row keeps a visible, keyboard-reachable link once the verb label goes. On /logging, set 'dame.is' in small caps run into the status as one sentence.

**Evidence.**
- posting__desktop__h13__s0.png, posting__desktop__h13__s1.png ('posting' on nearly every row; only 'replying' differs)
- logging__desktop__h13__s2.png, logging__mobile__h13__s2.png ('dame.is' on every row)
- src/pages/Posting.jsx:84 (passes showVerb={false}) vs src/components/FeedItem.jsx:300-308 (ledger path ignores showVerb)
- src/components/FeedLedgerRow.jsx:59-61 (logging label = 'dame.is')
- src/components/Feed.css:2154-2160 (the flat ledger on /blogging already drops the redundant verb column)

#### COL-09 · /listening repeats 'listening' in every ledger row and shows no artwork in the history  
*Merged into FEED-10.*

`medium` · `ux` · effort S · verdict *confirmed* · lens: Collection, gallery & detail pages

**Pages:** /listening

**Observation.** On a page that is only listening, each session row spends its first column on the word 'listening'. On phones that column costs 80px of a 358px row and pushes song/artist text into 2–3 lines. Meanwhile the history has no covers, although the page's top lists and album shelf show art everywhere else.

**Recommendation** (carried forward in FEED-10). Make ledger rows honour showVerb={false}, or route /listening through a single-type ledger variant. Reuse the freed column for a 40px square cover of the session's first release (art is already fetched via AlbumCover/albumArt). Keep time in the right folio column.

**Evidence.**
- listening__desktop__h13__s1.png and s2: every row begins with 'listening' in the 104px verb column
- listening__mobile__h13__s2.png: the verb column (5rem) takes ~25% of row width, so artist names wrap ('Magdalena / Bay', 'Creedence / Clearwater Revival')
- src/pages/Listening.jsx passes showVerb={false}, but src/components/FeedItem.jsx:300-307 renders FeedLedgerRow without it, and FeedLedgerRow.jsx:92-96 always derives the label
- src/components/Feed.css:1784 (--ledger-verb-col 6.5rem) and :2414 (5rem on phones)
- FlatLedger (src/components/FlatLedger.jsx:8-11) already drops the redundant verb column for single-type pages, so /listening is the odd one out

#### LAY-04 · Desktop ledger: 210–480px of empty air between content and timestamp

`low` · `visual` · effort S · verdict *adjusted* · lens: Layout, grid, spacing & responsive behaviour · **merges:** FEED-07

**Pages:** /, /posting, /logging

**Observation.** At 1440 the ledger's middle column is 787px, but content inside it ends on three different edges: text at 934 (65ch), single images at 666 (the 20rem cap) and link, quote and repost boxes at 762 (the 26rem cap). Embed rows therefore leave 384–480px blank before the right-aligned time, while text rows leave about 212px. The far-right time follows the same table-of-contents convention as the flat ledgers.

**Recommendation.** Unify the embed caps with the text measure (max-width: 100% of .ledger-body, or one shared cap), so every row's content shares one right edge. Moving the time under the verb as marginalia is optional. If it is done, apply it to the flat ledgers too, or it creates a new inconsistency with the praised table-of-contents idiom.

**Evidence.**
- home__desktop__h13__s0.png, home__desktop__h13__s1.png, home__desktop__h13__s2.png, state-ultrawide-home__desktop__h13.png, state-cards-layout__desktop__h13.png
- extra/layout/lay-measure.json ledger:desktop cols '104px 787px 64px': body box 346→934 (65ch), image embeds 346→666 (320px), link/quote/repost boxes 346→762 (416px), time 1146→1210
- Feed.css:1883-1886 (.ledger-body max-width: measure), Feed.css:1872-1881 (time right-aligned), Feed.css:2261-2264 (images 20rem), Feed.css:2292-2297 and 2315-2319 (26rem caps)
- extra/layout/proto-desktop-ledger-time-in-margin.png: time moved under the verb

**Verification note (adjusted).** The numbers are accurate: lay-measure ledger:desktop gives cols '104px 787px 64px', body 346→934, image embeds to 666, quote and link boxes to 762, time 1146→1210, visible in home__desktop__h13__s1/s2. But a time column pinned to the far right is the same table-of-contents 'page number' idiom this audit praises in its strengths, for /blogging and the nav menu, and Feed.css:1821-1826 documents it as deliberate. So 'orphaned metadata that undercuts the book idea' is contestable taste. The real defect is the three different embed caps (20rem, 26rem, 65ch), which give ragged right edges inside the content column. That is polish-level.

#### FEED-07 · On desktop the time column sits 200–480px from the content it belongs to  
*Merged into LAY-04.*

`low` · `visual` · effort M · verdict *adjusted* · lens: Home feed / activity ledger UX

**Pages:** /, /posting, /logging

**Observation.** On desktop the time column is pinned at x≈1146–1210 while text stops near x≈934 (65ch measure), single images at x≈666 and quotes at x≈762. For image posts the time sits about 480px from its content, joined only by the row's hairline rule. The cards layout has the same gap ('1h ago' at the far right in cards-desktop-s0.png).

**Recommendation** (carried forward in LAY-04). Bring the two metadata columns together in the left margin as marginalia: the verb on top and the time under it, in a 7rem column like a margin note. Let the content column sit at its natural measure. Use the freed right margin for something useful at wide widths, such as quiet per-row engagement ('♡ 15 · ↻ 1', see FEED-09) or nothing at all. Alternatively, size the grid's middle track to its content (minmax(0, 40rem)) so the time hugs the content's right edge.

**Evidence.**
- home__desktop__h13__s0.png, home__desktop__h13__s1.png
- extra/feed/cards-desktop-s0.png (same gap in cards: content ends ~818px, '1h ago' at 1175px)
- Live probe @1440: verb x=230 w=104; body x=346 (max-width 65ch = 588px); single images 320px wide (ends x=666), quotes/link cards 416px (ends x=762); time x=1146-1210
- src/components/Feed.css:1827-1835 (grid: verb | 1fr | time)
- src/components/Feed.css:1883-1886, 2261-2297, 2315-2319 (body/embeds max-widths)

**Verification note (adjusted).** The measurements are right. A re-probe at 1440 gives verb x=230 w=104, body x=346 w=588, time x=1146 w=64. In home__desktop__h13__s0.png the image ends at about 666 while '3:17 pm' sits at about 1174, a gap of about 480px. Text rows leave about 240px. But a right-aligned time column joined to its row by a full-width hairline is a standard ledger or table pattern, and the rule does connect the time to its row. The cost is a weaker visual link and unused width on the right, not a usability failure, so this is polish rather than medium friction. Both alternatives (marginalia stacked under the verb, or a content-sized middle track) are on-brand.

### Theme 3 — A ledger that tells the truth about itself

#### FEED-02 · Deeper in the feed the ledger shows a skewed sample but labels each day as if it were complete

`high` · `functional` · effort M · verdict *confirmed* · lens: Home feed / activity ledger UX

**Pages:** /

**Observation.** Each collection is fetched once with a cap of 100 records, then merged. Busy collections like posts and listens run out after a few days, while sparse ones like creating, blogging and listing go back years. As you scroll, Dame's own posts stop after Oct 25, reposts stop after Oct 3, and September 2026 shows only status logs and follows. October 23 is headed '11 items' even though Dame posted 61 times that day. The feed keeps scrolling through gaps ('March 29 → January 1, 2026 → December 1, 2025') and ends at 'January 1, 2011 / creating / Photographs: Era 1 (Part II)' with no end marker. The only progress cue is an unlabeled number ('546') next to the scroll-to-top arrow.

**Recommendation.** Compute the oldest date at which every active collection is still complete (the newest of each collection's oldest loaded record) and stop the unified ledger there. Below it, add a printed-style colophon: 'The ledger is complete back to Sat, Oct 25 — 312 records. Older: posts · logs · listens · works ›', each linking to its gerund page or /exploring. As a longer-term fix, paginate each collection with its cursor so the horizon moves as the reader scrolls. Give the scrolled-past counter a unit, or replace it with the date currently in view.

**Evidence.**
- extra/feed/home-feed-end__desktop.png
- state-home-scrolled-deep__desktop__h13.png (Oct 23: only reposts/listening)
- Live probe of all 189 day groups: posting rows on Today=19, Yesterday=13, Oct 25=13, then 0 posting rows Oct 24→Oct 1; Oct 23 header reads '11 items' (reposting 8, listening 3, logging 1)
- Public AppView getAuthorFeed: Dame authored 61 posts on 2026-10-23, 10 on 10-24, 10 on 10-22
- Sept 2026 day groups contain only logging/following; feed ends at 'January 1, 2011 · creating' with no end marker (554 rows, 83,499px)
- src/pages/Home.jsx:47-51 (INITIAL_FETCH_MAX = 100 per collection; 'deeper history isn't fetched')
- src/pages/Home.jsx:571-584, 768-784 (client-side reveal only; no terminal state)
- Bottom bar shows a bare '546' (ChromeBar.jsx:918-927 'items scrolled past')

#### FEED-05 · Reposts outweigh Dame's own posts: they are framed, tinted, unclamped and take about 35% of the feed's height

`medium` · `visual` · effort M · verdict *adjusted* · lens: Home feed / activity ledger UX · **merges:** IDN-05, FEED-11

**Pages:** /

**Observation.** A repost is a tinted, bordered box with avatar, name, handle and relative time. Its text is unclamped and its own media and link card render (height-capped by the ledger rules at 20rem for images and 10rem for video), and it can contain a nested quote box with full text. Dame's own posts are plain serif text. Reposts are about 22% of rows but about 34% of feed height on both viewports. A quote inside Dame's own post is clamped to 2 lines, so the emphasis runs opposite to authorship.

**Recommendation.** Give reposts a compact, citation-style treatment: '@poe.atpota.to —' then the post text clamped to 2 lines at --text-sm, a single 3.75rem thumbnail if there is media, and no nested quote. Set it as an epigraph with a 1px left rule and no box or tint. Expand inline on tap, the same way listening sessions do. Keep the tinted box for the rare quote inside Dame's own post.

**Evidence.**
- home__desktop__h13__s1.png (two reposts fill the viewport; Dame's 'gm from cooper' is one line)
- state-home-scrolled-deep__desktop__h13.png, state-home-scrolled-deep__mobile__h13.png (repost → video → nested quote, ~590 CSS px tall on mobile)
- Live probe (first 71 rows): reposting rows avg 275px desktop / 362px mobile vs Dame's text-only posts 67px / 113px; 16 reposts = 4,403 of 12,580px (35%) desktop, 5,795 of 15,958px (36%) mobile
- src/components/FeedLedgerRow.jsx:235-296 (RepostQuote renders full author head, full text, embeds)
- src/components/Feed.css:2350-2381 (repost text unclamped; media and nested quote re-enabled)

**Verification note (adjusted).** The weight imbalance is real. A re-probe of the first 71 rows found 16 reposts taking 4,403 of 13,067px on desktop (34%) and 5,795 of 16,931px on mobile (34%). home__desktop__h13__s1.png shows two boxed reposts filling the viewport above the one-line 'gm from cooper'. CSS confirms repost text is unclamped while a quote inside Dame's own post is clamped to 2 lines (Feed.css:2318-2381). One claim is overstated: repost media does not render at full size. It inherits the ledger caps (images max-width 20rem with max height 20rem, video max-height 10rem, link cards 26rem), so its height comes mostly from unclamped text and nested quotes. The epigraph recommendation is on-brand.

#### IDN-05 · Quoted and reposted posts are drawn as Bluesky cards, so the ledger reads as a social feed with a gutter  
*Merged into FEED-05.*

`medium` · `visual` · effort M · verdict *adjusted* · lens: Visual identity & aesthetic

**Pages:** /, /posting, /creating/ratioed, record pages

**Observation.** In the home ledger, reposted and quoted posts appear as bordered, ink-tinted boxes (PostEmbed.css:251-263) with a ~20px avatar (Feed.css:2321 override), a display-name/handle stack and a relative timestamp, nesting box-in-box for quote chains. They are already condensed (max-width 26rem), but they are still the visually heaviest, most Bluesky-client-like objects on the page, and they break the ledger's 'hairline between rows is the only structure' rhythm.

**Recommendation** (carried forward in FEED-05). Typeset quotation instead of boxing it. Remove the border and fill. Set quoted text in ink-soft with the site's own blockquote device: a 1px accent-soft left rule and 1em indent (typography.css:105). Move attribution to one small-caps line under the quote, '— POE · @poe.atpota.to · 1D', with an optional 16px square avatar inline. Nested quotes indent another 1em and switch to italic, never another box. Reduce link cards to a single hairline 'reference' line: host in small caps · title.

**Evidence.**
- home__desktop__h13__s1.png: Poe and 'seed paste soy goblin' reposts as tinted, bordered cards with avatar, handle and timestamp headers
- home__desktop__h13__s2.png: Erin Kissane → Carl T. Bergstrom as a box inside a box
- ratioed__desktop__h13__s0.png: nested quote boxes
- state-cards-layout__desktop__h13.png
- src/components/PostEmbed.css:251-263 (.post-embed-quote: 1px --rule border, padding, nest-tint fill), :289-326 (32px avatar, name/handle/time header)

**Verification note (adjusted).** The visual claim holds. home__desktop__h13__s1/s2.png show reposts and quotes as bordered, nest-tinted boxes with an avatar, name/handle stack and relative time, with box-in-box nesting (Erin Kissane → Carl T. Bergstrom). They are the heaviest objects in the ledger. The details are partly wrong, though. On home these render inside .ledger-embed, which Feed.css:2315-2324 already condenses: avatar 1.25rem (~20px, which the zoom confirms), max-width 26rem, a two-line text clamp. The 32px avatar comes from PostEmbed.css:289, which applies only outside the ledger. The typeset-quotation recommendation keeps attribution clear and fits the book identity. Medium is reasonable for the most-visited page.

#### FEED-11 · Reposts and quotes show two clashing time systems in one row  
*Merged into FEED-05.*

`low` · `content` · effort S · verdict *confirmed* · lens: Home feed / activity ledger UX

**Pages:** /, /posting

**Observation.** The ledger's time column uses absolute lowercase clock times ('11:16 pm'). The repost or quote header inside the same row shows a relative time ('17h ago', '1d ago'), and a nested quote adds a third ('21h ago'). The relative time is larger (13.2px) and accent-coloured as a link to bsky.app, so it outweighs the row's own 11.2px time. The cards layout uses relative times throughout ('2h ago').

**Recommendation** (carried forward in FEED-05). Keep one time system per layout. In the ledger, show the original post's time as a muted absolute date ('Oct 26') or drop it, and keep the external link on the author name. Leave the time column as the only clock. Cards can stay relative.

**Evidence.**
- extra/feed/listen-expanded-desktop.png (repost row: '17h ago' and nested '21h ago' in the box, '11:16 pm' in the time column)
- home__desktop__h13__s1.png ('1d ago' in Poe box vs '2:30 pm' row time)
- Live computed: quote-head time 13.2px accent link vs row time 11.22px ink-faint
- src/components/FeedLedgerRow.jsx:275-284 (RelativeTimeText in repost head) vs :130-134, :176 (absolute formatTime)

#### FEED-06 · Thread blocks reverse the time column's order and are pulled across midnight

`medium` · `ux` · effort M · verdict *confirmed* · lens: Home feed / activity ledger UX

**Pages:** /, /posting

**Observation.** Self-threads are lifted to their newest post's position but listed oldest-first. So the time column, otherwise newest-first, briefly runs the other way (1:27 → 1:29 → 1:46, then back to 1:44). A thread that crosses midnight is also placed on the later day. On /posting, an Oct 26 '8:57 pm' post sits under the 'Today' header and sticky strip, followed by 12:12 am, 1:13 am and 1:37 am. The only sign that rows belong together is a dashed rather than solid rule and an empty verb cell, which on mobile looks like a missing label.

**Recommendation.** Mark threads clearly: the first member's verb cell reads 'thread · 4', and a vertical hairline in the verb gutter joins the members like a margin bracket. Give the block a time range ('8:57 pm – 1:37 am') on the first row and lighter per-post times. Prefix any member that falls on a different calendar day with a short date ('Oct 26 · 8:57 pm'). Optionally order thread members newest-first to match the page, or keep oldest-first but label the block 'read down ↓'.

**Evidence.**
- home__desktop__h13__s2.png (time column reads 1:27 am, 1:29 am, 1:46 am, then 1:44 am, 1:41 am)
- posting__mobile__h13__s1.png ('8:57 pm' under the TODAY strip directly after '1:44 am')
- posting__desktop__h13__s2.png / posting__mobile__h13__s2.png (thread members 12:12 am, 1:13 am, 1:37 am with blank verb cells)
- src/lib/threadGrouping.js:3-5, 85-87 (thread floats to newest member, emitted oldest-first)
- src/lib/threadGrouping.js:129-133 (threadAwareDateKey pulls threads onto newest member's day)
- src/components/FeedLedgerRow.jsx:91-96 (continuations get no label)

#### FEED-08 · In the filter sheet, 'off' chips stand out more than 'on' chips, and the counts and verbs are unexplained

`medium` · `ux` · effort M · verdict *adjusted* · lens: Home feed / activity ledger UX · **merges:** LAY-12, INT-08, MOB-13

**Pages:** /

**Observation.** Active chips get a --highlight fill and an accent border; inactive chips get a --page (near-white) fill and a --rule border, and aria-pressed is set. The difference is low-contrast in the sky palette, and the white OFF chips (replying, liking, flushing) stand out most against the pale-cyan sheet, which makes the state ambiguous at a glance. Counts are loaded-record tallies capped by the 100-per-collection fetch ('logging 100', 'mothing 100', 'observing 100', 'reposting 100'), and 'liking ~85' is a snapshot estimate. Verbs are ungrouped and unexplained, 'ONLY' repeats 17 times, and once the sheet is closed the only sign of a filter is the tinted filter icon in the bottom bar.

**Recommendation.** Rework the sheet as a ruled checklist grouped like a table of contents: 'Words' (posting, replying, blogging, logging), 'Making' (creating, crafting, photographing), 'Listening & watching' (listening, mothing, observing), 'Social' (reposting, liking, following, listing, feeding, commenting) and 'Other' (flushing). Each line gets a square check box (☑ or ☐), the gerund, a one-line gloss in ink-muted ('flushing — toilet check-ins via Flushes'), and a right-aligned count labelled 'since Oct 25'. Show 'only' on hover or focus, or move it to a long-press. When filtered, print a one-line note above 'Today': 'Showing mothing only · reset'.

**Evidence.**
- state-filters-open__desktop__h13.png, state-filters-open__mobile__h13.png
- src/components/FeedFilters.css:190-201 (active = --highlight fill + accent border; inactive = --page fill)
- src/components/FeedFilters.jsx:157-205 (17 chips, each with its own 'ONLY' button)
- src/pages/Home.jsx:47-51, 519-548 (counts = records loaded per collection, capped at 100; snapshot estimate '~85')
- src/components/ChromeBar.jsx:533, 732 (only signal of a custom filter is the bottom-bar icon tint)

**Verification note (adjusted).** State IS distinguishable. The active chip has a --highlight fill and an accent border, the inactive one has a --page fill and a --rule border (FeedFilters.css:190-201), and the buttons expose aria-pressed (FeedFilters.jsx:170). So 'nothing marks a chip as checked except that subtle fill' is inaccurate. The real issue is weak and ambiguous contrast: in state-filters-open__desktop/mobile__h13.png the near-white OFF chips (replying, liking, flushing) are the most eye-catching objects on the pale-cyan sheet, which can read as 'selected'. The other claims check out. Counts are loaded-record tallies capped at 100 (logging, mothing, observing and reposting all read 100). Liking shows a snapshot estimate (~85). 'ONLY' repeats 17 times. The only cue to a custom filter once the sheet is closed is the tinted bottom-bar icon (ChromeBar.jsx:533, 732). The index-style checklist recommendation is on-brand.

#### LAY-12 · Feed filter sheet is a ragged chip cloud rather than an aligned index  
*Merged into FEED-08.*

`low` · `visual` · effort M · verdict *confirmed* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** / (filters sheet), /posting, /mothing

**Observation.** The 17 gerund filters are flex-wrapped pills whose widths depend on label and count, so the 'only' sub-buttons and the counts land at a different x in every chip. Compare the nav menu, which presents the same gerunds as a ruled ledger with paths right-aligned (state-nav-open__desktop__h13.png).

**Recommendation** (carried forward in FEED-08). Lay the filters out as a grid: 3 columns on desktop and 2 on mobile, each cell holding a checkbox glyph, gerund, right-aligned tabular count and a trailing 'only' column. Better still, use a single-column ruled list with counts aligned like page numbers.

**Evidence.**
- state-filters-open__desktop__h13.png: three rows of chips ending at x≈1091, 1143 and 909 with no column alignment
- state-filters-open__mobile__h13.png: 2-up chips of uneven widths (e.g. 'REPLYING 66' 270px vs 'LOGGING 100' 278px), so the ONLY buttons don't line up
- FeedFilters.css:10-14 (.feed-chips flex-wrap)

#### INT-08 · Filter chips show on/off only through a 1.35:1 tint; quick pills read as disabled  
*Merged into FEED-08.*

`low` · `accessibility` · effort S · verdict *adjusted* · lens: Interaction, motion, feedback & states

**Pages:** / (filter sheet), /posting, /creating

**Observation.** Included and excluded filter chips differ only in fill and border colour, with no glyph. The difference is readable but relies on colour alone. Counts that hit the page-size cap show as '100', like real totals. The small-caps 'ONLY' sub-buttons are about 35×30 px on mobile.

**Recommendation** (carried forward in FEED-08). Mark the state with a glyph and typography as well as fill: included = '✓' before the icon with accent label and ink count; excluded = label in --ink-faint, count struck through or shown as '—', and no fill. Make the quick actions plain text links in small caps separated by middots ('show all · none · defaults'). Show caps honestly ('100+'). Add a live summary in the sheet header: 'SHOWING 13 OF 17 KINDS'.

**Evidence.**
- state-filters-open__desktop__h13.png, state-filters-open__mobile__h13.png
- extra/interaction/filters-defaults-desktop.png vs filters-show-none-desktop.png (on fill rgb(179,225,233) vs off rgb(240,252,254) = 1.35:1)
- Measured mobile: 'ONLY' sub-buttons 35 × 30 px at 11.2 px type
- src/components/FeedFilters.css:190-201 (.feed-chip-wrap.is-active: --highlight + accent border only)
- src/components/FeedFilters.css:160-186 (quick pills: dashed --rule border)

**Verification note (adjusted).** In state-filters-open (both viewports) and filters-defaults-desktop, the three excluded kinds (replying, liking, flushing) stand out at a glance: they are near-white with a pale border, while included chips have a tinted fill and a darker accent border (FeedFilters.css:190-201). So 'telling them apart takes study' is overstated. The filled 'DEFAULTS' pill correctly signals that the current set equals the defaults. The dashed borders on the quick pills are a taste point. The valid parts are polish: state is carried only by colour and weight with no glyph, the many '100' counts look like totals although they are page caps (the chip already uses '~85' for estimates, so a matching '100+' is natural), and the ONLY sub-buttons are small.

#### MOB-13 · Filter chips show on/off by tint alone, and the 'only' half is a 35×30 target fused to the toggle  
*Merged into FEED-08.*

`low` · `accessibility` · effort S · verdict *confirmed* · lens: Mobile experience & accessible design (MOB)

**Pages:** / (filter sheet), /posting, /creating

**Observation.** Each type chip is two buttons in one box. Tapping the left part toggles the type, while tapping the 'ONLY' part wipes every other type. The two sit edge to edge at 30px tall. On/off is conveyed by fill colour, which at some hours sits close to the sheet surface.

**Recommendation** (carried forward in FEED-08). Add a shape cue that fits the zero-radius vocabulary: a small filled square ■ before 'on' gerunds and a hollow □ before 'off' ones, or strike the off label with a hairline. Separate 'only' with an 8px gap and render it as an explicit small-caps text button. Use a 44px min-height on coarse pointers.

**Evidence.**
- shots/state-filters-open__mobile__h13.png: 'replying', 'liking' and 'flushing' (off) differ from the others (on) only by a white vs 16%-accent fill and border colour.
- FeedFilters.css:189-228: .feed-chip-wrap.is-active changes only background (--highlight), border-color and text colour.
- Measured: toggle 96×30, with 'Show only replying' 35×30 directly abutting it and no gap. Labels are 12px small caps; counts are 11.2px in --ink-faint (3.79:1).

#### FEED-09 · Day headers are inconsistent and cryptic, and show a total no row explains

`low` · `content` · effort S · verdict *adjusted* · lens: Home feed / activity ledger UX

**Pages:** /, /posting, /logging

**Observation.** On home the right side of each day header reads '23 items, 289 interactions', where 'interactions' means likes, reposts and replies received, which is never explained. On /posting and /logging the same header reads 'Day 12,227' instead. No ledger row shows its engagement, although the cards layout does ('2 replies · 1 repost · 15 likes'), so the 289 can't be traced to anything. The sticky strip says 'TODAY' in the ledger but 'TODAY, OCTOBER 27, 2026' in cards. The 'Today' header itself is 18px under a 48px hero (H1 → H3), so the feed starts without a clear section heading.

**Recommendation.** Use one format on every feed page: on the left 'Today' plus a small-caps date ('Tue 27 Oct'); on the right a 'running head' with 'day 12,227 · 24 records'. Drop 'interactions' from the header. Instead show quiet per-row engagement in the ledger (for example '♡ 15' under the time, faint) so the totals are traceable. Make the sticky strip match ('Today · Oct 27 · day 12,227') in both layouts.

**Evidence.**
- home__desktop__h13__s0.png ('Today … 23 items, 289 interactions')
- posting__desktop__h13__s0.png, logging__desktop__h13__s0.png ('Today … Day 12,227')
- state-cards-layout__desktop__h13.png (sticky strip 'TODAY, OCTOBER 27, 2026') vs home__desktop__h13__s1.png (ledger strip 'TODAY')
- extra/feed/cards-mobile-s2.png (cards show '9 replies · 11 reposts · 174 likes'; ledger rows show none)
- src/pages/Home.jsx:100-124 (interactions = likes+reposts+replies received on that day's posts)
- src/components/DayOfLifeHeader.jsx:30-32 (default meta 'Day N')

**Verification note (adjusted).** Everything stated is accurate. Home reads 'Today … 23 items, 289 interactions' (Home.jsx:100-124), while /posting and /logging read 'Day 12,227' (posting__desktop__h13__s0.png, logging__desktop__h13__s2.png). The ledger sticky strip says 'TODAY' and the cards strip says 'TODAY, OCTOBER 27, 2026'. Ledger rows show no engagement, while cards show '2 replies · 1 repost · 15 likes'. The headings go H1 to H3 with no H2. But these are wording and consistency issues in secondary metadata. 'interactions' is fairly self-explanatory, and the inconsistency only shows when comparing pages. That is polish, not medium friction on the primary task.

#### FEED-12 · Link-only posts show the URL twice, and the truncated URL becomes the loudest text in the row

`low` · `content` · effort S · verdict *adjusted* · lens: Home feed / activity ledger UX

**Pages:** /, /posting

**Observation.** When Dame posts a bare link, the row's text is that URL, truncated to 'dame.is/curating/ran…' in underlined accent at 16px. Directly below is a link card for the same URL with a readable title ('random shit my youtube algorithm recommends me'). The truncated URL is the loudest text in the row and repeats the card. Bluesky does not hide such text when rendering; its composer avoids it by stripping trailing URLs at post time.

**Recommendation.** If the post text, after trimming, equals or is a prefix of the external embed's URI, render no text and let the card stand alone. Alternatively, use the card's title as the summary line.

**Evidence.**
- home__desktop__h13__early.png, home__mobile__h13__s0.png, posting__desktop__h13__s0.png ('dame.is/curating/ran...' underlined above a dame.is link card for the same URL)
- extra/feed/cards-mobile-s1.png (same duplication in cards)
- src/components/FeedLedgerRow.jsx:380-406 (summarizePost renders the text even when it is only the embed's URL)

**Verification note (adjusted).** The duplication is real. home__desktop__h13__s0/early.png and posting__desktop__h13__s0.png show an underlined, truncated 'dame.is/curating/ran…' at 16px above a link card for the same URL with a better title, and summarizePost renders the text whenever it exists. The supporting claim that 'Bluesky and most clients hide link text that matches the embed' is inaccurate: the Bluesky composer strips a trailing URL before posting, but renderers show the post text as stored. The case for the fix rests on redundancy and the meaningless truncated headline, not on client convention.

#### FEED-13 · Year-only works show a false time: 'January 1, 2011 · 12:00 am'

`low` · `content` · effort S · verdict *confirmed* · lens: Home feed / activity ledger UX

**Pages:** /

**Observation.** Works that only have a year (photography eras, notebooks, early projects) are stored as YYYY-01-01T00:00. The ledger groups each under its own 'January 1, 2014' header and prints '12:00 am' in the time column, which looks precise but isn't.

**Recommendation.** Detect records at midnight on Jan 1, or with an explicit date-precision field, and show the year in the time column ('2014') or leave it blank. Group them under year headers in an 'Earlier works' section, or leave them out of the unified ledger in favour of /creating (see FEED-02).

**Evidence.**
- extra/feed/home-feed-end__desktop.png (January 1, 2011 / 2014 / 2019 / 2022 / 2023 groups, each row '12:00 am')
- Live probe: last day groups are all 'January 1, YYYY' with only creating rows

### Theme 4 — The book devices are designed but not applied

#### COL-04 · Photo series on creating works leave large holes and are squeezed into the 588px reading measure

`medium` · `visual` · effort M · verdict *confirmed* · lens: Collection, gallery & detail pages · **merges:** LAY-09, IDN-06

**Pages:** /creating/photographs-era-1-part-i, /creating/:slug (any gallery)

**Observation.** Photo works use the leaflet gallery's fixed two-up grid. With mixed portrait and landscape frames, every row is as tall as its tallest image, and the shorter neighbour leaves a page-coloured hole beneath it, so the sequence reads as broken. The whole series also stays inside the prose measure, so on desktop each photograph is about 287px wide with 400+px of empty margin on both sides.

**Recommendation.** For galleries, use justified rows: each figure gets flex-grow and flex-basis proportional to its aspect ratio, so every row is flush and hole-free. Alternatively use a 2-column CSS-columns masonry, or a 'plate' layout where portrait frames span two rows. Let galleries opt into the wide figure width the CSS already reserves for oversized figures (the 'room for a figure to outgrow the measure' rule in Blogging.css) so photo series run at ~980px. Add short captions or plate numbers in small caps. Fix the slug/title mismatches in the portfolio data.

**Evidence.**
- creating-work-photos__desktop__h13__s1.png: a landscape (green leaf) cell beside a tall portrait (Lego figure) leaves ~240px of empty page under the landscape; the same happens under the windshield shot
- creating-work-photos__desktop__h13__s2.png: the left column is empty beside the portrait 'hand with shoe' photo
- creating-work-photos__mobile__h13__s1.png: the same holes at phone size (empty cell left of the mushroom portrait)
- src/components/LeafletDocument.css:293-302 (.leaflet-gallery fixed 2-column grid, items keep their natural aspect, so row height = tallest cell)
- Photos render ~287px wide on a 1440px screen because .creating-work-page is capped at --measure (src/pages/Blogging.css .blog-article/.creating-work-page max-width: var(--measure))
- Content hygiene: scripts/portfolio/works.json has slug 'photographs-era-1-part-i' titled 'Photographs: Era 1 (Part II)' and 'Photographs: Era 2 (Part I)' with slug 'photography'. The URL and title disagree (breadcrumb vs H1 in creating-work-photos__desktop__h13__s0.png)

#### LAY-09 · Photo galleries are locked to the 588px measure on wide screens  
*Merged into COL-04.*

`low` · `visual` · effort S · verdict *confirmed* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** /creating/photographs-era-1-part-i, /blogging/:slug

**Observation.** The document column correctly caps prose at 65ch, and the stylesheet already computes how far a figure may widen into the margin (--doc-overhang, up to the 980px frame). Only the Ratioed data table uses it. Photo galleries in a photography portfolio piece therefore render as 288px thumbnails, and single figures don't match the text edge.

**Recommendation** (carried forward in COL-04). Apply margin-inline: calc(-1 * var(--doc-overhang)) to .leaflet-gallery (and optionally to a 'wide' single image) so plates span the full 980px frame on desktop, with captions kept at the measure. Snap single figures to the text column's exact width (100%) so their right edge matches the prose.

**Evidence.**
- creating-work-photos__desktop__h13__s0.png: 2-up gallery with each photo 288px wide inside 426–1014 on a 1440 screen, with ~200px of blank margin on each side
- blogpost__desktop__h13__s1.png: the screenshot figure sits at 426–983 and ends 31px short of the 1014 text edge
- LeafletDocument.css:293-296 (.leaflet-gallery grid inside the article cap)
- Blogging.css:115-130 defines --doc-room/--doc-overhang so figures can widen to the 980px frame, but only RatioedBlock.css:29 uses it

#### IDN-06 · Photographs are handled as UI thumbnails (matted, force-cropped, held to the text measure) instead of as plates  
*Merged into COL-04.*

`low` · `visual` · effort M · verdict *adjusted* · lens: Visual identity & aesthetic

**Pages:** /curating/*, /creating/photographs-*, /mothing, /mothing/*, /

**Observation.** Photographs are presented as UI tiles rather than as plates. Curating images are letterboxed (not cropped) inside square tinted mats with a hover lift. Moth photos are cropped 1:1 above caption slabs. Document galleries keep the natural aspect but stay inside the 588px reading measure, even though --doc-overhang is already computed to let figures widen (used only by RatioedBlock). Image keylines take the sky tint from --rule-soft.

**Recommendation** (carried forward in COL-04). Widen .leaflet-gallery and lone .leaflet-image into the margins with margin-inline: calc(-1 * var(--doc-overhang)). Replace the translateY hover lifts with a keyline darkening. Use a neutral ink-12% keyline for images and an italic caption, optionally with a small-caps 'PL.' prefix. Leave the mat colour fix to IDN-01. Optionally dim embedded images slightly at night hours.

**Evidence.**
- curating-channel__desktop__h13__s0.png: images letterboxed inside square cyan mats (src/pages/Curating.css:19-30, background var(--page-edge), object-fit: contain)
- creating-work-photos__desktop__h13__s0.png: a photo essay as a two-up grid about 588px wide on a 1440px screen
- src/components/LeafletDocument.css:293-318 (gallery stays in the measure); src/pages/Blogging.css:127-130 computes --doc-overhang, but only RatioedBlock.css:29 uses it
- mothing-night__desktop__h13__s0.png: moths cropped 1:1 above cyan caption slabs (src/pages/Mothing.css:100-140)
- home__desktop__h00__s0.png: a white tweet screenshot is the brightest object on the midnight page
- src/components/LeafletDocument.css:48-54, src/components/PostEmbed.css:70-80: keylines use --rule-soft, which takes on the sky tint

**Verification note (adjusted).** Partly inaccurate, and it overlaps IDN-01. The Photographs gallery images are not cropped: LeafletDocument.css:48-54 uses height:auto with no object-fit. They render at natural aspect, two-up at ~288px each inside the 588px measure (creating-work-photos__desktop__h13__s0.png). The curating mats are letterboxed with object-fit contain, so they are not cropped either; their cyan colour is the IDN-01 surfaceSep issue. What does hold: moth tiles are force-cropped 1:1 (Mothing.css object-fit: cover, aspect-ratio 1/1), which is a defensible convention for a species grid with a lightbox for the full image. There are translateY(-2px) hover lifts (Curating.css:32-35, Mothing.css:120-123). Keylines use the sky-tinted --rule-soft. --doc-overhang is computed (Blogging.css:130) but only RatioedBlock uses it. With the mat colour moved to IDN-01, what remains is polish.

#### TYP-02 · Drop caps never render on blog posts, project write-ups or the About page; only the résumé and Exploring get one

`medium` · `visual` · effort S · verdict *adjusted* · lens: Typography & reading experience · **merges:** IDN-03

**Pages:** /blogging/:slug, /creating/:slug, /creating/ratioed, /themself

**Observation.** The drop cap is described as 'the shared treatment behind every first-paragraph initial letter (blog posts, the resume summary, the about page)', but every long-form page now renders through LeafletDocument. That puts paragraphs one level deeper and under different class names, so the rule only fires on the résumé summary, the Exploring lead and legacy markdown HTML.

**Recommendation.** Add `.leaflet-doc > .leaflet-paragraph:first-child::first-letter` (and `.about-longform .leaflet-doc > .leaflet-paragraph:first-child::first-letter`) to both the initial-letter block and the @supports fallback in typography.css. Use :first-child so a document that opens with a heading or image does not get a cap mid-page. If project write-ups should stay plainer, scope it with `.blog-article .leaflet-doc…`. Add a visual regression check on one blog post so this cannot silently regress again.

**Evidence.**
- blogpost__desktop__h13__s0.png ('In November of 2007' has no initial)
- blogpost__mobile__h13__s0.png
- ratioed__desktop__h13__s0.png ('I began this social art experiment' has no initial)
- creating-work-software__desktop__h13__s0.png ('Aturi is…' has no initial)
- available__desktop__h13__s0.png and exploring__desktop__h13__s0.png (drop caps do render here)
- typography.css:154-157 selectors are .blog-prose > p:first-of-type, .about-longform > p:first-of-type and .dropcap
- BlogPost.jsx:208 and CreatingWork.jsx:133 render &lt;div class="leaflet-doc">&lt;p class="leaflet-paragraph">, which no selector targets
- About.jsx:123-124 wraps LeafletDocument inside .about-longform, so the child combinator > misses the grandchild &lt;p>
- DOM probe: ::first-letter on the first .leaflet-paragraph reports initial-letter: normal

**Verification note (adjusted).** The finding is accurate. typography.css:154-157 targets .dropcap, .blog-prose > p:first-of-type, .blog-prose .first-paragraph and .about-longform > p:first-of-type. BlogPost.jsx:208 and CreatingWork.jsx:133 render LeafletDocument directly, giving &lt;div class=leaflet-doc> plus Fragment-flattened &lt;p class=leaflet-paragraph>, which no selector matches. About.jsx:123 nests it one level too deep for the child combinator. Screenshots confirm there is no initial on blogpost or ratioed, while the résumé 'I' and Exploring 'A' do render. The About case is latent for now because /themself renders empty (record missing). Severity is overstated. This is a silent regression of an explicitly stated design intent, but it causes no task or comprehension harm, and visitors cannot see that something is missing. It belongs at medium as a top quick win, not high. The recommended selector works because LeafletPage returns a Fragment, so blocks are direct children of .leaflet-doc. One caveat: a document that starts with an empty spacer &lt;p class=leaflet-spacer> would defeat :first-child, so use :first-child or a sibling-of-spacer variant.

#### IDN-03 · Blog posts never get the drop cap, and they end without an end-mark  
*Merged into TYP-02.*

`medium` · `visual` · effort S · verdict *adjusted* · lens: Visual identity & aesthetic

**Pages:** /blogging/*, /creating/* (document works)

**Observation.** The drop cap is the design's headline book device for long-form writing. The résumé summary and the Exploring intro have it, but blog posts, the site's longest prose, do not. They now render through LeafletDocument (.leaflet-doc > p.leaflet-paragraph), and the shared rule still targets the retired .blog-prose markup. The essay also has no closing ornament: the last paragraph flows straight into an embedded post, the comments and the footer.

**Recommendation** (carried forward in TYP-02). In LeafletDocument, add className 'first-paragraph' to the first non-empty text block. Then add `.leaflet-doc .first-paragraph::first-letter` to both drop-cap rules (typography.css:154 and the Firefox @supports block at :192). Optionally set the opening line in small caps (`::first-line { font-variant-caps: all-small-caps; letter-spacing: .04em }`). Close every document with a centred accent fleuron (❧ is already used in Creating.jsx:38) and 3rem of space before Comments.

**Evidence.**
- blogpost__desktop__h13__s0.png: 'In November of 2007…' opens flat
- available__desktop__h13__s0.png ('I' drop cap) and exploring__desktop__h13__s0.png ('A' drop cap): the treatment works elsewhere
- blogpost__desktop__h13__bottom.png: the article runs straight into the comment thread and footer
- src/styles/typography.css:154-158 and :192: drop-cap selectors only cover .dropcap, .blog-prose > p:first-of-type, .blog-prose .first-paragraph, .about-longform
- src/pages/BlogPost.jsx: StandardPostBody renders &lt;LeafletDocument>; src/components/LeafletDocument.jsx:281 emits p.leaflet-paragraph inside .leaflet-doc, which no drop-cap selector matches
- src/components/LeafletDocument.jsx:278: spacers are also &lt;p>, so :first-of-type is unreliable

**Verification note (adjusted).** The drop cap claim is correct. BlogPost.jsx:208 renders &lt;LeafletDocument>, and LeafletDocument.jsx:281 emits p.leaflet-paragraph. None of the selectors at typography.css:154-158/:192 (.dropcap, .blog-prose > p:first-of-type, .blog-prose .first-paragraph, .about-longform) match it, while Blogging.css:368 still says the drop cap applies. blogpost-h18 shows 'In November of 2007' opening flat, and available__desktop__h13__s0.png shows the working 'I' drop cap. This is a real regression against the stated brief. Readers can still read the essays normally, though, and the missing end-mark is a new enhancement rather than a defect. That fits medium (a noticeable inconsistency on an important page), not high.

#### TYP-03 · Long-form lines run ~85 characters (up to 98) at 16.8px because --measure is in ch of a wide-zero font

`medium` · `ux` · effort S · verdict *adjusted* · lens: Typography & reading experience

**Pages:** /blogging/:slug, /creating/:slug, /creating/ratioed, /available, page intros on index pages

**Observation.** On desktop and tablet, long-form body text is 16.8px Crimson in a 588px column, which holds about 82–90 characters per line (median about 85). Page intros at 18px wrap at about 88–91. Mobile is about 45 characters per line and is not affected.

**Recommendation.** Keep the ~588–600px column and raise long-form body text to 1.25rem (20px) on desktop and tablet and 1.125rem (18px) on mobile, with line-height 1.55. Express the measure in em, not ch (e.g. --measure-prose: 30em ≈ 70–72 characters for Crimson), and use it for .leaflet-doc, .blog-prose, .page-intro and the résumé summary. Update the stale comment.

**Evidence.**
- blogpost__desktop__h13__s0.png and __s1.png
- state-tablet-blogpost__desktop__h13.png (same 588px column, same long lines at 820px)
- rhythm probe on .leaflet-doc: 16.8px/26.88px, column 588px, median 85 characters per full line, max 98, across 45 lines
- theme.css:83 --measure: 65ch; Crimson Pro '0' measures 0.565em but the average character is 0.41em, so 65ch ≈ 90 characters
- LeafletDocument.css:3 font-size: 1.05rem (16.8px) on desktop and mobile
- listening__desktop__h13__s0.png: the 18px intro wraps at about 91 characters
- typography.css:24-30 comment says '--measure is 68ch' (stale vs 65ch)

**Verification note (adjusted).** The measurements check out. LeafletDocument.css:3 sets 1.05rem (16.8px). --measure is 65ch (theme.css:83), and the typography.css comment still says 68ch, so it is stale. Counting lines in blogpost__desktop__h13__s0/s1 gives 82–90 characters ('Social media was a digital location for the expression of your state of being. After all,' is 90). The listening and welcoming intros wrap at about 88–91. More than 75 characters per line at a small-x-height size is real reading friction on the long-form pages. However, the post remains comfortably readable, with 1.6 leading and a 588px column, and mobile is about 45 characters per line and fine. That is noticeable friction on an important page, not harm to the primary task, so medium. The recommendation (a larger body size and a measure expressed in em) is on-brand.

#### TYP-04 · Paragraph rhythm mixes two signals: a 16px gap after each run's first paragraph, then indent-only; credit lines and examples are indented like body text

`medium` · `visual` · effort S · verdict *confirmed* · lens: Typography & reading experience

**Pages:** /blogging/:slug, /creating/:slug, /creating/ratioed

**Observation.** Within every run of paragraphs, the first paragraph keeps margin-bottom: 16px and the later ones get indent and zero margin. The break between paragraphs 1 and 2 is therefore signalled twice (space plus indent) and every later break once. Single-line italic examples ('Dame is sad') and the quoted source passage are indented like running prose, so they read as stray body lines. A leading '\n' in a text block becomes a blank line, which detaches image credits from their figures.

**Recommendation.** Make indent-only the default: `.leaflet-paragraph { margin: 0 }` and `+ .leaflet-paragraph { text-indent: 1.5em }`, with vertical space only from figures, headings, lists and spacers. Trim leading and trailing newlines in TextBlock so credits sit directly under their caption. Do not auto-detect italic paragraphs as asides. Use the existing per-block `indent: false` and `spaceTop`/`spaceBottom` controls for example lines and credits, and optionally add an explicit 'aside/inset' layout hint in the same extension family (inset 1.5em, no indent, accent-soft left hairline), so the author decides what is a quotation.

**Evidence.**
- blogpost__desktop__h13__s0.png (gap plus indent between paragraphs 1 and 2, then no gap; the 'Dame is watching a movie' example lines are each indented)
- blogpost__desktop__h13__s1.png (caption, then about a 75px hole, then an unindented 'image source: tech crunch', then a gap, then an indented 'Back then…')
- extra/typography/headings-h2h3-desktop.png (gap plus indent after the first post-heading paragraph)
- rhythm probe: gaps run 16, 0, 0, 0… after every heading or figure; the one-line 'image source' paragraph is 54px tall
- LeafletDocument.css:11-18 (.leaflet-paragraph margin-bottom 16px; + sibling indent 1.5em and margin 0)
- typography.css:36-49 (same pattern for all p)
- outerHTML: &lt;p class="leaflet-paragraph">&lt;br>&lt;em>image source: …&lt;/em> (a leading newline in the record renders as &lt;br>)
- LeafletDocument.jsx TextBlock passes plaintext to renderLeafletText without trimming

#### TYP-07 · Rendered documents use typewriter punctuation (straight quotes, '...', ' - '), including in 48px titles

`medium` · `content` · effort M · verdict *confirmed* · lens: Typography & reading experience

**Pages:** /blogging, /blogging/:slug, /creating/:slug

**Observation.** The records are authored in different editors, so punctuation varies between documents and sometimes within one. The renderer outputs it verbatim, so the biggest type on the page ('it's' in the 48px H1) shows a straight tick and quoted terms in body text use inch marks.

**Recommendation.** Add a display-only typesetting pass (smartypants-style: quotes and apostrophes, '...' → '…', ' - ' and '--' → ' — ', digit-hyphen-digit → en dash) applied to each rendered text segment after facet byte-slicing, so facet offsets are never disturbed. Skip code facets, URLs, handles and at-URIs. Apply the same pass to titles (page-title, ToC rows). X-ray mode keeps showing the raw record, which fits the AT-Protocol transparency theme: the page is the typeset view and the inspector is the manuscript.

**Evidence.**
- blogpost__desktop__h13__s0.png (H1 "like it's", body '"post"', '"is"', '"status updates".')
- blogpost__mobile__h13__s1.png ('"To be or not to be..."')
- creating-work-software__desktop__h13__s0.png ("It's", "aren't", "account's")
- extra/typography/headings-h4-desktop.png
- PDS listRecords site.standard.document: 765 straight vs 199 curly quote marks across 26 docs; 15 docs mostly straight; 'Proof of (No) Work' mixes 31 straight and 16 curly; 33 '...' vs 12 '…'; 35 spaced hyphens ' - ' vs 8 em dashes
- LeafletDocument.jsx TextBlock → renderLeafletText(text, facets) applies no typographic normalisation

#### TYP-08 · Document heading ladder is compressed: h3 is 18px over 16.8px body, and h4–h6 fall back to body size via the undefined --text-md

`medium` · `visual` · effort S · verdict *confirmed* · lens: Typography & reading experience

**Pages:** /creating/how-to-use-bluesky-to-grow-your-brand, /blogging/:slug, /creating/:slug

**Observation.** Inside documents, headings differ from body almost only by weight. h3 is 1.07× body, and h4 and h5 are identical to each other and to body size. Header level 1 renders a second &lt;h1>.

**Recommendation.** Define --text-md, or remove it, and differentiate levels by style as well as size, as a book would: h2 1.5rem/600 with 2.5em space above; h3 1.25rem italic 500; h4 body size 600 in --accent as a run-in-friendly numbered point; h5/h6 body-size italic. Map leaflet level 1 to h2 (the page owns the h1) and shift the other levels down so the outline stays valid.

**Evidence.**
- extra/typography/headings-h2h3-desktop.png (h3 'Backstory' 18px is barely distinguishable from body)
- extra/typography/headings-h4-desktop.png (h4 '1. Custom feeds (algorithms)' computed 16.8px, the same as body)
- LeafletDocument.css:31-42: h1 --text-2xl 28px, h2 22px, h3 18px, h4-h6 var(--text-md), which is undefined in theme.css so it inherits 16.8px
- PDS: 173 header blocks; 'How to use Bluesky…' uses 40 h4 and 6 h5; leaflet level-1 headings render a second &lt;h1> under the 48px page title

**Prior review:** RECOMMENDATIONS §9.1 — still open

#### GAP-08 · Only the résumé prints well: an essay printed after dark comes out grey, with relative dates and no attribution

`low` · `functional` · effort S · verdict *confirmed* · lens: Gap pass (cross-lens)

**Pages:** /blogging/:slug, /creating/:slug, /mothing/:night, all non-résumé pages

**Observation.** Print support stops at the résumé. Every other page prints the live sky tokens on white paper, so at night hours the ink is pale. Relative dates go onto paper, where they will soon be wrong, and the printed essay has no site name, URL or record reference.

**Recommendation.** Move the .resume print token block to :root inside @media print, keeping the résumé's compact type scale scoped to .resume. In print, show absolute dates and hide ELAPSED, swap replies and video players for a one-line 'n replies on Bluesky', and add a printed colophon with the canonical URL, at:// URI and print date. Offer the print chip on long-form pages too.

**Evidence.**
- extra/gaps/print-compare.png: left is the blog post printed at 9 pm ET, grey title and body; middle is the same post at 1 pm, black; right is the résumé, black with the name 'Dame'
- extra/gaps/print-blogpost-h21.png: CSS hands print a --ink of rgb(226,223,231), which Chromium darkens to about #908e93, roughly 3.2:1 on white
- src/pages/Resume.css:350-420: the black-ink token remap is scoped to .resume; src/components/ChromeBar.css:985-991 hides the bars on every page
- pdftotext of gap/pdf/blogpost-h13.pdf: prints 'Elapsed 2 years ago', replies '1y ago', a '0:00' video stub, and no URL or byline on the page; the print chip exists only on /available (ChromeBar.jsx:842)

**Prior review:** RECOMMENDATIONS §12 (Print styles only on the resume) — still open

#### IDN-12 · Ornament and texture are almost absent, and the one placeholder ornament competes with an emoji butterfly

`low` · `visual` · effort S · verdict *confirmed* · lens: Visual identity & aesthetic

**Pages:** /blogging/*, /mothing/*, /creating, /

**Observation.** Apart from hairlines, drop caps and the hero rules, the site carries no ornament: no section breaks between days, no end-marks, no colophon device. A lovely fleuron exists, but only as one empty-image placeholder on /creating, while the mothing grid uses a butterfly emoji for a missing moth: the wrong insect and an emoji in a serif book. The grain that gives the hourly avatars their atmosphere never reaches the site's surfaces.

**Recommendation.** Adopt one ornament family. Use ❧, or a custom-drawn moth-wing fleuron, in accent for blog end-marks, day dividers on long ledger scrolls, every empty-image placeholder (replace 🦋) and the 404 page. Consider bringing back the ruled texture only under long-form leaflet paragraphs at about 4% ink, and adding the avatar's grain at 2–3% to the chrome bars so the chrome feels like sky rather than flat UI.

**Evidence.**
- All CSS generated content is bullets, middots and disclosure triangles; there are no section or end marks (grep of content: in src/**/*.css)
- src/hooks/usePaper.jsx:12: PAPER_ENABLED = false (the ruled/dot paper texture is paused); the hero's ruled lines are the only texture left
- src/pages/Creating.jsx:38: ❧ fleuron placeholder (visible in extra/identity/creating-cards-h13.png, 'CodeTV Appearance')
- src/components/MothTile.jsx:58: 🦋 emoji placeholder for a missing moth photo
- extra/identity/sky-avatars-source.png: the avatar's film grain does not appear anywhere on the site

#### TYP-13 · No text-wrap balancing or pretty-wrapping, so headings and paragraphs end in one-word lines

`low` · `visual` · effort S · verdict *confirmed* · lens: Typography & reading experience

**Pages:** /blogging, /blogging/:slug, /creating/:slug, /creating/ratioed

**Observation.** Runts (single short words on the last line) appear in most long-form paragraphs at desktop width, and multi-line ToC titles break unevenly on mobile.

**Recommendation.** Add `text-wrap: balance` to h1–h3, .page-title, .page-intro and ToC titles, and `text-wrap: pretty` to .leaflet-paragraph, .blog-prose p, .ledger-text and comment bodies. Optionally enable `hyphens: auto` (with lang='en', already set) for mobile prose only, with hyphenate-limit-chars: 6 3 3.

**Evidence.**
- blogpost__desktop__h13__s0.png (paragraph 1 ends with 'change?' alone)
- ratioed__desktop__h13__s1.png ('world.' alone)
- creating-work-software__desktop__h13__s0.png ('server.' alone)
- blogpost__desktop__h13__s2.png ('a record of them.')
- blogging__mobile__h13__s0.png (title wraps to leave 'PDS' alone; 'Bluesky profile' widow)
- grep: no text-wrap, hyphens or hanging-punctuation declarations in any public CSS (only reset.css:23 text-rendering)

### Theme 5 — Collections hide their own pictures

#### COL-01 · Visual collections default to a text-only ledger; their image and TOC views are hidden behind a global toggle inside the nav menu

`high` · `ux` · effort M · verdict *confirmed* · lens: Collection, gallery & detail pages · **merges:** IDN-04

**Pages:** /creating, /curating, /blogging, /mothing

**Observation.** /creating, /curating, /blogging and /mothing each have a purpose-built visual presentation: cover masonry for works and galleries, a numbered table of contents with summaries and full dates for the blog, and specimen tiles for moths. All four read one site-wide 'feed layout' preference whose default is 'ledger', so a first-time visitor sees a portfolio and an image collection as plain text lists. Switching requires opening the compass menu, noticing two unlabeled glyphs at bottom-left, and knowing that the 'Home feed layout' control also re-skins every section.

**Recommendation.** As proposed: per-section defaults (plates on /creating and /curating, the numbered TOC on /blogging, nights on /mothing) and a visible small-caps 'plates · index' switch by the heading, remembered per section. Leave the home feed's global preference alone. On /curating, show the description and updated date, and say 'items' (or 'images' only when the channel is all images) instead of are.na's 'blocks'.

**Evidence.**
- creating__desktop__h13__s0.png and creating__mobile__h13__s0.png: portfolio of 21 works rendered as kind | title | '1y ago' text rows, no imagery
- curating__desktop__h13__s0.png: 'Galleries of images I've been collecting.' rendered as 18 text rows + 'N blocks'
- extra/collections/cards-creating__desktop.png, cards-curating__desktop.png, cards-blogging__desktop.png: the same pages with dame.feedLayout=cards show cover masonry and a numbered TOC that already exist
- available__desktop__h13__s1.png: /available's 'Selected work' shows cover thumbnails for the same works, so covers exist in the records
- state-nav-open__desktop__h13.png: the only layout control is two unlabeled icons bottom-left, visible only while the compass menu is open
- src/hooks/useFeedLayout.jsx:6 (DEFAULT = 'ledger', one key shared by every section)
- src/components/ChromeBar.jsx:673-682 (LayoutToggle rendered only when dockOpen)
- src/components/LayoutToggle.jsx:23 (aria-label 'Home feed layout' though it changes every section)
- src/pages/Creating.jsx:101-102, Curating.jsx:85-86, Blogging.jsx:49-50, Mothing.jsx:120-121 (each page branches on the global layout)
- src/pages/Curating.jsx:61-66 (gallery description and updatedAt are loaded but the ledger row shows only title + count, Curating.jsx:121-133)

#### IDN-04 · The default 'ledger' layout flattens every section into the same text list, and the imagery and book contents pages are hidden behind a toggle  
*Merged into COL-01.*

`medium` · `ux` · effort M · verdict *adjusted* · lens: Visual identity & aesthetic

**Pages:** /blogging, /creating, /curating

**Observation.** The global 'ledger' default, a deliberate owner choice (useFeedLayout.jsx:6 and its comment), makes /blogging, /creating and /curating identical title-and-meta lists. The richer forms that already exist (numbered contents with summaries and full dates, image masonry) are reachable only through a layout toggle that appears only inside the open compass dock. /curating describes 'Galleries of images' and shows none.

**Recommendation** (carried forward in COL-01). Keep the ledger for the home stream and logs. Give each section its native form by default: /blogging as a numbered contents page with dot leaders to a full date folio; /creating as a catalogue (small 4:3 plate in the left column, title, category in small caps, year as folio); /curating as contact-sheet rows (channel title, a strip of six thumbnails, block count as folio). Make the toggle per section ('book' / 'ledger') rather than global.

**Evidence.**
- blogging__desktop__h13__s0.png, creating__desktop__h13__s0.png, curating__desktop__h13__s0.png: three structurally identical lists (title left, small accent meta right)
- extra/identity/blogging-cards-h13.png: the numbered table of contents (01, 02…, summary, 'July 16, 2026' + '3mo ago') exists only in 'cards'
- extra/identity/curating-cards-h13.png, extra/identity/creating-cards-h13.png: image-led masonry only in 'cards'
- src/hooks/useFeedLayout.jsx: DEFAULT = 'ledger', one global key 'dame.feedLayout'
- src/pages/Blogging.jsx:74-86 (FlatLedger: title + relative time) vs :87-110 (TOC with number, summary, full date)

**Verification note (adjusted).** The observation is accurate. blogging/curating/creating at h13 render near-identical FlatLedger lists. The numbered contents page with summaries and full dates (Blogging.jsx:87-110) and the image masonry exist only in 'cards'. The LayoutToggle shows only while the compass dock is open (ChromeBar.jsx:672-684), so few visitors will find it. However, ledger-by-default is a deliberate recent owner decision: useFeedLayout.jsx refers to 'the brief cards-by-default era' and persists only explicit picks so a future default change reaches everyone. The pages work and read cleanly, so high overstates it. It is a missed opportunity for identity on important index pages, which is medium. The per-section 'native form' recommendation (contents page, catalogue, contact sheet) is on-brand and does not simply revert to cards.

#### COL-03 · /mothing renders all 519 observations as 40px-thumbnail rows; the night galleries are hidden behind an unmarked heading

`medium` · `ux` · effort L · verdict *adjusted* · lens: Collection, gallery & detail pages

**Pages:** /mothing, /mothing/:night

**Observation.** /mothing lists all 29 nights and 519 observations on one 32,683px page. Each moth is a 40px thumbnail in a 980px row; tapping a row opens it in the lightbox. The link to each night's gallery page is the 'Night of …' heading, which has no underline at rest (hover-only), so phones show no link cue. 'Most seen' is a run-in sentence, and one name breaks across lines ('Green / Cutworm Moth').

**Recommendation.** Make /mothing an almanac of nights rather than a dump of observations. Header tallies (29 nights · 519 moths · 217 species). 'Most seen' becomes six specimen plates. Then one entry per night: folio date and session number, counts, time span, and a filmstrip of 6–8 square thumbnails (72–96px) with a '+7' plate, the whole entry linking to the night page with an explicit 'see the night →'. Group nights under month or season small-caps headers and collapse older seasons. Keep the full observation ledger as the 'index' alternative (COL-01). Give .mothing-night-link a resting underline in --accent-soft.

**Evidence.**
- mothing__desktop__h13__s0.png, s1, s2: 40px thumbnails beside names and times. A moth is a speck inside a 40px square
- metrics-summary.txt: mothing 32,683px tall on desktop, 33,006px on mobile, 562 interactive elements (every observation, every night, in one page)
- mothing__desktop__h13__s0.png: 'Most seen' run-in sentence wraps mid-name ('Green / Cutworm Moth', 'Grape / Leaffolder')
- src/pages/Mothing.css:213-216 (.mothing-ledger-thumb 2.5rem)
- src/pages/Mothing.css:272-284 (.mothing-night-link has no underline; the affordance is hover-only, so none on touch)
- src/pages/Mothing.jsx:198-210 (Most seen as inline text), 219-262 (all sessions × all observations rendered)
- mothing-night__desktop__h13__s0.png: the night page is the good gallery the index never previews

**Verification note (adjusted).** Mostly accurate. mothing__desktop__h13__s0/s1 show 40px thumbnails, the page is 32,683px with all 29 nights inline, and .mothing-night-link has no resting underline, only a hover one (Mothing.css:272-284), so there is no cue on touch. Two parts are overstated. 'Visitors can't see the moths' is wrong: every row with a photo is a button that opens the lightbox (Mothing.jsx:98-107, onClick={() => onOpen(obs)}). Only one 'Most seen' name breaks across lines ('Green / Cutworm Moth'); 'Grape Leaffolder and Leafroller Moths' stays on one line. The finding also overlaps COL-01, which covers the ledger default and the hidden specimen-tile view. What is left (no per-night summary, a hidden path to the night galleries, everything on one page) is real but sits on a secondary page, so medium.

#### LAY-03 · Three auto-fill grids fall to one column on phones by 6px (82,547px curating page)

`medium` · `functional` · effort S · verdict *adjusted* · lens: Layout, grid, spacing & responsive behaviour · **merges:** COL-02

**Pages:** /curating/:channel, /mothing/:night, /exploring

**Observation.** On a 358px phone column, .curating-block-grid and .exploring-home-stats (11rem tracks plus a 12px gap, 364px needed) each miss two columns by 6px. .mothing-grid (12rem plus a 16px gap, 400px needed) misses by 42px. Result: the 222-block curating channel is 82,547px tall (9,478px on desktop), with each image contained in a 358px square with cyan letterbox bands. The five exploring stats take about 550px. Mothing-night shows its 15 moths one per screen. /listening/albums stays 2-up through its 7.5rem override.

**Recommendation.** Use minmax(min(10rem,100%),1fr) for the curating and exploring grids. For mothing, either use the same rule or keep one-up as a deliberate 'specimen plate' choice. Switching to object-fit: cover is optional. A tighter cell pad (or none) keeps uncropped curated images while shrinking the letterbox.

**Evidence.**
- curating-channel__mobile__h13__s0.png, curating-channel__mobile__h13__s1.png: one 358px square per image, landscape images letterboxed in bright cyan
- metrics: curating-channel mobile height 82,547px vs 9,478px desktop; mothing-night mobile 7,255px vs 2,073px; exploring mobile 10,168px
- extra/layout/lay-measure.json channel:mobile:grid cols '358px'
- Curating.css:10-17 minmax(11rem,1fr) + 0.75rem gap needs 2×176+12=364px > 358px
- Mothing.css:88-95 minmax(12rem) + 1rem gap; ExploringHome.css:48-53 minmax(11rem) → exploring__mobile__h13__s1.png shows 5 full-width stat boxes ≈550px tall
- extra/layout/proto-mobile-channel-2col.png with minmax(min(10rem,100%),1fr): cols '173px 173px', height 82,547 → 20,942px (−75%); proto-mobile-mothing-night-2col.png 7,255 → 2,785px

**Verification note (adjusted).** Confirmed for curating: Curating.css:10-17 is minmax(11rem,1fr) with a 0.75rem gap, which needs 364px against a 358px column. channel:mobile:grid cols '358px'. The page is 82,547px tall. curating-channel__mobile__h13__s1 shows one letterboxed image per screen. ExploringHome.css:48-53 (auto-fit, 11rem) misses by the same 6px, and exploring__mobile__h13__s1 shows five stacked boxes. Mothing.css:88-95 is minmax(12rem) with a 1rem gap, which needs 400px, so it misses by 42px, not 6. The title's '3 grids by 6px' is inaccurate. One-up for the 15 mothing-night specimen photos is also defensible for ID detail. A one-up gallery is friction on a secondary page, not breakage, so medium rather than high.

#### COL-02 · Every image grid collapses to one column on phones, producing 80k–230k px scrolls  
*Merged into LAY-03.*

`medium` · `visual` · effort S · verdict *adjusted* · lens: Collection, gallery & detail pages

**Pages:** /curating/:channel, /mothing/:night, /mothing (cards), /exploring

**Observation.** Three grids collapse to one column at 390px because their minimum track is wider than half the 358px content box: the are.na channel grid (minmax(11rem)), moth night and cards tiles (minmax(12rem)) and the /exploring stat cards (minmax(11rem)). A 222-image channel becomes an 82,547px scroll and a 15-moth night about 7,255px. The album shelf (minmax(9rem)) already goes 2-up on phones, so the site has the right pattern in one place. At day hours the channel tiles also sit on a light-cyan --page-edge mat (#b7f1fa at h13) that frames every photo. At night it blends into the page.

**Recommendation** (carried forward in LAY-03). Use phone-aware tracks, following the album shelf: minmax(min(7rem, 30%), 1fr) for are.na channels (a 3-up contact sheet) and minmax(min(10rem, 46%), 1fr) for moth plates (2-up with captions). Tighten gaps below 34rem. Cropping to object-fit: cover squares on phones is fine because the lightbox shows the full image. Turn /exploring stats into a 2-column hairline tally.

**Evidence.**
- curating-channel__mobile__h13__s0.png: one 358px square tile per row. Page height 82,547px on mobile vs 9,478px on desktop (metrics-summary.txt)
- mothing-night__mobile__h13__s1.png: 15 moths stacked 1-up, 7,255px tall vs 2,073px on desktop
- extra/collections cards-mothing mobile: scrollHeight 233,063px (col-extra.cjs output)
- exploring__mobile__h13__s1.png: five repo stats stacked as full-width boxes (~1,100px)
- Measured at 390px: .curating-block-grid computed gridTemplateColumns = '358px' (col-tokens.cjs)
- src/pages/Curating.css:12 repeat(auto-fill, minmax(11rem, 1fr))
- src/pages/Mothing.css:90 repeat(auto-fill, minmax(12rem, 1fr))
- src/components/ExploringHome.css:50 repeat(auto-fit, minmax(11rem, 1fr))
- Daytime mat: Curating.css:28 background var(--page-edge) = #b7f1fa against page #f0fcfe at h13, but #131313 vs #181919 at h00 (col-tokens.cjs). The cyan frame is loud only in daylight (curating-channel__desktop__h13__s0.png)

**Verification note (adjusted).** The core claim holds. curating-channel__mobile__h13__s0.png shows one 358px tile per row, metrics give 82,547px mobile vs 9,478px desktop, mothing-night mobile is 7,255px vs 2,073px, and the CSS lines are correct (Curating.css:12, Mothing.css:90, ExploringHome.css:50, Curating.css:28 page-edge mat). The title and summary overstate it, though. 'Every image grid' is wrong: the album shelf uses minmax(9rem) and is already 2-up on phones (extra/collections/albums-wait__mobile.png), which shows the fix is a token change. The /exploring stat stack is about 535 CSS px, not ~1,100 (that figure is device pixels in a 2x capture). A single column is slow to scan but not broken, and every tile opens the lightbox, so medium fits better than high.

#### COL-10 · Album shelf truncates most titles because the play count shares the title line

`low` · `visual` · effort S · verdict *confirmed* · lens: Collection, gallery & detail pages

**Pages:** /listening/albums

**Observation.** Each ~150px tile puts rank, title and the play count '6×' on one line with nowrap, so most album titles are cut to 10–12 characters. The artist line is also ellipsized ('Gezebelle Gabur…').

**Recommendation.** Move rank and count to their own metadata line ('No. 49 · 6 plays · 3 mo') and allow a 2-line clamp on the title. Consider 5-up on desktop (minmax(10.5rem, 1fr)) for a little more caption width.

**Evidence.**
- extra/collections/albums-wait__desktop.png: 9 of 12 visible titles truncated ('The Art of Lovi…', 'Music to Refin…', 'Remember Th…', 'SOS Deluxe: L…', 'Twin Temple (…', 'The New Abno…', 'Preacher's Da…', 'This Is The Wo…', 'Let's Hope Het…')
- albums__desktop__h13__s0.png ('Music, Fashio…', 'Age of the Exh…'); extra/collections/albums-wait__mobile.png ('Music, Fashion, Fi…', 'Everybody Screa…')
- src/pages/Albums.css:93 (minmax(9rem, 1fr), 6-up at 980px), Albums.css:163-170 (.album-cell-title white-space: nowrap; text-overflow: ellipsis)

#### COL-13 · /creating/ratioed is a 13.6k px scroll whose section headings don't align with the figures they title

`low` · `visual` · effort M · verdict *adjusted* · lens: Collection, gallery & detail pages

**Pages:** /creating/ratioed

**Observation.** /creating/ratioed is a 13.6k px data essay with no in-page contents. Every section heading ('Stats', 'When things happened', 'Reactions no one can see', …) stays on the 588px measure at x=426, while the figures they introduce break out to the 980px frame at x≈230. Each title therefore floats about 200px right of its figure's left edge. The opening example is a quote-post chain three levels deep. On mobile a single 'Backlinks' bullet sits alone under Materials.

**Recommendation.** Align a breakout figure's heading with the figure's left edge, with a small-caps section number. Add a compact contents row after the intro (or a margin index at ≥1200px). Consider showing one take in the opening example rather than the three-deep chain. No relabelling of the stats grid is needed.

**Evidence.**
- Heading map (col-extra2.cjs): 9 h1/h2 sections from 'Materials' (y 1583) to 'Participants' (y 10784); page height 13,588px desktop, 14,910px mobile
- extra/collections/ratioed-y4100__desktop.png: 'When things happened' and 'Reactions no one can see' headings sit at x≈426 (588 measure) while the chart and stats table they introduce start at x≈230–287 (980 width)
- Same screenshot: the stats table's header row (PIECES / TOTAL TIME ALIVE / PEOPLE INVOLVED / RATIO) sits over cells that answer different questions ('5m44s average duration', '32s typical first touch')
- ratioed__mobile__h13__s2.png: a stray single bullet 'Backlinks' sits alone between Materials and Timelines
- ratioed__desktop__h13__s0/s1.png: the hero is a quote-post nested three deep, with progressively darker fills, before the reader learns what the piece is

**Verification note (adjusted).** Two parts are wrong. The stats-table claim misreads a cropped screenshot: an extra capture (extra/verify-collections/ratioed-stats.png) shows the uppercase labels sit under their values ('41 PIECES', '462min TOTAL TIME ALIVE', '511 PEOPLE INVOLVED', '679:30 RATIO'), and the second row follows the same value-over-label pattern, so the labels match their cells. The hero claim is overstated: the intro paragraph ('I began this social art experiment… use a social media post as a medium for art') comes before the nested quote chain (ratioed__desktop__h13__s0.png), although three nested quote boxes in progressively darker fills are real. Confirmed: a DOM probe shows all 8 h2s (Materials … Participants) at x=426 while the breakout figures and the stats grid start at x=230/287. The page is 13,588px tall, and on mobile a lone 'Backlinks' bullet sits between sections.

#### INT-14 · Lightbox lacks swipe, caption and provenance, and uses the system's only soft shadow

`low` · `ux` · effort M · verdict *adjusted* · lens: Interaction, motion, feedback & states

**Pages:** /curating/*, /creating/* photos, feed images

**Observation.** The lightbox steps through 222 images by buttons or arrow keys only, with no swipe on touch. It shows no visible title, source, date or record link. Its frame uses a 40 px soft shadow, one of a few soft shadows in an otherwise hairline system (Modal.css also uses one).

**Recommendation.** Add horizontal drag/swipe (motion drag='x' with a threshold, disabled under reduced motion) and a caption line in the controls bar: block title in italic serif, 'from are.na · saved Oct 12', and a mono 'record ↗' link (or the x-ray tag when inspect is on). Replace the shadow with a 1 px --rule hairline frame, like a tipped-in plate.

**Evidence.**
- state-lightbox__desktop__h13.png, state-lightbox__mobile__h13.png (only 'reverse image search', '3 / 222' and arrows; no title, channel, date or record)
- src/components/Lightbox.jsx (no touch or drag handlers; the counter is aria-hidden)
- src/components/Lightbox.css:69 (box-shadow: 0 16px 40px var(--shadow))

**Verification note (adjusted).** Swipe is missing: Lightbox.jsx has no touch or drag handlers. Visible provenance is missing: only 'reverse image search' and '3 / 222' show, and the alt goes only into the aria label. Lightbox.css:69 does use box-shadow 0 16px 40px. But 'the system's only soft drop shadow' is false: Modal.css:83-85 has '0 1px 2px, 0 18px 48px var(--shadow)', and theme.css:239-241 applies sky glow shadows to the avatar and CTAs. The hairline-frame suggestion is still reasonable as consistency polish.

### Theme 6 — Records are landing pages, but read like debug output

#### NAV-01 · Section crumb (and Back fallback) on record pages leads to a 404 for 10 of 17 feed verbs

`high` · `functional` · effort S · verdict *confirmed* · lens: Navigation, wayfinding & information architecture

**Pages:** /reposting/:rkey, /liking/:rkey, /following/:rkey, /observing/:rkey, /photographing/:rkey, /feeding/:rkey, /listing/:rkey, /commenting/:rkey, /crafting/:rkey, /flushing/:rkey

**Observation.** buildCrumbs links each path segment to the cumulative path. Verbs with their own page (blogging, logging, listening…) get a working parent crumb. Verbs that exist only as /{verb}/:rkey record routes get a crumb pointing at /{verb}, and that index route doesn't exist. Every repost, like, follow, iNaturalist observation, photo, feed, list, comment and crafting record therefore shows a section crumb that opens "Nowhere to be found", and the flush crumb sends the visitor to flushes.app. The bottom-bar Back button uses the same parentPath when there is no in-app history (a link opened in a new tab), so Back lands on the 404 too.

**Recommendation.** Resolve the parent crumb through the verb registry instead of the raw path. If the verb has an index page, link there. If not, link to the home ledger pre-filtered to that verb (/?verbs=reposting, a URL shape FeedFilters.jsx:52 already supports), or render the crumb as plain text. Never link a crumb to an external redirect. Use the same resolved parent for goBack's fallback. Optionally add thin generated index routes (/reposting, /liking…) that render the filtered ledger with the gerund as H1 ("Reposting"), so every gerund in the URL grammar is a real place.

**Evidence.**
- record-reposting__desktop__h13__s0.png (crumb "/ reposting / 3myuh64psn623")
- extra/nav/reposting-crumb-click__desktop.png (clicking "reposting" crumb → "Nowhere to be found")
- probe: /reposting, /liking, /following, /observing, /photographing, /feeding, /listing, /commenting, /crafting all HTTP 404; /flushing 308 → flushes.app
- src/components/ChromeBar.jsx:1083-1096 (buildCrumbs turns every raw path segment into a link)
- src/components/ChromeBar.jsx:610-618 (goBack falls back to the same parent crumb on fresh loads)
- src/App.jsx:89-108 (generatedRecordRoutes creates /{verb}/:rkey only, with no index route)
- vercel.json:70 (/flushing redirects off-site)

#### COL-05 · Record pages (the landing spot for every feed row) are sparse, dev-forward and width-unstable

`medium` · `ux` · effort M · verdict *confirmed* · lens: Collection, gallery & detail pages · **merges:** NAV-06

**Pages:** /logging/:rkey, /listening/:rkey, /posting/:rkey, /reposting/:rkey

**Observation.** Every home-ledger row links to one of these pages, but the record page gives the record little presence. A logged status, the site's signature 'dame is …' sentence, is set as a small line next to a teal 'dame.is'. The most prominent element is a highlighted at:// string. The page width changes with content length (484px vs 588px). Two button styles stack. An empty replies section takes the lower half. There is no way to step to the previous or next record in the collection.

**Recommendation.** As proposed: set the record's sentence large, add one colophon line, one row of actions, prev/next within the collection, the at:// URI as a quiet mono folio with &lt;wbr> after each '/', and width:100% on .record-page. Collapse an empty replies section to one line ('no replies yet · reply on Bluesky') instead of dropping it on reposts, because there it reflects the reposted post's thread.

**Evidence.**
- record-logging__desktop__h13__s0.png: the status 'playing tennis' at body size, then a highlighted at:// URI wrapping mid-token ('…/3mysojzqy3z' / '23'). The column is 484px (x 478–962)
- record-posting__desktop__h13__s0.png: the same template at 588px (x 426–1014). Width follows content because .record-page lacks width:100% (src/pages/Blogging.css:399-402), the exact shrink-to-fit bug the .blog-article comment in the same file warns about
- record-listening__desktop__h13__s0.png / s1: two differently-sized button rows ('Open in Apple Music / Search on Spotify' vs small 'Open in… / Inspect Data')
- record-reposting__desktop__h13__s1.png and record-posting s1: 'REPLIES' heading + 'No replies yet.' with ~150px of blank space, shown even on a repost of someone else's post
- record-logging__mobile__h13__s0.png: about 60% of the screen empty below the URI. Breadcrumb ends in the TID '3mysojzqy3z23'
- src/pages/Record.jsx:253-292 (no title for short-form, AturiActions + Comments + raw URI always rendered)

#### NAV-06 · Record pages open without a human heading; the crumb ends in a raw rkey or a duplicate slug  
*Merged into COL-05.*

`medium` · `ux` · effort M · verdict *confirmed* · lens: Navigation, wayfinding & information architecture

**Pages:** /posting/:rkey, /listening/:rkey, /logging/:rkey, /reposting/:rkey, /blogging/:slug

**Observation.** The record pages most often shared, Bluesky posts and plays, have no H1 and no sentence saying whose activity this is or what it is. The trail ends in a TID like "3myujs5nl522g" that means nothing to a person. Blog and work pages have the opposite problem: the last crumb is the full slug, repeating the H1 just below it in hyphenated form, and on mobile it pushes the NSID onto its own line.

**Recommendation** (carried forward in COL-05). Give every record page a gerund sentence as its H1, in the hero's two-tone style: "dame was posting · Oct 27, 3:17 pm", "dame was listening to Killing Time by Magdalena Bay", "dame reposted @poe.atpota.to". The verb registry already has pastTense labels (verbRegistry.js:45). Make the last crumb a short human label (a date and time for posts and plays, the title truncated to ~28ch for documents), keep the rkey in x-ray and the NSID slot, and update document.title the same way.

**Evidence.**
- record-posting__mobile__h13__s0.png, record-posting__desktop__h13__s0.png (crumb "/ posting / 3myujs5nl522g", page starts with an image and no byline or heading)
- record-listening__desktop__h13__s0.png (crumb "/ listening / 3myu2dis7dzwn")
- probe HEAD: /posting/3myujs5nl522g h1=[] title "A post — dame.is"; /listening/3myu2dis7dzwn h1=[]
- blogpost__mobile__h13__s0.png (crumb repeats the 46-char slug under the H1's own text and wraps the NSID to a 2nd line: top chrome ≈117 CSS px)
- src/components/ChromeBar.jsx:449-452 (last crumb = decoded raw segment)

#### COL-06 · Detail pages use five different header, back-link, column and footer patterns

`medium` · `visual` · effort L · verdict *confirmed* · lens: Collection, gallery & detail pages · **merges:** LAY-05, LAY-07

**Pages:** /creating/:slug, /creating/ratioed/:take, /creating/ratioed/participants, /curating/:channel, /listening/albums, /listening/albums/:album, /mothing/:night, /blogging/:slug, /available, /themself

**Observation.** Each detail page was designed on its own. Some carry a '← Parent' link above the title that duplicates the breadcrumb strip in the top bar, others don't. Column width and alignment change from page to page. Prev/next sequencing exists on two pages only. Pages without a single backing record print em-dash placeholders in the footer.

**Recommendation.** Define one detail 'plate' template with fixed slots. Choose one way back: either rely on the breadcrumb strip or keep the in-page crumb everywhere, via one shared component. Then H1, a colophon row (reuse DocumentMeta), the body in the measure with figures allowed to break out to 980px, and a foot strip with '← previous · index · next →' within the collection. Center /available like other measure pages, or deliberately use the right 390px for a sidebar (contact, skills). In RecordTimestamp, render nothing (or a collection-level 'latest record …') instead of 'written — · updated —'.

**Evidence.**
- In-page '← Parent' link present on ratioed-piece, ratioed-participants, albums, album and mothing-night (ratioed-piece__desktop__h13__s0.png, album__desktop__h13__s0.png, mothing-night__desktop__h13__s0.png), absent on creating-work, curating-channel and blogpost (creating-work-software__desktop__h13__s0.png, curating-channel__desktop__h13__s0.png)
- Back link implemented four times: .album-crumb (src/pages/Albums.css:7), .mothing-night-crumb (MothingNight.jsx:101), .ratioed-piece-crumb (RatioedPiece.jsx:471/539, RatioedParticipants.jsx:297)
- Column: creating work and blog post are centered 588px; ratioed piece, album, night and participants are left-aligned 980px; /available is a 588px column pinned left with ~390px empty on the right (available__desktop__h13__s0.png; src/pages/Resume.css:5 max-width without auto margins)
- Footer shows the placeholder 'WRITTEN — · UPDATED —' on album, mothing night, ratioed piece, participants, themself and record-posting (album__desktop__h13__bottom.png, mothing-night__desktop__h13__s2.png, ratioed-piece__desktop__h13__s2.png, ratioed-participants__desktop__h13__s2.png): src/components/RecordTimestamp.jsx:52-54
- Only ratioed piece and mothing night offer prev/next ('← take 40', 'EARLIER NIGHT ← Sep 13, 2026'); creating works, albums and channels are dead ends apart from the breadcrumb

#### LAY-05 · Page content starts at four different x-positions across templates  
*Merged into COL-06.*

`medium` · `visual` · effort M · verdict *confirmed* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** /blogging/:slug, /creating/:slug, /creating/ratioed, /available, /logging/:rkey, /listening/:rkey, /posting/:rkey, /themself

**Observation.** Index pages, home and the chrome all hang from x=230 (at 1440). Documents (blog posts, creating works, Ratioed) centre a 588px column at x=426, 196px right of the breadcrumb directly above them. Generic record pages centre at x=426 for posts but at x=478 for logging/listening records (a narrower 484px column). The résumé, also long-form, is left-flush at 230 with a 392px empty right margin. /themself puts its h1 at 366 beside the avatar. Moving between a list and its items makes the reading edge jump left and right.

**Recommendation** (carried forward in COL-06). Choose one text-block rule. Since the chrome hangs left, anchor every long-form column (documents, records, résumé) at the same left edge as index pages (x = gutter) at 65ch, and turn the freed right margin (~390px at 1440) into a marginalia column. The PUBLISHED / ELAPSED / TAGGED meta strip, figure captions and footnote-style link notes would live there and stack inline under 900px. Give .record-page the same 65ch as documents (resolved against the body font) so every record is the same width.

**Evidence.**
- extra/layout/lay-measure.json edges:*:desktop: index-page h1 x=230 (13 pages); blogpost/aturi/ratioed h1 x=426, column 426–1014; rec-logging content x=478 (column 478–962, 484px); available h1 x=230, column 230–818; themself h1 x=366
- blogpost__desktop__h13__s0.png: breadcrumb at x=230, title at x=426
- record-logging__desktop__h13__s0.png, record-listening__desktop__h13__s0.png (centred 484px) vs record-posting__desktop__h13__s0.png (centred 588px)
- available__desktop__h13__s0.png: left-flush 588px column with 392px empty to its right
- state-tablet-blogpost__desktop__h13.png: breadcrumb x=49 vs title x=116
- Blogging.css:100-104 and 147-152 (documents centred via margin: 0 auto), Blogging.css:399-402 (.record-page centred), Resume.css:1-6 (left-flush measure)

#### LAY-07 · Index/detail page template drift: title position, title size and section heads vary  
*Merged into COL-06.*

`low` · `visual` · effort M · verdict *adjusted* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** /listening/albums, /listening/albums/:album, /mothing/:night, /creating/ratioed/participants, /creating/ratioed/:n, /available, /themself, /welcoming, /listening, /logging

**Observation.** Detail pages carry a redundant in-page '← Parent' link above the H1, a third back affordance after the pinned breadcrumb and the bottom-bar back button, adding about 35px before the title. Section headings use several treatments: serif-bold 'Recent listening', small-caps 'TOP TRACKS' on the same page, letterspaced accent '36 SIGNATURES', inline 'MOST SEEN' and small caps over a rule ('EXPERIENCE'). On /welcoming the CTA, a full rule and the heading put about 120–130px before the first signature. Title offsets differ by template only because of the breadcrumb reservation.

**Recommendation** (carried forward in COL-06). Drop the in-page back link, or turn it into a small-caps kicker in the title's own slot, and rely on the breadcrumb. Standardise section heads on small caps over a hairline, keeping serif h2 for in-content headings. The vertical title offsets can stay as they are.

**Evidence.**
- extra/layout/lay-measure.json desktop h1 top: 194 (index pages), 232 (documents, curating channel), 267 (albums, album, mothing night: '← Listening' back-link above the title under the pinned breadcrumb); mobile h1 top 90 / 128 / 151 / 162 / 250
- h1 font-size 48px on index pages vs 36px on /available and /themself
- albums__desktop__h13__s0.png, album__desktop__h13__s0.png, ratioed-participants__desktop__h13__s0.png: in-page back link + breadcrumb + bottom-bar back button
- Section heads: 'Recent listening' serif bold (listening__desktop__h13__s0.png), '36 SIGNATURES' letterspaced accent caps (welcoming__desktop__h13__s0.png), 'TOP TRACKS' / 'IDENTITY' tiny small caps (exploring__desktop__h13__s0.png), 'MOST SEEN' inline (mothing__desktop__h13__s0.png), 'EXPERIENCE' small caps with rule (available__desktop__h13__s0.png)
- Guestbook intro → list: button, 40px, full rule, 46px, heading, 41px before the first entry (welcoming__desktop__h13__s0.png) vs 40px intro → first row on /blogging

**Verification note (adjusted).** The H1 offsets (194 / 232 / 267) are systematic, not drift. Detail pages reserve the pinned breadcrumb (.main padding adds --chrome-crumb-pin-h, app.css:56-81), and back-link pages add the link. Each template is internally consistent. The 36px title on /available is a résumé header with name and role beneath, and /themself is broken by its missing record. Two parts hold. The '← Listening / ← Albums / ← Ratioed' link is a third back affordance alongside the breadcrumb and the bottom-bar back button, and it costs about 35px (albums__desktop__h13__s0, album__desktop__h13__s0). Section heads also vary, even within /listening ('Recent listening' serif bold against 'TOP TRACKS' small caps). These are polish-level consistency issues.

#### INT-01 · The bottom bar's ← Back button leaves the site on deep links

`medium` · `functional` · effort S · verdict *adjusted* · lens: Interaction, motion, feedback & states

**Pages:** /mothing/2026-10-16, /blogging/*, /posting/*, all non-home routes

**Observation.** goBack() treats history.length > 1 as in-app history. Visitors who land on a deep link in a tab that already has history (search result, link aggregator, URL typed into an existing tab) are sent off the site by the in-app ← (verified: lands on example.com). Links opened in a new tab or in-app browser, which covers Bluesky web and app, start with history.length 1, so they correctly fall back to the breadcrumb parent (verified: lands on /mothing).

**Recommendation.** Decide from router state instead of the browser: if useLocation().key === 'default' (the first entry React Router saw) or a sessionStorage in-app navigation counter is 0, navigate(parentPath), otherwise navigate(-1). Show the destination in the title and aria-label, e.g. 'Back to mothing'.

**Evidence.**
- extra/interaction test int-back.cjs: example.com → dame.is/mothing/2026-10-16, history.length = 3, tapping .chrome-back-btn lands on https://example.com/
- src/components/ChromeBar.jsx:613-618 (if (window.history.length > 1) navigate(-1); else navigate(parentPath))
- state-guestbook-sign__mobile__h13.png, notfound__mobile__h13__s0.png (← shown on every non-home page)

**Verification note (adjusted).** I re-ran int-back.cjs: example.com → /mothing/2026-10-16 gives history.length 3, and the ← chip lands on https://example.com/. ChromeBar.jsx:613-618 contradicts its own comment. My extra test vint-back2.cjs opened the same URL from a target=_blank link, which is how Bluesky web opens external links (the iOS app uses an in-app browser, also fresh history). There history.length was 1 and ← correctly went to /mothing. So the claim that 'most visitors arrive from Bluesky and get ejected' is overstated. The bug hits same-tab arrivals: search results, aggregators, and a URL typed into an existing tab. Real and easy to fix, but not high.

#### INT-05 · Route transition jumps the old page to the top while it fades out

`medium` · `functional` · effort S · verdict *confirmed* · lens: Interaction, motion, feedback & states

**Pages:** all route changes from a scrolled page

**Observation.** On a forward navigation the effect scrolls the window to 0 on the same commit that starts the exit fade, while AnimatePresence still renders the outgoing page. Clicking a row 4,000 px down therefore flashes the home hero, 'Resume / Projects / Blog' and the first feed rows during the 180 ms fade-out. A blank frame follows, then the new page. In the bottom bar the arriving ← and ⌂ chips fade in while the ↓ chip slides, and they overlap for about 100 ms.

**Recommendation.** Reset scroll in AnimatePresence onExitComplete (just before the new route mounts), or drop the exit fade and fade in only (about 160 ms), which also halves perceived latency. For the bar, give the entering chips layout='position' with a 60 ms delay, or animate width from 0, so they never overlap their neighbours.

**Evidence.**
- extra/interaction/route-0-before.png (home scrolled to y=4000)
- extra/interaction/route-120ms.png (y=0, outgoing opacity 0.16: the home hero ghosts over the new post page's running head)
- extra/interaction/crop-bar-route-120ms.png (the fading-in home chip overlaps the ↓ chip mid-layout animation)
- extra/interaction/route-220ms.png / route-400ms.png (blank, then the new page fades in)
- src/components/RouteTransition.jsx:33-35 (window.scrollTo(0,0) runs on the pathname change)
- src/components/RouteTransition.jsx:44-55 (AnimatePresence mode="wait", 0.18 s exit + 0.18 s enter)

#### NAV-09 · Essays and works end in a dead end: no next/previous, no 'more in this section'

`medium` · `ux` · effort M · verdict *confirmed* · lens: Navigation, wayfinding & information architecture

**Pages:** /blogging/:slug, /creating/:slug

**Observation.** After 6,600px of essay and its comments, the only ways on are the chrome's Back, Home and compass. There is no next or previous essay, no link to 'all 7 essays', and no related work. Mothing nights and Ratioed takes already sequence their siblings, so the omission is inconsistent as well as costly.

**Recommendation.** Add a colophon block at the end of every blogging and creating page: previous and next titles (chronological), a link to the section index with its count, and optionally 'from the same year' or the same tag. Set it like a book's end matter: hairline, small-caps labels, serif titles, page-number-style dates.

**Evidence.**
- blogpost__desktop__h13__bottom.png, blogpost__mobile__h13__bottom.png (page ends at the last comment, then the footer strip)
- creating-work-software__desktop__h13__s0.png (Aturi ends after one link card)
- grep: no prev/next in src/pages/BlogPost.jsx or src/pages/CreatingWork.jsx
- src/pages/MothingNight.jsx:169 and src/pages/RatioedPiece.jsx:1168 (older/newer pattern already exists elsewhere)

#### SYS-10 · Three '← Parent' crumb implementations, applied on some sub-pages only, duplicating the chrome breadcrumb

`low` · `ux` · effort S · verdict *confirmed* · lens: Component system & visual consistency · **merges:** NAV-11

**Pages:** /listening/albums, /listening/albums/:album, /mothing/:night, /creating/ratioed/:n, /creating/ratioed/participants, /curating/:channel, /blogging/:slug, /creating/:work

**Observation.** Five sub-pages show an in-page '← Parent' link above the H1, built by three page-specific classes, on top of the chrome breadcrumb strip that already shows the path. Other sub-pages of the same depth (a curating channel, a blog post, a creating work, record pages) show none.

**Recommendation.** Pick one rule. Preferred: make it a PageShell prop (parent={{ to, label }}) rendered by a single .page-crumb, in the style of a book's running head, on every sub-page including channels, posts, works and records. Alternatively, drop it everywhere and let the chrome strip be the only breadcrumb.

**Evidence.**
- album__desktop__h13__s0.png (chrome strip '/ listening / albums / charm-by-clairo' plus in-page '← Albums')
- mothing-night__desktop__h13__s0.png, ratioed-piece__desktop__h13__s0.png, ratioed-participants__desktop__h13__s0.png (in-page crumb present)
- curating-channel__desktop__h13__s0.png, blogpost__desktop__h13__s0.png, creating-work-software__desktop__h13__s0.png (no in-page crumb)
- src/pages/Albums.css:7 (.album-crumb), src/pages/Mothing.css:289 (.mothing-night-crumb), src/pages/RatioedPiece.css:26 (.ratioed-piece-crumb)
- src/components/ChromeBar.css:189-340 (chrome breadcrumb)
- src/components/PageShell.jsx ('above' slot, opt-in per page)

#### NAV-11 · Four competing 'go back' affordances on detail pages, applied inconsistently  
*Merged into SYS-10.*

`low` · `ux` · effort S · verdict *confirmed* · lens: Navigation, wayfinding & information architecture

**Pages:** /listening/albums/:slug, /mothing/:date, /creating/ratioed/:piece, /blogging/:slug, /creating/:slug

**Observation.** Some detail pages still carry the '← Section' eyebrow the pinned crumb was meant to replace, so the same parent link appears twice, about 80px apart. Blog and work pages don't have it. The bottom-bar ← mirrors browser history, so after arriving from Bluesky in the same tab it leaves the site, even though it sits next to ⌂ and reads as an in-site control.

**Recommendation** (carried forward in SYS-10). Remove the remaining in-page eyebrows; the pinned crumb is the standard. Make the bar's ← mean 'up one level' (the resolved crumb parent, see NAV-01) and leave history-back to the browser, or label it 'up' with a ↖ glyph so the two can't be confused.

**Evidence.**
- album__desktop__h13__s0.png (crumb "/ listening / albums / charm-by-clairo" + in-page "← Albums" ~80px below + bottom-bar ← and ⌂)
- mothing-night__desktop__h13__s0.png ("/ mothing / 2026-10-16" + "← Mothing")
- ratioed-piece__mobile__h13__s0.png ("/ creating / ratioed / 41" + "← Ratioed")
- creating-work-software__desktop__h13__s0.png, blogpost__desktop__h13__s0.png (no eyebrow)
- src/pages/ListeningAlbum.jsx:74, MothingNight.jsx:102, RatioedPiece.jsx:472/540, RatioedParticipants.jsx:298
- src/components/ChromeBar.jsx:144-148 (comment: crumb 'replaces the old per-page "← Section" eyebrow'), :613-618 (Back = navigate(-1) whenever history.length > 1)

### Theme 7 — First impressions and the map

#### GAP-07 · No way to find anything in 16k–42k px archives, though search is built and switched off

`medium` · `ux` · effort S · verdict *confirmed* · lens: Gap pass (cross-lens)

**Pages:** /, /logging, /posting, /listening, /mothing, /curating/:channel

**Observation.** Every archive is a single long scroll with no search, no month index and no 'jump to'. The search sheet and the ?q= filter exist and mostly work, but the only way in is typing a query string into the URL, and an active query is invisible on the page.

**Recommendation.** Switch search back on, but not as another unlabeled 28px chip. Put a text field at the top of the compass sheet, 'Search the record…', with per-gerund match counts. Show an active query as a removable line above the ledger: "12 records matching 'tennis' · clear". Extend matchesQuery to /mothing (common and Latin names) and /curating. Add a month index to the running-head day strip.

**Evidence.**
- src/components/ChromeBar.jsx:48-51: SEARCH_ENABLED = false hides the SearchSheet trigger; the comment says the feature is 'built and wired'
- gap/q.cjs: /logging?q=tennis narrows the page from 40,244px to 5,497px and /?q=moth gives 2,145px, but /mothing?q=underwing has no effect (32,683px both ways)
- extra/gaps/search-hidden-logging-q-tennis.png: with ?q active, nothing above the fold says the page is filtered
- metrics-summary.txt heights: logging 40,244 / 42,360 (mobile), mothing 32,683, listening 16,176 / 19,953, posting 16,072 / 18,617, curating-channel 82,547 (mobile)

#### INT-09 · Empty, error and 404 states are bare or author-facing

`medium` · `content` · effort S · verdict *confirmed* · lens: Interaction, motion, feedback & states · **merges:** NAV-14, SYS-12, LAY-10, NAV-10, COL-11

**Pages:** /sharing, /themself, /this-page-does-not-exist (404), / with all filters off

**Observation.** Empty states fall into two kinds. Some are instructions to the owner shown to the public ('write one and refresh'); others are a single line with no way forward (404, empty filter). The 404 gets the book first-line indent on 'Try the home page.', so it looks like a stray paragraph. The footer's page-number metadata prints dashes when no record backs the page. The ↓ scroll-to-bottom chip appears even when the page doesn't scroll (404, /sharing and /themself on desktop).

**Recommendation.** Write an 'empty page' voice with a book idiom: the 404 becomes 'This page intentionally left blank', followed by the gerund menu inline ('dame is… blogging · creating · mothing …') and 'look this address up in the explorer →' for at-uri-shaped paths. /sharing for visitors: 'Nothing handed off yet.' Keep the authoring hint behind the owner session. Empty filter: 'Nothing here with these filters' plus [restore defaults] and [show all] text buttons. Hide the footer meta when there is no record, and hide the scroll chip when maxScroll ≤ 4.

**Evidence.**
- sharing__mobile__h13__s0.png ('No is.dame.page/sharing record yet — write one and refresh.' shown to visitors, while the footer says 'WRITTEN 3MO AGO')
- notfound__desktop__h13__s0.png, notfound__mobile__h13__s0.png ('Try the home page.' indented 1.5em by typography.css:42; footer 'WRITTEN — · UPDATED —'; ↓ scroll chip on an unscrollable page)
- themself__desktop__h13__s0.png (empty below the profile header)
- extra/interaction/filters-show-none-closed-desktop.png ('No records match these filters.' off-centre italic, no reset action)
- src/pages/Sharing.jsx:25, src/pages/NotFound.jsx:4-15

#### NAV-14 · 404 page is generic: no echo of the URL, no table of contents, and an empty WRITTEN/UPDATED footer  
*Merged into INT-09.*

`low` · `ux` · effort S · verdict *confirmed* · lens: Navigation, wayfinding & information architecture

**Pages:** /* (not found)

**Observation.** Because of NAV-01 and NAV-08 the 404 page gets real traffic, but it offers a single 'home page' link. It doesn't show the requested path, suggest a likely match (/projects→/creating), or list the sections. The global footer prints em-dash placeholders for written/updated.

**Recommendation** (carried forward in INT-09). Use the gerund voice as the H1 (muted "dame is" + "nowhere to be found"), print the requested path in mono, suggest the nearest gerund route or a redirect alias, and render the table-of-contents menu (NAV-03) inline. If the path looks like an at:// URI or rkey, offer 'look it up in /exploring'. Hide the WRITTEN/UPDATED footer when there's no record.

**Evidence.**
- notfound__desktop__h13__s0.png, notfound__mobile__h13__s0.png ("Nowhere to be found / No record exists at this URL. / Try the home page." + footer "WRITTEN — · UPDATED —")
- src/pages/NotFound.jsx:4-15
- probe: /projects, /contact, /reposting etc. all land here

#### SYS-12 · Empty and zero states are improvised per page, and the prose indent leaks into UI copy  
*Merged into INT-09.*

`low` · `ux` · effort S · verdict *confirmed* · lens: Component system & visual consistency

**Pages:** /sharing, /this-page-does-not-exist (404), /themself, /listening, /logging

**Observation.** Each page invents its own 'nothing here' treatment: centred italic with a code chip, an indented sentence, or blank space. The book-prose rule p + p { text-indent: 1.5em } also indents short UI sentences that follow a page intro.

**Recommendation** (carried forward in INT-09). Add an .empty-note primitive: left-aligned on the text column, an .eyebrow showing the NSID, one italic serif sentence, and an optional quiet .btn (e.g. 'Inspect the record' or 'Go home'). Give it text-indent: 0 so prose rules never reach it, and use it for the feed, stats, sharing, 404 and the missing /themself profile.

**Evidence.**
- sharing__desktop__h13__s0.png (centred italic line with a code chip, off the 230px text edge)
- notfound__mobile__h13__s0.png ('Try the home page.' indented 1.5em by the prose rule)
- themself__desktop__h13__s0.png (blank body below the profile rule)
- src/styles/typography.css:41-44 (p + p text-indent applies to UI paragraphs)
- src/components/Feed.css:916 (.feed-empty, centred), ListeningStats.css:59 and StateStats.css:57 (italic muted), ~17 *-empty classes in public CSS

#### LAY-10 · Prose paragraph indent and empty-state centring leak into UI text  
*Merged into INT-09.*

`low` · `visual` · effort S · verdict *confirmed* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** /404, /sharing

**Observation.** PageShell wraps every route in &lt;article>, so the book-style 'p + p' first-line indent applies to any UI paragraph that follows the intro: the 404's second sentence and the /sharing empty state both pick it up. .feed-empty also centres its text, but the global p { max-width: 65ch } keeps the box left-anchored, so the line centres within an invisible 65ch box and lands at an arbitrary x.

**Recommendation** (carried forward in INT-09). Scope the indent to prose containers (.blog-prose, .leaflet-document, .prose) instead of article/p + p, or reset text-indent on .page-intro + p and .feed-empty. Left-align empty states on the text edge, styled as a small-caps note with a hairline above, in place of a centred italic line.

**Evidence.**
- notfound__desktop__h13__s0.png: 'Try the home page.' indented 24px under 'No record exists at this URL.'
- sharing__desktop__h13__s0.png: the empty-state sentence floats at x≈326, aligned to neither the text edge (230) nor the column centre (720)
- typography.css:40-49 ('p + p' and 'article p + p' text-indent: 1.5em), PageShell.jsx:36 (every page is an &lt;article class="page">), Feed.css:916-921 (.feed-empty text-align: center inside a 65ch-capped &lt;p>)

#### NAV-10 · Public placeholder and orphaned pages: /sharing shows owner instructions to visitors  
*Merged into INT-09.*

`low` · `content` · effort S · verdict *adjusted* · lens: Navigation, wayfinding & information architecture

**Pages:** /sharing, /ethos, /exploring, /posting

**Observation.** /sharing is a live route that the permanent /ethos redirect still points at. It renders an owner-facing empty state ("write one and refresh") to the public, and its footer even says "WRITTEN 3MO AGO" with no record behind it.

**Recommendation** (carried forward in INT-09). Until an is.dame.page/sharing record exists, render /sharing (and so /ethos) as the not-found page or redirect it to /themself, and show the owner hint only to the signed-in owner. Leave menu additions to NAV-03.

**Evidence.**
- sharing__desktop__h13__s0.png ("No is.dame.page/sharing record yet — write one and refresh.")
- src/pages/Sharing.jsx:25
- vercel.json:67 (/ethos → /sharing permanent redirect sends legacy traffic here)
- src/App.jsx:243 (/sharing route is live)
- grep: /exploring linked only from DebugPane.jsx:75 (x-ray details) and its own pages; /posting only via record-page crumbs

**Verification note (adjusted).** The /sharing placeholder is confirmed: sharing__desktop__h13__s0.png shows "No is.dame.page/sharing record yet — write one and refresh." (Sharing.jsx), and /ethos 308s there live. But it is reachable only by direct URL or the legacy /ethos redirect, so few visitors see it. The 'orphaned /exploring' claim is inaccurate. Every record page's "Inspect Data" button (AturiActions.jsx) links into /exploring, and the owner deliberately hid it in is.dame.nav. The menu-omission half duplicates NAV-03.

#### COL-11 · Empty and coverless states address the owner, not the visitor  
*Merged into INT-09.*

`medium` · `content` · effort S · verdict *adjusted* · lens: Collection, gallery & detail pages

**Pages:** /sharing, /themself, /creating (cards)

**Observation.** /themself, which is linked from the nav, renders only the Bluesky avatar, handle and bio, then an empty page and a 'WRITTEN — · UPDATED —' footer, because its profile record is missing. /sharing, an orphan route not in the nav, shows owner-facing authoring copy ('write one and refresh') to anyone who reaches it. In the non-default cards view of /creating, a coverless work shows a blank 4:3 field (about 270px tall on a phone) with a lone fleuron, which reads like a failed image load.

**Recommendation** (carried forward in INT-09). Give /themself a visitor-facing fallback built from the profile, with links to /available, /creating and /welcoming. Show owner instructions on /sharing only in edit mode. Visitors should see a short italic line with an onward link, or the route can 404 until a record exists. Replace the fleuron placeholder with a typographic plate: title, category and year on a ruled panel.

**Evidence.**
- sharing__desktop__h13__s0.png: public page reads 'No is.dame.page/sharing record yet — write one and refresh.', indented ~96px from the title's left edge (src/pages/Sharing.jsx:24-26)
- themself__desktop__h13__s0.png: avatar, handle and bio, then ~450px of empty page and a 'WRITTEN — · UPDATED —' footer
- extra/collections/cards-creating__desktop.png and cards-creating__mobile.png: a coverless work (CodeTV Appearance) becomes a large empty box with a lone ❧ fleuron, ~270px tall on a phone (src/pages/Creating.css:54-62 .creating-grid-placeholder, Creating.jsx:39-41)

**Verification note (adjusted).** Partly accurate. sharing__desktop__h13__s0.png does show owner copy ('No is.dame.page/sharing record yet — write one and refresh.', Sharing.jsx:24-26), indented about 96px. But /sharing is not in the navigation (src/lib/navRoutes.js DEFAULT_ROUTES omits it), so visitors reach it only by direct URL, and 'Hide /sharing from navigation' is already the case. The fleuron placeholder appears only in the non-default cards view (cards-creating). The visitor-facing case that matters is /themself, which is in the nav and shows only avatar, handle and bio above about 450px of empty page and an em-dash footer (themself__desktop__h13__s0.png). Medium holds because of /themself.

#### MOB-10 · The page's H1 rewrites itself every 4–8 s with no way to hold it

`medium` · `accessibility` · effort S · verdict *confirmed* · lens: Mobile experience & accessible design (MOB) · **merges:** INT-12

**Pages:** /

**Observation.** The rotating 'dame is &lt;role> &lt;clause>' sentence is charming on desktop, where it fits on two lines. On mobile the clause wraps to four lines, and a slow reader (or anyone glancing up from the feed) often sees it change mid-sentence. Apart from the OS reduced-motion setting there is no pause, stop or hide control.

**Recommendation.** Tap or press on the sentence holds it (a 'held' state with a small visible cue, e.g. the rule under the last line turns solid accent), and a second tap resumes. Stop automatically after about 3 rotations, or once the visitor scrolls past the hero. Make the ⤨ button two-state (pause ‖ when running, shuffle ⤨ when held). Make sure the H1 never becomes an aria-live region.

**Evidence.**
- src/components/HeroSentence.jsx:135-158: part A swaps after 4000 + rand×4000 ms and part B after 4500 + rand×4000 ms. The cycle stops only for prefers-reduced-motion or a hidden tab.
- shots/home__mobile__h13__s0.png: on a phone the H1 is five 36px lines, with the clause 'who rehabbed four baby opossums and released them back into the wild' filling four of them, about 20 words to read before it can swap.
- The ⤨ 'Shuffle hero statement' button (35×35) triggers more change; it never pauses.

#### INT-12 · Hero rotation and status marquee never stop for touch users  
*Merged into MOB-10.*

`low` · `accessibility` · effort S · verdict *confirmed* · lens: Interaction, motion, feedback & states

**Pages:** /, all (status marquee)

**Observation.** The hero rewrites itself word by word every 4–8 s indefinitely, including while it sits beside or above content being read. Pause exists only for mouse hover and keyboard focus. On touch, the only control is the shuffle button, which advances the hero rather than stopping it. The status marquee likewise pauses only on hover or focus. Reduced-motion handling is correct (rotation off, index pinned).

**Recommendation** (carried forward in MOB-10). Rotate a fixed number of times (e.g. 3 cycles), then rest. Stop when the hero leaves the viewport (IntersectionObserver), and make a tap on the hero advance once and pause. Give the shuffle button a long-press or secondary 'pause' state. Run the marquee once per page view, then settle to the ellipsized still copy.

**Evidence.**
- extra/interaction/int-hero.cjs samples: the A/B phrases changed at nearly every 4 s sample over 24 s on both viewports
- src/components/HeroSentence.jsx:136-159 (4–8 s timers, endless), 210-215 (pause only on mouseenter/focus/visibilitychange)
- src/components/ChromeBar.css:868-874 (marquee pause on :hover/:focus-within only)
- home__mobile__h13__s0.png (the hero fills the first screen on mobile)

**Prior review:** RECOMMENDATIONS §3 (low: 'status marquee has no pause for touch users') — still open

#### NAV-02 · First-time visitors get no stable answer to "who is Dame / what is this site"

`medium` · `ux` · effort S · verdict *adjusted* · lens: Navigation, wayfinding & information architecture

**Pages:** /

**Observation.** The only statement about Dame on home is a deliberately playful rotating sentence; the live records hold 10 roles × 12 clauses. It is often professional but not reliably so, and nothing stable sits beside it: no one-line description of the person or the site, no 'start here'. The ⓘ primer explains the protocol, not Dame or the sections, and has no links. On mobile the hero is about 195 CSS px; the first ledger rows are Dame's own posts, and reposts of other people follow from row 3 (home__desktop__h13__s1.png).

**Recommendation.** Keep the rotating sentence as the brand moment, and add a fixed standfirst under it in the book's voice: one or two sentences with the real name, profession and what this page is, plus inline links to two or three sections and a 'what am I looking at?' link that opens the ⓘ sheet. Rewrite the ⓘ sheet opening to cover Dame and the site's structure first (a short list of the gerund sections with links, including /exploring), and keep the atproto explainer below it. Consider dropping reposting/following from DEFAULT_HOME_VERBS for the first screenful, or starting the ledger with Dame-authored records.

**Evidence.**
- home__desktop__h13__s0.png, home__mobile__h13__s0.png (hero is the only statement; 5 lines and ~390 CSS px tall on mobile)
- src/components/HeroSentence.jsx:21-45 (10 roles × 11 clauses incl. "a weird little guy", "a they/them", "a sourdough baker"), :140-154 (re-rolls every 4–8 s)
- state-info-open__desktop__h13.png + probe: ⓘ sheet text is about atproto/PDS/Atmosphere, contains 0 links, and never says who Dame is or what the sections are
- home__desktop__h13__s1.png (first feed screens after the hero are reposts of other people: Poe, seed paste soy goblin)
- src/lib/verbRegistry.js:356-368 (DEFAULT_HOME_VERBS includes reposting/following/listing/feeding)

**Verification note (adjusted).** The core point holds. The H1 is a rotating combination: the live is.dame.hero.phrase records hold 10 roles × 12 clauses, not the 10×11 fallback. There is no stable one-line statement of who Dame is. The ⓘ sheet (state-info-open__desktop__h13.png) covers atproto and the PDS, not the person or the sections. Several claims are overstated, though. About a third of the roles are professional (interface designer, design engineer, creative technologist), and many clauses are work-related ("built anisota.net", "makes social software with open protocols"). The filled "Resume" CTA sits directly under the hero, so the hiring path never depends on the sentence. On mobile the hero is about 195 CSS px tall, not ~390: home__mobile__h13__s0.png is a 2x image, and the hero spans about 390 image px. The first ledger rows are Dame's own posts (posting at 3:17 pm and 2:51 pm in home__desktop__h13__s0/s1); reposts begin at row 3. The whimsy is deliberate brand voice, so this is noticeable friction for first-time visitors and recruiters rather than a broken first impression.

#### NAV-03 · Compass menu is an incomplete, unglossed map with a color-only "you are here"

`medium` · `ux` · effort M · verdict *adjusted* · lens: Navigation, wayfinding & information architecture

**Pages:** / (menu open on every page)

**Observation.** The menu lists 9 rows. /posting is absent, and /exploring is hidden by the owner's is.dame.nav record, though it is reachable via "Inspect Data" on record pages. Rows are bare gerunds with no gloss for coined words like "mothing" or "themself". The current section is marked only by the same accent colour used for hover, so on desktop the 'you are here' row and the hovered row look identical (nav-open-on-blogging-hover__desktop.png). On desktop the list is bottom-anchored under about 290px of empty sheet.

**Recommendation.** Keep the path column, since it is part of the gerund/URL identity, but set it in the page-number gutter style. Add a one-line --ink-soft gloss per row. Mark the current row typographically (a manicule or §, or 'you are here' in small caps) and make hover an underline. Add /posting to the is.dame.nav record, and propose unhiding /exploring as the owner's call. Grouping under small-caps heads and filling the empty band with the live hero sentence are both good on-brand options.

**Evidence.**
- state-nav-open__desktop__h13.png, state-nav-open__mobile__h13.png (9 rows: available for hire, welcoming, creating, blogging, listening, logging, mothing, curating, themself)
- probe ROUTES: live is.dame.nav record omits /, /exploring, /posting; src/lib/navRoutes.js:7-19 defaults include home + exploring
- extra/nav/nav-open-on-blogging-hover__desktop.png (active "blogging" and hovered "logging" both rgb(15,117,138), indistinguishable)
- src/components/ActionDock.css:163-172 (hover and .is-active both = color: var(--accent))
- src/components/ActionDock.jsx:116-127 (row = label + path; path duplicates label)
- state-filters-open__desktop__h13.png (17 verbs in the filter sheet vs 9 menu rows)

**Verification note (adjusted).** Three claims verified. The active row (blogging) and the hovered row (logging) are indistinguishable in nav-open-on-blogging-hover__desktop.png; ActionDock.css gives both the hover and .is-active states color: var(--accent). The menu shows 9 bare gerunds with no gloss. About 290px of empty band sits above the list on desktop. Some claims are wrong or overstated. /exploring was deliberately hidden by the owner (hidden:true in the live is.dame.nav/self record), and it is reachable from the "Inspect Data" button on every record page (AturiActions.jsx links into /exploring), not only from crumbs or x-ray. /posting is not the largest stream; listening has 170 records. /sharing is a placeholder that NAV-10 itself says to hide, so counting it as missing contradicts that finding. Calling the path column "redundant" is partly taste: it reinforces the URL grammar ("dame.is/blogging"). The menu works and lists every major section, so the issues are friction, not a broken primary task. Medium, not high.

#### NAV-07 · Identity and contact are scattered: /themself is a dead end and the résumé never shows Dame's name

`medium` · `content` · effort S · verdict *adjusted* · lens: Navigation, wayfinding & information architecture

**Pages:** /themself, /available

**Observation.** /themself, where /about redirects, renders only the Bluesky identity card and a one-line bio, then blank space. The handle is unlinked, there is no contact method, and the WRITTEN/UPDATED footer shows em-dash placeholders, because is.dame.profile/self doesn't exist and the page has no fallback. The only contact on the site is resume@dame.is on /available, and the global footer has no contact or elsewhere links.

**Recommendation.** Give /themself a graceful no-record fallback: a linked handle, a small-caps 'FIND DAME' ledger (Bluesky, email, résumé →), a 'dame is also…' list of gerund links, and no WRITTEN/UPDATED footer when there is no record. Optionally add a quiet small-caps contact line to the footer strip. Drop the /available name eyebrow; the brand already names Dame.

**Evidence.**
- themself__desktop__h13__s0.png, state-footer-reached__mobile__h13.png (avatar, "dame", @dame.is, one-line bio, then ~450px of blank page; footer "WRITTEN — · UPDATED —")
- probe THEMSELF LINKS: [] (zero links in main, handle not linked)
- available__desktop__h13__s0.png (H1 "Available for hire", no name on screen)
- src/pages/Resume.jsx:27-31 (PRINT_NAME 'Dame' shown only in @media print)
- src/components/Footer.jsx:4-15 (footer = timestamp + 'Published on the AT Protocol', no links)
- src/pages/About.jsx:50-52 (supports `links`, none present)

**Verification note (adjusted).** /themself is confirmed as a dead end: avatar, name, handle and one-line bio, then blank page, no links, and a "WRITTEN — · UPDATED —" footer (themself__desktop__h13__s0.png). CORPUS.md already lists this as a known fact caused by the missing is.dame.profile/self record. The /available half is overstated. The persistent top-bar brand "dame.is" names Dame on every screen, the person goes by "dame" (there is no full name to add), and /available has a contact email plus a Website link above the fold. A name eyebrow there adds little. The real gaps are the /themself fallback and the absence of any contact line outside /available.

#### GAP-05 · The hiring story is split across pages that pitch different roles and inboxes

`low` · `content` · effort S · verdict *adjusted* · lens: Gap pass (cross-lens)

**Pages:** /available, /blogging/3mqrsdovjjf2d ('I'm looking for my next job'), / (hero + Resume CTA)

**Observation.** /available and the July 16 'I'm looking for my next job' essay are not cross-linked in both directions. The essay links to /available, but /available never links to the essay, which holds the strongest proof points. The two name different target roles ('Product Engineer & AI Enablement' vs 'design engineer, product designer, creative technologist') and different inboxes (resume@ vs hello@). The résumé's only external link besides email is 'Website', which points back to dame.is, and it has no Bluesky or GitHub link.

**Recommendation.** Make /available the single hiring hub. State the target roles in the essay's words, or list 'Open to: …'. Pick one inbox, or say what each is for. Add Bluesky and GitHub links. Link the essay in the intro: 'Why I'm looking →'. Show the 'Website' line only in print. Use the empty right margin for a sticky marginalia column, and mark the essay in /blogging with a small-caps 'pinned · hiring' folio.

**Evidence.**
- gap/hire.cjs link dump of /available &lt;main>: only mailto:resume@dame.is, 'Website' → https://dame.is (the site you are already on), and 5 /creating works. No Bluesky, GitHub or LinkedIn, and no link to the job essay
- extra/gaps/jobpost__desktop.png + link dump: the July 16, 2026 essay pitches 'design engineer, product designer, creative technologist', gives hello@dame.is and 'DM me on Bluesky', carries the strongest proof (100K+ visitors, SXSW, CodeTV, Atmosphere Conf), and links to /available; nothing links back
- available__desktop__h13__s0.png: role line 'Product Engineer & AI Enablement'; the right ~390px of the desktop page is empty
- blogging__desktop__h13__s0.png: 'I'm looking for my next job · 3mo ago' sits in the blog list with no special marking

**Verification note (adjusted).** Facts check out. Impact overstated: the résumé is complete and contactable; the role shift may be deliberate repositioning. What remains is a missed cross-link and missing profile links on the hiring page — content polish.

#### IDN-08 · The 'dame is ___' grammar is missing from the pages themselves: titles and the nav menu don't speak it

`low` · `content` · effort M · verdict *adjusted* · lens: Visual identity & aesthetic · **merges:** TYP-12

**Pages:** /blogging, /creating, /curating, /mothing, /listening, /logging, /welcoming, nav menu

**Observation.** Section titles are the bare capitalised gerunds ('Blogging', 'Mothing'). They lack the 'dame is' framing of the hero, and the planned italic-accent `.gerund` style is never applied. /welcoming breaks the pattern with 'Guestbook'. The compass sheet introduces its gerund list with a tiny small-caps 'DAME IS…' label, above which a large area of the bottom-anchored sheet is empty.

**Recommendation.** Title each gerund page the way the hero is set: 'dame is' in ink-faint on its own ruled line, then the gerund in italic accent at display size ('dame is / blogging'), with the plain-language intro beneath. For /welcoming use 'dame is welcoming you', with 'Sign the guestbook' as the call to action. Turn the nav sheet into a contents page: 'dame is' at 48px in the empty top space, then each gerund at about 28px on ruled lines with a live folio at right ('listening ········ 2h ago', 'blogging ········ Jul 16'), drawn from the data the ledger already has.

**Evidence.**
- blogging__desktop__h13__s0.png, creating__desktop__h13__s0.png, mothing__desktop__h13__s0.png: titles 'Blogging', 'Creating', 'Mothing'
- welcoming__desktop__h13__s0.png: the /welcoming page is titled 'Guestbook'
- src/styles/app.css:103-106: `.page-title .gerund { color: var(--accent); font-style: italic }` is defined but no JSX uses it
- state-nav-open__desktop__h13.png: tiny 'DAME IS…' label above a body-size list with /paths at right; about 295px of empty sheet above it on desktop (state-nav-open__mobile__h13.png: about 350 CSS px)
- Tab titles do use the grammar ('dame.is blogging', metrics-summary.txt)

**Verification note (adjusted).** Partly accurate. `.page-title .gerund` (app.css:103-106) is defined and no JSX uses it, and /welcoming is titled 'Guestbook' (welcoming__desktop__h13__s0.png). The nav sheet has a tiny 'DAME IS…' label above ruled gerund rows with /paths and ~295px of empty sheet above (state-nav-open__desktop__h13.png). But most section titles already are the gerunds ('Blogging', 'Creating', 'Curating', 'Mothing'), so the grammar is half-present, not missing; what's absent is the 'dame is' prefix. The nav list's bottom-anchored placement is a deliberate thumb-reach layout. This is a delight and consistency opportunity, not friction, so low.

#### TYP-12 · Page titles drop the gerund sentence; the italic-accent .gerund style exists but is never used  
*Merged into IDN-08.*

`low` · `visual` · effort S · verdict *confirmed* · lens: Typography & reading experience

**Pages:** /blogging, /creating, /curating, /listening, /logging, /mothing, /exploring, /welcoming

**Observation.** The URLs, the nav menu and the hero all build the sentence 'dame is &lt;verb>', but each section's H1 is just a capitalised noun-like word ('Blogging'), set in the same ink and weight as any title. A styling hook for an italic accent gerund was written and left unused.

**Recommendation** (carried forward in IDN-08). Render section titles as the sentence: a muted 'dame is' lead (the hero's lead treatment, at about 0.55× size, on the line above or inline) followed by the gerund in accent italic via the existing .gerund rule: 'dame is *blogging*', 'dame is *welcoming*', 'dame is *available*'. Keep document &lt;title> unchanged. Record pages (posts, works) keep their own titles.

**Evidence.**
- blogging__desktop__h13__s0.png ('Blogging')
- creating__desktop__h13__s0.png ('Creating')
- state-nav-open__desktop__h13.png (menu already reads 'DAME IS… blogging / creating …')
- home__desktop__h13__s0.png (hero 'dame is an interface designer…')
- app.css:103-106 .page-title .gerund { color: var(--accent); font-style: italic } — no JSX emits className 'gerund' (grep)
- PageShell.jsx:43-46 renders title verbatim

#### NAV-08 · Same destinations go by different names in hero, menu, H1 and URL; common guesses 404

`low` · `content` · effort S · verdict *adjusted* · lens: Navigation, wayfinding & information architecture

**Pages:** /, /welcoming, /available, /creating, /blogging

**Observation.** The hero CTAs use plain nouns (Resume / Projects / Blog) while the menu and URLs use gerunds. That is mostly bridged on arrival ("available for hire", "A selection of projects…"), except /welcoming, whose H1 reads "Guestbook". The legacy redirect /patrons → /supported points at a route that doesn't exist (live 404), and the hero's own word /projects has no alias.

**Recommendation.** Make the gerund the canonical name everywhere and give the plain noun as a gloss, not a competing title: H1 "Welcoming" with dek "the guestbook", H1 "Creating" with "projects, 2006–now". For hero CTAs, keep the plain nouns for scannability but echo the gerund in small caps ("Résumé · available"). Add redirects for the nouns people will try (/projects→/creating, /contact→/themself, /music→/listening, /moths→/mothing, /guests→/welcoming), and fix or remove /patrons.

**Evidence.**
- home__desktop__h13__s0.png (CTAs "Resume / Projects / Blog" + guestbook icon)
- state-nav-open__desktop__h13.png ("available for hire / creating / blogging / welcoming")
- welcoming__desktop__h13__s0.png (H1 "Guestbook" at /welcoming; probe title "dame.is welcoming")
- probe: /projects 404, /contact 404, /music 404, /moths 404; /patrons → /supported → 404 (vercel.json:66)
- src/pages/Home.jsx:668-696

**Verification note (adjusted).** Overstated. The résumé has two names, not four: "Resume" (CTA) and "available (for hire)", which is consistent across the menu, H1 and URL. /creating's intro "A selection of projects from the past two decades" (creating__desktop__h13__s0.png) already bridges "Projects" to "Creating". The audit itself recommends keeping plain nouns on the CTAs. The real mismatch is the guestbook: "welcoming" in the menu and URL, but H1 "Guestbook" (welcoming__desktop__h13__s0.png). /patrons→/supported→404 is a real but tiny bug (confirmed live). /projects, /contact, /music and /moths returning 404 are guesses, not observed user paths. This is polish, not medium friction.

#### NAV-13 · Opening the menu swaps the bar to unlabeled 'home feed layout' toggles on every page, and the account view doesn't explain itself

`low` · `ux` · effort S · verdict *adjusted* · lens: Navigation, wayfinding & information architecture

**Pages:** all pages (menu open)

**Observation.** When the compass opens, the left tools swap to a two-icon ledger/cards layout toggle. That is a site-wide collection-layout preference, with title tooltips, but it shows no visible label, its group aria-label says "Home feed layout", and it appears even on pages it doesn't affect (/themself, /available, record pages). The Account view is a bare 'Sign in with atproto' form with no stated purpose and a grey button that looks disabled.

**Recommendation.** Keep the layout pair in the menu-open bar, but add a small-caps "LAYOUT" label or words ("ledger · cards"), hide it on routes that don't honour it, and fix its aria-label to say it applies to collection pages. Give the Account view one line of purpose ("Sign in with your atproto handle to sign the guestbook") and an outlined hairline button that doesn't read as disabled.

**Evidence.**
- state-nav-open__mobile__h13.png, extra/nav/nav-open-on-blogging__mobile.png (two unlabeled layout icons bottom-left while on /blogging, which has no feed)
- src/components/ChromeBar.jsx:673-684 (dockOpen → &lt;LayoutToggle/>), src/components/LayoutToggle.jsx:23 (aria-label 'Home feed layout')
- state-nav-account__desktop__h13.png, state-nav-account__mobile__h13.png ("SIGN IN WITH ATPROTO", grey SIGN IN button that looks disabled, no purpose given; desktop panel bottom-anchored, mobile top-anchored)

**Verification note (adjusted).** The layout-toggle half is mostly wrong. useFeedLayout is a site-wide preference used by Home, Posting, Logging, Listening, Blogging, Creating, Curating and Mothing, so on /blogging the toggle does switch that page to cards (see extra/collections/cards-blogging__desktop.png). Both buttons also have title tooltips ("Feed layout: ledger/cards", LayoutToggle.jsx). Only the group's aria-label "Home feed layout" is misleading, and the toggle does nothing on /themself, /available, /welcoming or record pages. Moving it into the filter sheet would strand it on /blogging, which has no filter chip (blogging__desktop__h13__s0.png). The account-view half is confirmed (state-nav-account__*.png): there is no stated purpose, the button is grey and looks disabled, and the panel is bottom-anchored on desktop but top-anchored on mobile.

### Theme 8 — The chrome is the live layer, but it doesn't step aside or explain itself

#### MOB-03 · The bottom bar has no overflow strategy: the compass (the only way into the site menu) is pushed off-screen at 320px, and at 390px with 125% text

`high` · `functional` · effort M · verdict *confirmed* · lens: Mobile experience & accessible design (MOB)

**Pages:** /posting, /creating, /blogging, /curating, /listening, /logging, /mothing, /

**Observation.** Every control is a fixed 1.75rem chip in one flex row. On feed sub-pages the row fills up once you scroll and the '12 items scrolled past' count appears. At 320px CSS width (iPhone SE and mini with Display Zoom, small Androids) the compass then slides past the right edge. The same happens at 390px as soon as a visitor uses a larger default font, and at 150% the Home chip goes too. Nothing wraps, scrolls or collapses, so the controls are simply clipped.

**Recommendation.** Give the bar a priority order. The compass is pinned (flex-shrink: 0) and always visible, and the hour chip comes second. When the row overflows (ResizeObserver comparing scrollWidth to clientWidth, or a container query on the bar), move the lowest-priority chips (⌂ Home, then ⓘ, then ↑) into the compass sheet's existing tools row, which already swaps in for the left cluster when the dock opens. Also drop ⌂ on mobile altogether, since the title and breadcrumb already go home. Fold the bare count into the scroll chip ('↑ 12') so it stops occupying its own slot. Keep chips rem-sized so they still grow with user text; the overflow logic absorbs the growth.

**Evidence.**
- shots/extra/mobile/bottombar-posting-320.png (320×568, default text): nine items (1PM, filter, ⓘ, inspect, '12', ←, ↑, ⌂, compass). The compass is measured at x 310–338 in a 320px viewport, about half clipped.
- shots/extra/mobile/textzoom-125-posting-bar.png (390px, 125% text, i.e. Chrome 'Large'): compass at x 378–413, clipped.
- textzoom-150-posting.png: Home at 376–418 and compass at 430–472, both entirely off-screen. textzoom-200-home.png: compass at 429–485 even on home.
- ChromeBar.css:764-771: .chrome-bottom-row is a single non-wrapping flex row with no overflow handling. :804-806 spacer, :811-819 scroll count.
- ChromeBar.jsx:919-981: the scroll count, Back, scroll-jump and Home all join the right cluster on sub-pages. The admin-action comment at ChromeBar.css ("At 320 the row has about seven pixels of slack") shows the budget was only computed for default type.
- Redundancy on detail pages (mothing-night__mobile__h13__s0.png): home is reachable from the title link, the breadcrumb '/', the ⌂ chip and '← Mothing'; ← duplicates the OS back gesture.

**Prior review:** RECOMMENDATIONS §5 (Medium: bottom toolbar row can overflow narrow phones with no wrap/scroll) — still open

#### GAP-03 · Held sideways, a phone gives 58% of the screen to chrome, because the atmosphere bar's default depends only on width

`medium` · `ux` · effort S · verdict *adjusted* · lens: Gap pass (cross-lens)

**Pages:** /blogging/:slug, /creating/:slug, /, all pages on a landscape phone or short tablet

**Observation.** The atmosphere tiers start collapsed only at 700px wide or less. A landscape phone (844–932px wide, 390–430px tall) therefore gets the desktop default: three tiers, the breadcrumb strip and the bottom bar — about 52–58% chrome, leaving roughly 165px of essay at 844×390. A chevron to collapse the bar is visible at the top right and remembers the choice, but the default ignores height and nothing condenses automatically in a short viewport.

**Recommendation.** Make the default (and an automatic condense) depend on height as well as width: collapse the tiers when (max-height: 500px), or (pointer: coarse) and (max-width: 1024px). In short viewports, merge the breadcrumb into the right side of the status row instead of a fourth strip, and let the bottom bar slide away on sustained downward scroll and return on upward scroll. Keep honouring a stored preference.

**Evidence.**
- extra/gaps/landscape-blogpost__mobile.png (844×390 iPhone landscape, scrolled into the essay): status row + LISTENING/FOLLOWED + vitals + breadcrumb fill 0–167px, the bottom bar 332–390px, and only 165px (~5 lines) of essay are visible
- gap/land2.cjs: 844×390 → 58% chrome; 932×430 → 52% chrome (before Safari's own toolbars)
- src/hooks/useChromeBar.jsx:5 MOBILE_QUERY '(max-width: 700px)', :17 is the only collapse rule, so any phone wider than 700px gets the desktop 'expanded' default
- Prior lenses measured only portrait (MOB-05: 21%) and desktop (LAY-02: 25–30%)

**Verification note (adjusted).** Confirmed in landscape-blogpost__mobile.png (~165 CSS px of content between ~165px of top chrome and the bottom bar). 'Nothing tells the visitor the bar can be collapsed' is false: a chevron sits at the top right and its state persists. The real problem is the width-only default and no auto-condense in short viewports.

#### INT-04 · Sheets anchor, dismiss and label themselves differently; the nav sheet has a dead zone

`medium` · `ux` · effort M · verdict *adjusted* · lens: Interaction, motion, feedback & states · **merges:** SYS-06, MOB-12

**Pages:** all

**Observation.** The nav sheet fills the whole gap between the bars with routes at the bottom. On desktop, clicking the ~290 px blank area above them does not close it. Only the compass or Esc does. Close affordances vary: info, filters and guestbook have ×, sky-hour and nav do not. Each sheet header is a separate implementation. The touch-only differences (sign-in field at the top, full-height guestbook sheet) are intentional keyboard-occlusion fixes and should stay.

**Recommendation.** Build one SheetHeader primitive used by every sheet: small-caps label on the left ('DAME IS…', 'TIME OF DAY', 'FILTER BY TYPE', 'ACCOUNT'), a 28 px × on the right, and a hairline under it. On pointer:fine, make the nav sheet content-height ('compact') so the space above it is the backdrop, or have clicks on .dock-panel's empty area call closeDock. Add a faint scrim over the page behind compact sheets, e.g. color-mix(in oklab, var(--page) 55%, transparent), to read as a page turned down. Keep 'fill' sheets for the two long-form ones (info, debug) only.

**Evidence.**
- state-nav-open__desktop__h13.png (opaque full-height panel, routes at the bottom, ~295 px empty above, no label for close)
- extra/interaction int-dismiss.cjs: clicking (720,250) in that empty area leaves aria-expanded=true
- state-info-open__desktop__h13.png ('fill' sheet, content at the top, × button)
- state-filters-open__desktop__h13.png (compact, ×, page above stays fully bright and live)
- state-skyhour-open__desktop__h13.png (compact, no ×)
- state-guestbook-sign__desktop__h13.png vs __mobile (bottom sheet vs full-height sheet with ~60% empty)
- state-nav-account__desktop vs __mobile (form at the bottom vs at the top)
- src/components/ActionDock.css:69-91 (panel height fills the gap, align-content:end)
- src/components/BottomSheet.css:8-15 and ActionDock.css:8-13 (transparent, non-dimming backdrop)
- src/components/Lightbox.jsx:66-90 (the team already found that dead zones 'read as it takes two or three taps')

**Verification note (adjusted).** The nav dead zone is real. state-nav-open desktop shows ~290 px of blank panel above 'DAME IS…', ActionDock.css:69-91 makes the panel fill the gap with align-content:end, and int-dismiss shows a click there leaves the menu open. The sky-hour sheet has no ×, while info and filters do. Both backdrops are transparent by design (BottomSheet.css:1-14, ActionDock.css:1-13). Two of the cited 'inconsistencies' are deliberate and well reasoned, though: the guestbook and account field at the top / full height on touch keeps the input above the iOS keyboard (ActionDock.css comment, RECOMMENDATIONS §5.1). They should not be counted as arbitrary variance. The main defects are the nav dead zone and the uneven close affordances and headers.

#### SYS-06 · Every sheet rebuilds its own header and close button, and they have drifted  
*Merged into INT-04.*

`low` · `ux` · effort S · verdict *adjusted* · lens: Component system & visual consistency

**Pages:** info sheet, feed filter sheet, guestbook sign sheet, sky-hour sheet, waypoints sheet, nav / account sheet, lightbox

**Observation.** Among the BottomSheet consumers, each sheet re-implements its header row and close chip, and four of them are near-identical copies (0.16em, 12px, 1.75rem close with a 14% hover wash). The filter sheet has drifted: its title inherits 16px (33% larger than its siblings), and its close is 1.8rem, --ink-muted and has no hover wash. The sky-hour sheet replaces the X with 'LIVE' and relies on its hour-chip toggle. The nav menu is a separate ActionDock that closes via the compass. BottomSheet.jsx has no header API, which is why the copies exist.

**Recommendation** (carried forward in INT-04). Give BottomSheet an optional title/meta/onClose header (an .eyebrow title plus the standard 28px .chrome-nav-style X) and move the four copied sheets and the filter sheet onto it. On sky-hour, put 'Live' to the left of an X. Leave the nav dock's compass-toggle pattern alone, and keep the lightbox's filled close if it stays over photos, or switch it to the outline chip only if the lightbox chrome is unified separately.

**Evidence.**
- state-filters-open__mobile__h13.png ('FILTER BY TYPE' renders at 16px) vs state-info-open__mobile__h13.png ('ABOUT THIS SITE' at 12px)
- state-skyhour-open__mobile__h13.png (no close button; 'LIVE' takes its slot)
- state-nav-account__desktop__h13.png (back chevron chip + 'ACCOUNT', no close)
- state-lightbox__desktop__h13.png (close = filled accent; sheet closes are outline)
- src/components/FeedFilters.css:123-150 (header has no font-size → inherits 16px; tracking 0.14em; close 1.8rem, --ink-muted, no hover wash)
- src/components/InfoSheet.css:13-44, GuestbookSheet.css:31-70, WaypointsSheet.css:16-66, SkyHourSheet.css:14-23 (near-identical copies at 0.16em)
- src/components/BottomSheet.jsx (shared shell has no header API)
- src/components/Lightbox.css:215-228

**Verification note (adjusted).** The drift is real. state-filters-open__mobile shows 'FILTER BY TYPE' visibly larger than 'ABOUT THIS SITE' in state-info-open, because FeedFilters.css:123-130 sets no font-size. The filter close is 1.8rem with --ink-muted and no hover wash, against 1.75rem with a 14% wash in the near-identical InfoSheet, GuestbookSheet and WaypointsSheet copies. Two parts are overstated. The nav menu is ActionDock/NavMenuPanel, not a BottomSheet, and both it and the sky-hour sheet are dismissed by their own bottom-bar toggle (compass and hour chip), as well as Escape and outside click, so the missing X is a toggle pattern rather than a dead end. A filled close on a full-screen photo lightbox is also a defensible overlay choice, not drift. What remains is header polish across sheets.

#### MOB-12 · Sheets close only from the top-right corner, and the transparent backdrop makes the page above look tappable  
*Merged into INT-04.*

`low` · `ux` · effort S · verdict *adjusted* · lens: Mobile experience & accessible design (MOB)

**Pages:** /welcoming (Sign guestbook), all pages (ⓘ, filters, sky-hour, account sheets)

**Observation.** Compact sheets close by tapping anywhere on the page (deliberate transparent light-dismiss) or by re-tapping their opener chip in the bottom bar. Only the full-height guestbook sign sheet relies solely on a top-right × (plus Escape) far from the thumb. No sheet supports swipe-down dismissal.

**Recommendation** (carried forward in INT-04). Give the full-height guestbook sheet a thumb-zone close, either a small-caps 'CLOSE' text button just above the bar or the opener-turns-× pattern. Add a hairline drag handle with swipe-down dismiss to all sheets. Keep the untinted backdrop (it is intentional), or at most add a very faint page-coloured veil if testing shows dead taps confuse people.

**Evidence.**
- shots/state-guestbook-sign__mobile__h13.png: a full-height sheet whose only close control is the × at top-right (y≈88px). No bottom-bar chip opened it, so there is no toggle to tap.
- shots/state-filters-open__mobile__h13.png: the hero and CTAs stay fully visible and undimmed above the filter sheet. Tapping 'Resume' there only closes the sheet.
- BottomSheet.css:9-14: .bottom-sheet-backdrop is 'background: transparent' by design. BottomSheet.jsx has no drag-to-dismiss.

**Verification note (adjusted).** The title is inaccurate for most sheets. BottomSheet.css:1-14 documents a deliberate transparent light-dismiss backdrop: tapping anywhere on the page closes the sheet. The opener chip in the bottom bar (thumb zone) toggles it closed, because the bars sit above the backdrop. So compact sheets (ⓘ, filters, sky-hour) do not close only from the top-right. The 'dead tap' on Resume is ordinary light-dismiss behaviour. The real gap is the full-height guestbook sheet (state-guestbook-sign__mobile__h13.png): no bar chip opened it and the page above is covered, so the top-right × (or Escape) is the only close. Swipe-to-dismiss is indeed absent. The no-tint backdrop is a stated design choice, so a scrim is optional rather than a fix.

#### LAY-02 · Sticky chrome takes 25–30% of desktop and up to 33% of mobile while reading

`medium` · `ux` · effort M · verdict *adjusted* · lens: Layout, grid, spacing & responsive behaviour · **merges:** MOB-05, INT-13

**Pages:** /, /blogging/*, /creating/*, /listening/*, all detail pages

**Observation.** On desktop the atmosphere tiers are open by default. Pinned top chrome is 130px at rest on index pages and 167px on detail pages or once scrolled. With the 58px bottom bar that is 20.9–25% of a 900px viewport while reading a post, rising to 30% only at page end when the 45px footer strip appears. On phones the default is 58–117px of top chrome (13.7–20.7% with the bottom bar); the 117px comes from the NSID wrapping to a second breadcrumb line on detail pages. It reaches 33% only if the reader expands the tier, which is then remembered.

**Recommendation.** Keep only the 58px primary row sticky. Treat the two atmosphere tiers as a masthead in normal flow that scrolls away with the page top, or auto-collapse them once scrollY passes their height and restore them at the top. When scrolled on a detail page, fold the breadcrumb trail into the primary row in place of the status text instead of adding a 37px strip. On mobile keep the NSID on the trail's line (truncated) or move it to the x-ray/info sheet. Target at most 116px (12.9%) of desktop chrome while reading and about 14% on mobile, footer strip included.

**Evidence.**
- extra/layout/lay-measure.json chrome:home:desktop rest 130+58=188px (20.9%), scrolled 167+58=225px (25.0%)
- chrome:blogpost:desktop 167+58=225px (25%) the whole read, 167+103=270px (30%) at page end, when the 45px footer strip slides up
- chrome:home:mobile rest 58+58 (13.7%), scrolled 94+58 (18.0%); chrome:blogpost:mobile 117+58 (20.7%), at end 117+103 (26.1%)
- chrome:home:mobile:expanded-scrolled 222+58=280px (33.2%): extra/layout/mobile-expanded-scrolled.png
- blogpost__desktop__h13__s1.png: only 677px of 900 is article
- blogpost__mobile__h13__s0.png: on mobile the pinned breadcrumb wraps the NSID to its own line, making the strip 58px tall
- ChromeBar.css:40-56 (.chrome-bar-top is position: sticky and contains both atmosphere tiers), useChromeBar.jsx:14-17 (expanded by default above 700px; a toggle persists to localStorage), ChromeBar.css:972-979 (NSID wrap), ChromeBar.css:744-759 (footer strip)

**Verification note (adjusted).** The measurements check out: lay-measure chrome:blogpost:desktop is 167+58=225px (25%), and 270px (30%) at the end. blogpost__desktop__h13__s1 shows the four stacked tiers. ChromeBar.css:40-56 makes the whole top block sticky. src/hooks/useChromeBar.jsx persists the toggle. The worst figures are edge cases, though. The 30% exists only at the very end of a page, when the footer strip slides up. The 33% on mobile exists only after the reader deliberately expands the tier. The mobile default is 13.7–20.7%. A desktop reader can also collapse the tiers. This is real friction while reading long-form on laptops, but it does not block a primary task. Medium, not high.

#### MOB-05 · The chrome never steps aside while reading: about 176px (21%) of an 844px phone is fixed chrome, and 221px (26%) at the end of a post  
*Merged into LAY-02.*

`low` · `ux` · effort M · verdict *adjusted* · lens: Mobile experience & accessible design (MOB)

**Pages:** /blogging/:slug, /creating/:work, /creating/ratioed, /posting, all detail pages

**Observation.** On detail pages the top chrome is two rows (58px status bar plus a ~60px breadcrumb strip). The strip is two rows only because the record NSID wraps beneath a long slug crumb ('why-i-started-posting-like-its-the-2000s-again'). Total fixed chrome mid-article is ~176px (21% of 844px; ~31% on a 568px phone). That is comparable to native app chrome, but the wrapped second strip row is avoidable furniture on long-form pages.

**Recommendation** (carried forward in LAY-02). On mobile, keep the detail strip to one hairline row. Ellipsize the current-page crumb (or replace the slug with the title in small caps), and show the NSID only in x-ray mode or as a right-aligned tail when it fits. Optionally, once the title scrolls past, condense the status bar and strip into a ~32px running head ('BLOGGING · WHY I STARTED POSTING…'). Keep the bottom bar visible, or hide it only on sustained downward scroll in long-form and restore it on any upward scroll, so the menu and x-ray entry are never lost.

**Evidence.**
- Measured on the blog post at 390×844 mid-article: top bar 0–58, breadcrumb strip 57–117, bottom bar 786–844. At the end the footer strip adds 742–787 (shots/blogpost__mobile__h13__s1.png, blogpost__mobile__h13__bottom.png).
- shots/state-footer-reached__mobile__h13.png: four chrome layers (top bar, footer strip 'WRITTEN — · UPDATED —', bottom bar) frame a near-empty page.
- On a 568px-tall phone the same 176px is about 31% of the screen.
- There is no scroll-direction or hide logic in ChromeBar.jsx or ChromeBar.css (grep finds no is-hidden or translateY(-100%)). The strip's reveal is the only scroll behaviour (ChromeBar.jsx:141-151).

**Verification note (adjusted).** The measurements hold: in blogpost__mobile__h13__s1.png the top bar is 0–58, the strip ~58–117 and the bottom bar 786–844, about 176px or 21%. That total is in line with native app chrome, though: an iOS status bar, nav bar and tab bar come to roughly 174pt. The breadcrumb strip is deliberately pinned on detail pages as the back affordance (ChromeBar.jsx:141-151 comment). The real excess is the strip's second row, created when the NSID wraps under a long slug crumb. The state-footer-reached evidence is confounded: /themself is near-empty because the profile record is missing (a known corpus fact, not a chrome effect), and it shows three chrome layers, not four. Hiding the bottom bar while reading also conflicts with MOB-03 and MOB-09, which treat that bar as the only route to the menu and x-ray.

#### INT-13 · Top chrome never condenses while reading; on phones the live signals hide behind an unlabeled chevron  
*Merged into LAY-02.*

`low` · `ux` · effort M · verdict *confirmed* · lens: Interaction, motion, feedback & states

**Pages:** all

**Observation.** On desktop the full three-row atmosphere tier stays pinned while scrolling, plus the running head and the bottom bar. On phones the tier is collapsed by default, so the site's signature live layer (now playing, vitals, followers, day of life) is hidden behind an unlabeled chevron most visitors will never tap.

**Recommendation** (carried forward in LAY-02). On desktop, fold the atmosphere tier on scroll-down past the hero, keep the running head, and restore the tier on scroll-up or at the top. On mobile, don't add auto-rotation. Show one static secondary signal (e.g. '♪ Killing Time') as a faint second line in the collapsed bar, or let it change only on route change. Give the chevron a small-caps 'ATMOSPHERE' caption until it has been opened once.

**Evidence.**
- state-home-scrolled-deep__desktop__h13.png (atmosphere bar + running head occupy y=0–165 while reading, bottom bar 58 px: about 25% of a 900 px viewport)
- extra/interaction int-dismiss.cjs: top bar stays 130 px when scrolled 3,000 px
- state-chrome-toggle__mobile__h13.png (expanding adds ~250 CSS px of now-playing, followers, day of life and vitals)
- home__mobile__h13__s0.png (collapsed by default; only a 28 px chevron hints at more)
- src/hooks/useChromeBar.jsx:7-21 (mobile default collapsed, desktop expanded)

#### MOB-04 · The back gesture and Android back leave the page instead of closing the open sheet, menu or lightbox

`medium` · `functional` · effort M · verdict *confirmed* · lens: Mobile experience & accessible design (MOB)

**Pages:** all pages (sheets, compass menu), /curating/:channel (lightbox), /creating/:work (lightbox)

**Observation.** Sheets, the compass dock and the lightbox are all full-screen-feeling overlays on a phone, but they aren't part of history. The platform's universal 'get me out of this' gesture (iOS edge-swipe, Android back button or gesture) therefore navigates away from the underlying page. A sheet's open state even carries over onto the previous route.

**Recommendation.** When a sheet, the dock or the lightbox opens, push a shallow history entry with history.pushState({overlay:'info'}, ''). On popstate, close the overlay. When it closes by ×, backdrop or toggle, call history.back() to consume that entry. For the lightbox, also put the image index in the URL (?photo=3) so back closes it and a specific photo can be shared. Close any open panel on route change so a sheet never carries over to the previous page.

**Evidence.**
- Playwright check (Android UA, 390px): on /blogging, open the ⓘ sheet, then history back. The URL becomes '/' and the info sheet is still open over the home page.
- Playwright check: on /curating/weird-dog-photos-only, open the lightbox (3 / 222, as in state-lightbox__mobile__h13.png), then back. The visitor lands on /curating and their place in the 222-image gallery is lost.
- src/components/BottomSheet.jsx: dismissal is only Escape, the transparent backdrop or the ×. There is no history entry or popstate handling, and none in ChromeBar.jsx or ActionDock either (grep finds no pushState/popstate).
- ChromeBar.jsx:613-618: goBack() calls navigate(-1), so the in-bar ← behaves the same way.

#### MOB-06 · Sticky :hover on touch makes a closed toggle look like it is still on

`medium` · `ux` · effort S · verdict *confirmed* · lens: Mobile experience & accessible design (MOB)

**Pages:** all pages (bottom bar), / (hero CTAs, filter sheet)

**Observation.** On touch browsers, :hover stays on the last-tapped element until something else is tapped. Because the bottom bar's 'open' state is just a slightly stronger version of its hover tint, closing a sheet leaves the button looking open, and the visitor can't tell which state they're in.

**Recommendation.** Wrap all decorative hover rules in @media (hover: hover) and (pointer: fine), and keep :focus-visible separate. Give touch a brief :active press (a darker fill for about 100ms). Make the open state a change of shape rather than tint: while a chip's sheet is open, swap its glyph for × (the same × the sheet header uses), so open and closed can't be confused at any hour.

**Evidence.**
- shots/extra/mobile/sticky-hover-info.png: after tap-open then tap-close of ⓘ, the chip keeps its accent tint, accent-soft border and accent glyph, matching its open state in shots/state-info-open__mobile__h13.png.
- Computed background after close: color-mix(accent 14%, page). Open state is 20%, a difference you can't see on a phone.
- ChromeBar.css:536-551: .chrome-nav:hover and .chrome-expand:hover are not wrapped in @media (hover: hover). Only 16 hover-guarded blocks exist site-wide (e.g. ActionDock.css:162, Feed.css:894), so ChromeBar.css, FeedFilters.css and app.css hero CTAs are unguarded.

#### NAV-05 · Bottom toolbar: 7–8 unlabeled icon chips, no desktop tooltips, a "1PM" chip that reads as a clock

`medium` · `ux` · effort S · verdict *confirmed* · lens: Navigation, wayfinding & information architecture · **merges:** MOB-09, INT-11

**Pages:** all pages

**Observation.** Every tool is a 28px square with a hairline border: hour, filter (ListFilterPlus), ⓘ, microscope, print, back, scroll, home, compass. There is no visible text, and on desktop only two show a tooltip. The menu, the main way around the site, is a compass glyph the same size as the others. "1PM" is the US-Eastern hour, so a visitor in London at 6 pm sees "1PM" and reasonably reads it as a clock rather than 'the sky palette you're seeing'. The scrolled-past counter is a bare integer. Setting, meta, mode and page-navigation controls share one visual grammar.

**Recommendation.** At ≥ 60rem, set small-caps word labels beside the icons; there is ample room in the 770px gap: "1 PM SKY · FILTER · ABOUT · INSPECT … BACK · TOP · HOME · CONTENTS". Add title tooltips to every chip at all widths. Render the hour chip as a tiny sky swatch plus "1 PM ET". Give the counter a unit ("69 read"). Add one sentence to the sky sheet ("The whole palette follows the sky in Dame's hourly avatar. Pick an hour to see it."). On phones, keep icons only but separate the tool group from the navigation group with a hairline divider or a wider gap.

**Evidence.**
- home__desktop__h13__s0.png (left chips x≈230–378, right chips x≈1146–1210, ~770px of empty bar between)
- probe INVENTORY: filter, info, back, scroll-jump, home, compass have aria-label but no title; only the sky-hour and x-ray chips have tooltips
- extra/nav/posting-320__mobile.png (8 chips fill the 320px bar edge to edge, bar scrollWidth 323 > 320)
- state-home-scrolled-deep__desktop__h13.png, state-home-scrolled-deep__mobile__h13.png (bare "69" / "65" next to ↑; aria-label 'items scrolled past' only)
- src/components/ChromeBar.jsx:702-712 (chip text = ET skyHourKey), :761-772 (info, no title), :919-928 (scroll count), :1031-1041 (compass, no title)
- src/components/SkyHourSheet.jsx:29-47 (sheet titled only "Time of day" / "Live", no explanation of the palette)

#### MOB-09 · Eight identical unlabeled icon squares: the x-ray microscope, the site's signature feature, is undiscoverable on touch  
*Merged into NAV-05.*

`medium` · `ux` · effort S · verdict *confirmed* · lens: Mobile experience & accessible design (MOB)

**Pages:** all pages (bottom bar)

**Observation.** On a phone, every tool is a wordless glyph. A microscope icon doesn't suggest 'reveal the AT Protocol records behind this page', a filter-plus icon next to an info icon is generic, and a bare number next to an arrow is ambiguous. The site's best idea, x-ray, depends on curiosity and a long scroll through the about sheet.

**Recommendation** (carried forward in NAV-05). Lead with a 'Key' at the top of the ⓘ sheet: each glyph in a 28px square with an italic one-line gloss in the site's voice, separated by hairline rules. If first-visit captions are used, set them at >=12px small caps in floor-contrast ink, shown once (try/catch localStorage) and dismissed on first interaction. Also consider a one-time inline hint near the first ledger row ('⌕ inspect to see the record behind this'). Leave the count-into-scroll-chip merge to MOB-03.

**Evidence.**
- shots/home__mobile__h13__s0.png and posting__mobile__h13__s1.png: '1PM ⫶ ⓘ microscope | 2 ← ↑ ⌂ compass' are all same-size outlined squares. Only the compass is filled.
- ChromeBar.jsx:836-837: the inspect button's only label is aria-label plus title='Inspect — reveal the records under the page'. Touch never shows title tooltips.
- shots/state-info-open__mobile__h13.png: the microscope is explained only in the last paragraph of the ⓘ sheet ('Use the Inspect button (the microscope icon…)'), below the fold.
- ChromeBar.jsx:919-929: the bare '2' / '12' count (aria 'items scrolled past') reads visually like a notification badge.

#### INT-11 · Bottom-bar signals and tools are unlabeled: bare scroll count, missing tooltips, mystery layout toggle  
*Merged into NAV-05.*

`low` · `ux` · effort S · verdict *confirmed* · lens: Interaction, motion, feedback & states

**Pages:** all

**Observation.** When you scroll a feed, a bare number appears next to the ↑ chip. It is the count of items scrolled past, but nothing visible says so and it cannot be hovered. Half the icon chips have tooltips and half don't. Opening the nav menu swaps the left tool cluster for two unlabeled glyph buttons, a global layout setting. Its active state is a solid near-black square that out-shouts the teal compass.

**Recommendation** (carried forward in NAV-05). Set the count as a typographic folio, e.g. '§ 69 / 142' or '69 read', in small caps with a title, and allow pointer events for the tooltip. Add title={aria-label} to every .chrome-nav. In the menu, make the layout control a text segmented control in small caps ('LEDGER | CARDS') under a 'LAYOUT' label, active = accent underline rather than black fill, and show it only on feed routes.

**Evidence.**
- state-home-scrolled-deep__desktop__h13.png / __mobile ('69' and '65' beside ↑ with no label)
- src/components/ChromeBar.jsx:919-928 (count only has aria-label) and ChromeBar.css:811-818 (pointer-events:none, so no tooltip is possible)
- DOM audit: title missing on filter, info, scroll-jump, back, home and compass buttons; present on sky chip, inspect, account
- state-nav-open__desktop__h13.png / __mobile (two unlabeled Table2/Rows2 icons bottom-left; the active one is solid ink, the only black chip in the bar)
- src/components/LayoutToggle.jsx:22-38 (labelled 'Home feed layout' but shown on every page)

#### GAP-04 · The atmosphere bar treats old signals as current, and shows the same signals over every page

`low` · `content` · effort M · verdict *adjusted* · lens: Gap pass (cross-lens)

**Pages:** all pages (top atmosphere bar), /available, /blogging/:slug, /404

**Observation.** The now-playing signal always reads 'LISTENING TO &lt;track>', whether the track is live or was played hours ago (NowPlaying.jsx:31). The age goes only into the hover tooltip, so a morning play still reads as current in the afternoon. The status line already shows its age ('19h ago'). The bar is the same on every page, including /available, but it is compact there and does not visibly compete with the résumé heading.

**Recommendation.** Drive the now-playing label from play.live and the play's age. Use 'listening to' when live, 'last played · 4h' in --ink-muted when it is not live, and hide the row after about 24h. Page-aware variants (a hiring line on /available, sunset/moon on /mothing) can stay optional enhancements through the ChromeBar context.

**Evidence.**
- record-listening__desktop__h13__s0.png: 'Killing Time' was played at 10:40 UTC. Corpus pages captured 15:18–15:21 UTC still read 'LISTENING TO Killing Time', and so do extra/gaps/tz-home-*.png captured ~18:50 UTC, 8 hours later
- src/components/NowPlaying.jsx:17-21 and :31: the 'now playing' vs '3h ago' distinction goes only into the title tooltip, and the visible label is always 'listening to'. src/hooks/useNowPlaying.js:108 already computes live:Boolean(current)
- home__desktop__h13__s0.png / available__desktop__h13__s0.png: the brand line reads 'dame.is playing tennis 19h ago' beside vitals 'stationary · 65 bpm'
- available__desktop__h13__s0.png: a hiring manager's first view of the résumé on desktop is heart rate, calories, ambient dB, battery and follower count above 'Available for hire'
- notfound__desktop__h13__s0.png and blogpost__desktop__h13__s0.png carry the identical bar

**Verification note (adjusted).** NowPlaying always shows 'listening to'; the live/age distinction reaches only the tooltip even though useNowPlaying returns live. The status-tense half is overstated (status already shows its age); vitals freshness is NAV-12; page-aware chrome is an enhancement, not a defect. One cheap label fix, so low.

#### MOB-08 · Controls outside the bottom bar are still undersized, and the one top control sits in the hardest corner to reach

`low` · `accessibility` · effort S · verdict *adjusted* · lens: Mobile experience & accessible design (MOB)

**Pages:** all pages (top chevron, breadcrumb), / (hero CTAs, filter sheet), /mothing

**Observation.** Outside the bottom bar, touch targets are mostly at or above the 24px AA minimum but below the 44px platform guideline. The atmosphere chevron is 28×28 with no coarse-pointer hit extension, and hero CTAs are 35px tall. The one genuine failure is the breadcrumb's root link, a bare 4×19px '/' glyph.

**Recommendation.** Apply the same coarse-pointer ::before hit extension to .chrome-expand, letting it fill the full 58px bar height and extend leftward into empty bar space. Do not repurpose the status line, which is already a link to the logged record. Render the root crumb as a padded 'dame.is' small-caps label, or give the '/' a 44×44 box. Add padding-block so crumbs and hero CTAs reach 44px on (pointer: coarse).

**Evidence.**
- metrics/*__mobile__h13.json targetsUnder44 / targetsUnder24 examples: 'Expand atmosphere bar [28x28]' (every page, top-right), breadcrumb root 'Home [4x19]' (a bare '/' glyph), 'blogging [42x19]' and 'creating [39x19]' crumbs, 'Resume [77x35]', 'Sign the guestbook [35x35]', 'Shuffle hero statement [35x35]', 'Show only replying [35x30]', 'Night of Oct 16, 2026 [137x17]'.
- Probe: a tap 6px outside the chevron hits nothing. ChromeBar.css:528-534 extends only .chrome-nav, not .chrome-expand (ChromeBar.css:492).
- ChromeBar.jsx:436: the root crumb is a link whose only content is '/'.
- shots/state-chrome-toggle__mobile__h13.png: the chevron is the only way to reveal now-playing, followers, day of life and phone vitals on mobile.

**Prior review:** RECOMMENDATIONS §3.5 — fixed for the bottom bar; still open for the top chevron, breadcrumbs and hero CTAs

**Verification note (adjusted).** Most cited targets pass WCAG 2.5.8 AA (24px): the chevron is 28×28 and the hero CTAs are 35px. 19px-tall crumbs with no vertical neighbours pass via the spacing exception. The clear failure is the root crumb, a 4×19px '/' link (ChromeBar.jsx:436), sitting right before the 'blogging' crumb. It is true that .chrome-expand lacks the coarse ::before (ChromeBar.css:528-534 extends only .chrome-nav), and the top-right corner is a poor one-handed reach, so this is polish, not medium. The proposed fix of making the collapsed status line toggle the tier conflicts with existing behaviour: 'playing tennis · 19h ago' is already a link (NowStatus.jsx:34 &lt;Link className="chrome-signal-link">; it appears in metrics as a target).

#### NAV-12 · Atmosphere bar signals need a legend: the vitals row is the only unlabeled row and two signals don't link anywhere

`low` · `ux` · effort S · verdict *confirmed* · lens: Navigation, wayfinding & information architecture

**Pages:** all pages

**Observation.** The status and now-playing signals are labeled and link to their records, but the vitals row (heart rate, calories, ambient dB, battery, activity) has no lead label, no owner and no timestamp. A newcomer can't tell these are Dame's live phone readings, or whether "81%" is battery or something else. "Followed by 6,679 people on Bluesky" and "On day 12,227" are dead text, though both have natural destinations.

**Recommendation.** Give the vitals row the same small-caps lead label as its siblings, with a freshness stamp ("DAME'S PHONE · 4M AGO"), and add title tooltips per vital. Link FOLLOWED BY to the Bluesky profile and ON DAY to /themself or /logging. Consider a one-line legend in the ⓘ sheet that names each row of the bar.

**Evidence.**
- home__desktop__h13__s0.png ("LISTENING TO …", "FOLLOWED BY …", "ON DAY 12,227 OF THEIR LIFE" are labeled; "♡ 65 BPM 🔥53 CAL 🔈65 DB ▭81% stationary" is not)
- state-chrome-toggle__mobile__h13.png (expanded on mobile: 4 rows, ~185 CSS px before the hero)
- src/components/VitalsPanel.jsx:57 ("Current state from Dame's phone" exists only as aria-label on a &lt;div>; no visible label, no freshness time)
- src/components/ProfileStats.jsx:55-62, DayOfLifeTicker.jsx:14-20 (not links)

### Theme 9 — One volume, many hand-built parts

#### GAP-02 · One record, four dates: the site keeps time in three zones, and the day number is one too high in the Americas

`medium` · `content` · effort M · verdict *confirmed* · lens: Gap pass (cross-lens)

**Pages:** all pages (chrome 'On day'), /logging/:rkey and all record pages, / (ledger), /blogging, OG cards

**Observation.** Three clocks run at once. The sky palette, hour chip, mothing nights and Ratioed are Eastern. Ledger times, Today/Yesterday buckets, relative ages and the chrome's day-of-life use the viewer's zone. Long dates use UTC. On top of that, the day-of-life anchor is UTC midnight, rolled back to local midnight, which makes it one day high for everyone west of Greenwich. The result is that a single record page can contradict itself, and the chrome's folio disagrees with the share card.

**Recommendation.** Choose one civil clock for the record: Dame's (America/New_York), which the sky already uses. Route every date, day bucket and day number through one formatter with timeZone 'America/New_York'. Compute dayOfLife from easternDate() as a calendar-day difference and share og/time.js with the client so card and chrome always match. Show the viewer's local time only as a secondary line or tooltip. Label the hour chip '1 PM ET'. Use one relative-age rounding rule everywhere.

**Evidence.**
- extra/gaps/tz-evening-record-NY-3myqkzyynpy23.png (viewer in New York): the status 'letting the possums go on a full moon' (createdAt 2026-10-25T21:28:39-04:00, verified on the PDS) reads '1d ago' at the top right, '2 days ago at 9:28 PM on October 26, 2026 (Day 12,226)' in the body and 'WRITTEN 1D AGO' in the footer, beside chrome 'ON DAY 12,228'. Correct: Oct 25, Day 12,225
- extra/gaps/tz-home-New_York-crop.png 'ON DAY 12,228' vs extra/gaps/tz-home-London.png and every OG card 'day 12,227' at the same instant; (2026-10-27 − 1993-05-07)+1 = 12,227
- src/config.js:10 BIRTHDATE '1993-05-07T00:00:00Z' + src/lib/dayOfLife.js:16-27 toLocalMidnight → May 6 in any UTC− zone (off by one); og/time.js:59-63 computes the same number in UTC
- src/lib/time.js:154-158 formatDateFull uses UTC parts; :190-194 formatTime and :39-78 groupByDay/relativeDay use viewer local; src/pages/Record.jsx:772 mixes both in one sentence
- extra/gaps/tz-home-Tokyo.png: viewer in Tokyo at 2 am sees the '1PM' chip and the daylight palette (Eastern), with the ledger reading 'Today … 1:21 am' (local)
- og/time.js:1 and src/lib/ratioed.js:376 fix the sky, hour chip and Ratioed to America/New_York

#### SYS-01 · No shared Button: about 11 treatments for the same quiet-action role, 27–40px tall

`medium` · `visual` · effort M · verdict *adjusted* · lens: Component system & visual consistency

**Pages:** /, /welcoming, /logging/:rkey, /listening/:rkey, /listening/albums/:album, /creating/ratioed/participants, feed filter sheet, x-ray mode, guestbook sign sheet, lightbox

**Observation.** Quiet hairline actions are drawn at about 7 heights (27–40px), 2 sizes (12/14px) and 4 casings, with 3 hover behaviours (one of them a phantom --surface-soft wash that paints nothing). There are four separately styled 'load more' buttons. 'Primary' is accent-darkened on the hero and ink-black on Sign in, and disabled is an opacity-0.5 grey slab. All of them still read as square hairline boxes, so this is inconsistency rather than lost affordance. It is most visible where two families sit together, as on /listening/:rkey and the x-ray card/HUD.

**Recommendation.** Create one Button primitive (styles/controls.css plus a tiny Button.jsx). Base: .btn = 1px var(--rule) hairline, transparent fill, serif --text-sm (14px) in sentence case with 0.02em tracking, height var(--control-h-md, 2.25rem), padding-inline 0.875rem. Hover: --wash-hover background, --accent-soft border, --accent text. Focus-visible: 2px accent outline with 2px offset. Modifiers: .btn--primary (color-mix(accent 90%, #000) fill with --page text, at most one per view), .btn--sm (28px, 12px, for record actions, x-ray and in-table 'more'), .btn--text (inline 'open in explorer →'), .btn--icon (square, equal to its height). Disabled keeps the outline, switches to a 1px dashed border with --ink-faint text and drops the opacity hack. Then map hero CTAs, Sign guestbook, music links, record actions, x-ray DETAILS / open-in-explorer, all four load-more buttons and sign-in onto it. Keep small caps for labels, not for actions.

**Evidence.**
- extra/sys/button-zoo.png
- record-listening__desktop__h13__s0.png (37px 'Open in Apple Music' directly above 31px 'Open in…' / 'Inspect Data')
- state-xray-on-blogpost__desktop__h13.png ('open in explorer' lowercase ~26px next to 'DETAILS ↗' uppercase 28px)
- state-guestbook-sign__mobile__h13.png (grey 50%-opacity 'SIGN IN TO SIGN' slab)
- Measured heights: 27 participants segmented / 29 'more' / 31 record actions / 33 'Sign guestbook' / 35 hero CTA / 37 music links / 40 'Earlier signatures'
- src/styles/app.css:226-269 (hero CTA, 14px, 0.02em, hover = 8% wash)
- src/pages/Record.css:49-68 (12px, 0.06em, hover with no wash)
- src/components/Feed.css:665-682 (14px, hover uses undefined --surface-soft, so it is transparent; radius fallback 8px at :669)
- Four 'load more' buttons: Feed.css:978, Guestbook.css:377, RatioedParticipants.css:184, blocks/RatioedBlock.css:94
- src/components/SignInPanel.css:31-56 (primary = INK fill, small caps 0.18em; disabled = opacity .5)
- src/components/FeedFilters.css:161-185 (dashed border), Lightbox.css:215-228 (filled close)
- JSX: ~114 public &lt;button> elements across ~59 class roots (335 / 104 site-wide including admin)

**Prior review:** RECOMMENDATIONS §9.2 — still open

**Verification note (adjusted).** The observation holds up. record-listening__desktop__h13__s0.png shows 37px sentence-case 'Open in Apple Music / Search on Spotify' about 50px above 31px tracked 'Open in… / Inspect Data'. state-xray-on-blogpost shows lowercase 'open in explorer' beside uppercase 'DETAILS ↗', and state-guestbook-sign shows the grey 50%-opacity slab. The code matches: app.css:226-269 (14px, 0.02em, 8% wash), Record.css:49-68 (12px, 0.06em, no wash), Feed.css:665-682 (hover on the undefined --surface-soft, so no fill). The four load-more buttons all differ: Feed 0.08em with a 6% wash, Guestbook small caps 0.18em on --rule-soft, Participants small caps 0.14em at 12px, RatioedBlock 0.14em. Signin-button is ink-filled with opacity .5 when disabled. Severity is overstated, though. Every variant still reads as a square hairline box, so the 'is this a button' signal survives and no task is blocked. The drift sits mostly across different pages, and the prior review rated the same issue (§9.2) medium. The recommendation stays serif, square and hairline, so it fits the identity.

#### SYS-02 · 'Selected' has five visual grammars, and the compass's open state drops to 2:1

`medium` · `visual` · effort M · verdict *adjusted* · lens: Component system & visual consistency · **merges:** MOB-11

**Pages:** bottom bar (all pages), nav menu sheet, /listening, /logging, /listening/albums, /creating/ratioed/participants, /exploring, feed filter sheet

**Observation.** 'Selected/on' is drawn at least four ways: a solid --accent fill (the listening, logging and albums segmented controls, which are three identical CSS copies), a near-black ink fill (the layout toggle), a pale --accent-soft fill (the compass while the nav is open), and an accent wash with or without an accent hairline (toolbar toggles, filter chips, DEFAULTS, participants). Exploring adds an underline, and the quick pills mark idle with a dashed border. The open compass puts a --page glyph on --accent-soft at 2.03:1 at 1pm, below the 3:1 non-text minimum and against ChromeBar.css's own comment.

**Recommendation.** Add two state tokens to theme.css: --wash-selected: color-mix(in srgb, var(--accent) 16%, var(--page)) and --sel-rule: var(--accent). Use one selected state everywhere (background --wash-selected, 1px --sel-rule border, --accent text or glyph) for segmented options, open toolbar toggles, filter chips, quick pills and the layout toggle. Reserve solid fill for 'primary action' only. For the compass when open, keep the darkened fill and add an inset 2px --page ring, or switch to the selected wash with an accent glyph; never use --accent-soft behind a --page glyph. Extract &lt;Segmented options value onChange> (role=group, aria-pressed) from the three identical copies plus the participants fork, and make idle quick pills solid hairlines like everything else.

**Evidence.**
- extra/sys/selected-states.png
- state-nav-open__mobile__h13.png (layout toggle selected = near-black ink fill; compass open = pale #35c4ca fill)
- state-nav-account__mobile__h13.png (account toggle = wash + accent border)
- state-filters-open__mobile__h13.png (DEFAULTS = wash + accent border; SHOW ALL / NONE = dashed; chip on = wash, off = page)
- listening__mobile__h13__s0.png (7 DAYS = solid dark accent fill)
- ratioed-participants__desktop__h13__s0.png (PIECES = 16% wash with no accent border)
- Compass open glyph: --page #f0fcfe on --accent-soft #35c4ca = 2.03:1 (pixel-sampled)
- src/components/ChromeBar.css:677-681 (.is-open → --accent-soft), contradicting its own comments at :660-661 and :671-672
- src/components/LayoutToggle.css:27-31 (ink fill)
- Byte-identical tab blocks: ListeningStats.css:33-57, StateStats.css:31-55, Albums.css:59-83
- src/pages/RatioedParticipants.css:25-47 (fourth segmented variant), Exploring.css:97-114 (underline tabs)
- src/components/FeedFilters.css:180-185, 196-199; ChromeBar.css:553-557 (accent 20% into page)

**Prior review:** RECOMMENDATIONS §3.4 — partially fixed (rest/hover now darken; the compass open state still lightens to --accent-soft)

**Verification note (adjusted).** The core claims are verified. ChromeBar.css:677-681 sets .is-open to --accent-soft behind a --page glyph. I pixel-sampled the compass on state-nav-open__mobile at #35c4ca, and #f0fcfe on it computes to 2.03:1, which fails 1.4.11. LayoutToggle.css:27-31 gives an ink fill, which shows as a near-black chip in the bottom bar. The ListeningStats, StateStats and Albums tab blocks are identical apart from the class name. Participants uses --highlight and Exploring an underline; the filter quick pills use a dashed idle and a solid selected border. Two corrections: (a) the 'compass at rest' is a primary-action fill, not a selected state, so listing it as one of the 'selected' grammars mixes two roles; (b) the segmented selected fill is plain --accent, not a darkened one, and measures 5.1:1 at 1pm, so it passes. Severity is lowered because the open-compass failure only occurs while the menu is visibly open and the toggle is still findable. It is a contrast and consistency defect, not a blocked task.

#### MOB-11 · The compass's open state drops its glyph to 2.0:1  
*Merged into SYS-02.*

`low` · `accessibility` · effort S · verdict *confirmed* · lens: Mobile experience & accessible design (MOB)

**Pages:** all pages (compass menu open)

**Observation.** The resting compass is a dark accent fill, and hover now darkens rather than lightens (a fix from the prior review). The open state, however, still lightens to --accent-soft, so the button that now closes the menu becomes the faintest control in the bar.

**Recommendation** (carried forward in SYS-02). Keep the resting dark fill when open and show the state with an inset 2px --page ring, or swap the compass glyph for × on the same dark fill (consistent with MOB-06).

**Evidence.**
- shots/state-nav-open__mobile__h13.png and shots/extra/mobile/nav-open-compass.png: the open compass is a light teal square with a near-white glyph.
- Measured: background rgb(53,196,202) (--accent-soft) with glyph rgb(240,252,254) (--page). That is 2.03:1 at 13h and 2.79:1 at 19h, below the 3:1 non-text minimum (WCAG 1.4.11).
- ChromeBar.css:678-682 (.chrome-nav-bottom.is-open → --accent-soft), right below the hover rule that was deliberately changed to darken for AA.

**Prior review:** RECOMMENDATIONS §3.4 — hover fixed; the compass's open state still lightens to --accent-soft

#### SYS-03 · Seven different stat-block patterns for 'number + label'

`medium` · `visual` · effort M · verdict *adjusted* · lens: Component system & visual consistency · **merges:** LAY-06, COL-07, IDN-11

**Pages:** /listening, /logging, /mothing, /mothing/:night, /listening/albums, /listening/albums/:album, /exploring, /creating/ratioed/:n, /creating/ratioed/participants

**Observation.** There are six stat-block grammars, not seven, because /mothing and /mothing/:night share .mothing-stats. They are: boxed centred accent-600 tiles with the label below (listening, logging, as two copied stylesheets); an open row of ink numerals with an accent label below (mothing, mothing night); an open row of accent-600 numerals (albums); boxed cards with the label above (exploring); a stacked dl (album); and a ruled grid with lowercase labels (ratioed piece and participants). Label position, value colour and tracking (0.10, 0.12, 0.14, 0.16em) all flip between pages. Concrete costs: '463' rides about 11px high on /listening, and /exploring at 390px spends about 535px on five figures.

**Recommendation.** Build one &lt;Figures> primitive in DocumentMeta's grammar: small-caps eyebrow label above (12px, 0.14em, --ink-muted), value below (serif --text-2xl, weight 500, tabular-nums, --ink; accent only when the figure is a link), and an optional note (--text-xs italic --ink-muted). Use align-items: start so sub-lines never move values. Two layouts: 'inline' (open colophon row, gap --space-6, for page heads: mothing, albums, mothing night, album) and 'ruled' (DocumentMeta-style band with top and bottom hairlines and vertical rules between cells, no outer box, for listening, logging, exploring, ratioed). On phones, 'ruled' wraps 2-up. Delete the five per-page tile stylesheets.

**Evidence.**
- extra/sys/stat-zoo.png (patterns A–G side by side)
- listening__desktop__h13__s0.png ('463' sits ~12px above its neighbours because the '≈ 7.7 hrs' sub-line lifts it in a centred tile)
- exploring__mobile__h13__s1.png (5 full-width boxed cards ≈ 535 CSS px tall, vs listening__mobile__h13__s0.png fitting 5 figures in a 2-up grid ≈ 251px)
- mothing__desktop__h13__s0.png, albums__desktop__h13__s0.png, mothing-night__desktop__h13__s0.png, album__desktop__h13__s0.png, ratioed-piece__desktop__h13__s0.png, ratioed-participants__desktop__h13__s0.png
- src/components/ListeningStats.css:67-110 and StateStats.css:65-104 (same boxed tile, copied)
- src/pages/Mothing.css:3-27 (ink 400, accent label, 0.16em) vs src/pages/Albums.css:14-41 (accent 600, 0.12em)
- src/components/ExploringHome.css:48-90 (label above, boxed)
- src/pages/ListeningAlbum.jsx:128-180 (dl.album-facts, stacked)
- src/pages/RatioedPiece.css:55-71 (ruled grid, lowercase labels)

**Verification note (adjusted).** The visual evidence checks out in stat-zoo.png and the page captures. On listening__desktop, '463' sits about 11px above its neighbours because of the '≈ 7.7 hrs' sub-line. On exploring__mobile__s1, five full-width boxed cards run to about 535 CSS px, against about 251px for the listening 2-up grid. The ratioed piece mobile capture shows a small-caps DocumentMeta band directly above lowercase 'the ratio / reaction' labels. The count is overstated: patterns B (/mothing) and D (/mothing/:night) are the same component, since both Mothing.jsx:190 and MothingNight.jsx:146 render section.mothing-stats. That makes six grammars, not seven. 'High' is also too strong: the stat blocks are inconsistent and in places wasteful (exploring mobile), but no primary task is harmed. The DocumentMeta-grammar recommendation is on-brand.

#### LAY-06 · Five different 'figures' (stat block) idioms, with numerals off a shared baseline  
*Merged into SYS-03.*

`medium` · `visual` · effort M · verdict *confirmed* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** /listening, /logging, /exploring, /mothing, /mothing/:night, /listening/albums, /listening/albums/:album, /creating/ratioed/*

**Observation.** Summary numbers are drawn five ways. (1) Boxed, centred tiles in a 1px-gap grid (listening, logging). (2) Separate bordered cards with the label above the number (exploring). (3) Open numerals with small-caps labels beneath, in ink (mothing) or accent bold (albums). (4) A vertical definition list (album). (5) A ruled table of label, numeral and note (Ratioed). In the boxed tiles the content is vertically centred, so the one tile with a sub-note pushes its numeral 12px above its neighbours. On phones the 5-up tiles become 2-2-1 with a full-width orphan, using about 30% of the screen.

**Recommendation** (carried forward in SYS-03). Standardise on one 'figures' component modelled on the Ratioed table: hairline-ruled cells, small-caps label, numeral on a shared baseline (justify-content: start with a fixed numeral row), optional note line. Columns auto-fit at ≥10rem. On mobile use 3-up for short numerals, or a single typeset line ('126 plays · 463 min · 102 tracks · 36 artists · 38 albums') rather than 2-2-1. Fill a trailing partial row with ruled empty cells only if they don't exceed one, or let the last cell span.

**Evidence.**
- listening__desktop__h13__s0.png: boxed 5-up tiles, centred accent numerals; the '463 MINUTES ≈ 7.7 hrs' numeral sits at y≈441 vs y≈453 for its siblings
- listening__mobile__h13__s0.png, logging__mobile__h13__s0.png: 2-2-1 grid with an orphan full-width last tile, ~252px tall for 5 numbers
- exploring__desktop__h13__s0.png / exploring__mobile__h13__s1.png: separate boxed cards with label above
- mothing__desktop__h13__s0.png, mothing-night__desktop__h13__s0.png: open numerals with small-caps labels; albums__mobile__h13__s0.png: accent-bold numerals, '103 hr 33 min' wraps alone to a second row
- album__desktop__h13__s0.png: vertical label/value list
- ratioed-participants__desktop__h13__s0.png, ratioed-piece__desktop__h13__s0.png: ruled open table with label, numeral and note (and 3 empty ruled cells after 'too late')
- ListeningStats.css:67-86 (justify-content: center), ListeningStats.css:262-275 and StateStats.css:310-314 (last tile spans the row), ExploringHome.css:48-63

#### COL-07 · Seven different 'figures/tally' treatments across stat-bearing pages  
*Merged into SYS-03.*

`low` · `visual` · effort M · verdict *adjusted* · lens: Collection, gallery & detail pages

**Pages:** /listening, /listening/albums, /listening/albums/:album, /mothing, /mothing/:night, /exploring, /creating/ratioed/:take, /creating/ratioed/participants

**Observation.** Numbers are a recurring motif (plays, moths, takes, collections), but every page invents its own presentation: boxed or open, centered or left, accent or ink, weight 400 or 600, label above or below, lowercase or tracked caps. On mobile, /listening's 5 tiles wrap to 2+2+1 and /exploring's to five full-width boxes.

**Recommendation** (carried forward in SYS-03). Create one tally component in the book idiom. Old-style or tabular Crimson numerals in ink at text-2xl, weight 400. A small-caps label below in accent. Hairline vertical rules between cells, no boxes, left-aligned. An optional one-line note (Ratioed's annotated variant). It wraps 2-up on phones, and its column count is chosen so the last row never leaves empty bordered cells (3 or 5 columns, or let the last cell span). Use it on listening, albums, mothing, night, exploring and Ratioed.

**Evidence.**
- listening__desktop__h13__s0.png: 5 boxed, centered tiles, bold 600 accent numerals (src/components/ListeningStats.css:66-98)
- albums__desktop__h13__s0.png: unboxed, left-aligned, bold accent numerals with a rule below (src/pages/Albums.css:14-41)
- mothing__desktop__h13__s0.png: unboxed, regular-weight ink numerals, accent labels (src/pages/Mothing.css:3-27)
- exploring__mobile__h13__s1.png: separate bordered cards, label above value, hover lift (src/components/ExploringHome.css:48-87)
- ratioed-piece__desktop__h13__s0.png and ratioed-participants__desktop__h13__s0.png: hairline dl grid with lowercase label above and a note below. Participants' 9 cells in a 4-column grid leave 3 empty bordered cells
- mothing-night__desktop__h13__s0.png: large '#29 15 13 8:34pm–10:39pm' with tiny labels; album__desktop__h13__s0.png: label-above facts stacked in a sidebar

**Verification note (adjusted).** The observation is accurate. /listening uses boxed, centered numerals in bold accent at weight 600 (ListeningStats.css:66-98). /albums uses open, left-aligned bold accent numerals (Albums.css:29-36). /mothing uses regular-weight ink numerals with accent labels (Mothing.css:16-27). /exploring uses bordered cards. Ratioed uses a hairline dl grid. ratioed-piece s1 adds yet another row (replies/reposts/quotes/likes/people). But each page is coherent on its own, and visitors seldom compare stat blocks across pages, so this is cross-page polish rather than friction. The point about empty cells on the participants grid repeats COL-12. Severity lowered to low.

#### IDN-11 · Stats and metadata use three different visual systems where the reference doc uses one colophon strip  
*Merged into SYS-03.*

`low` · `visual` · effort M · verdict *confirmed* · lens: Visual identity & aesthetic

**Pages:** /listening, /logging, /exploring, /mothing, /mothing/*, /listening/albums, /blogging/*, /creating/*

**Observation.** 'Page-number-style metadata' is part of the brief, but the site has at least three stat and metadata treatments that vary in boxes vs hairlines, label above vs below, and accent vs ink numerals. The admin-directions doc, in the same visual language, uses one consistent strip, which is why it reads as more polished.

**Recommendation** (carried forward in SYS-03). Make one 'colophon strip' component: a hairline above and below; a small-caps label above in ink-faint (once IDN-02 fixes its contrast); serif tabular numerals in ink (not accent; keep accent for links and actions); no boxes; columns separated by space or a vertical hairline. Use it for Listening, Logging, Exploring, Mothing, Albums and the document header band.

**Evidence.**
- listening__desktop__h13__s0.png, logging__desktop__h13__s0.png, exploring__desktop__h13__s0.png: boxed 5-up tiles, accent numerals, small-caps labels below
- mothing__desktop__h13__s0.png, mothing-night__desktop__h13__s0.png: unboxed ink numerals with tiny labels below
- albums__desktop__h13__s0.png: unboxed accent numerals
- blogpost__desktop__h13__s0.png, ratioed__desktop__h13__s0.png: a label-above, hairline-celled header band
- extra/identity/admindoc-0.png: one stat strip (letterspaced small-caps label above, serif numeral below, hairline above)

#### SYS-05 · Small-caps labels and section headings have no tiers: 26 rendered sizes, 4 heading styles for one role

`medium` · `visual` · effort M · verdict *confirmed* · lens: Component system & visual consistency · **merges:** TYP-09

**Pages:** /welcoming, /reposting/:rkey, /listening, /exploring, /available, /creating/ratioed/:n, /creating/ratioed, /creating/ratioed/participants

**Observation.** 'Section title inside a page' is drawn four ways. (1) Serif sentence-case h2 with a hairline ('Today', 'Recent listening', 'Replay'). (2) A 12–14px small-caps eyebrow ('TOP TRACKS', 'EXPERIENCE', 'IDENTITY', 'RECORD TYPES I MADE'). (3) 28px bold small caps ('36 SIGNATURES', because .small-caps is put on an h2 and inherits its size). (4) 22px small caps ('REPLIES', exploring group titles). Labels below 12px come in a dozen near-identical sizes, mostly from ad-hoc rem values in the Ratioed blocks and the chrome.

**Recommendation.** Add one token, --text-2xs: 0.6875rem (11px), as the floor, and remove everything below it. Define two classes. .eyebrow = 12px all-small-caps, 0.14em, --ink-muted, weight 400, for labels, sheet titles, metadata keys and table heads. .section-head = serif --text-xl, weight 600, sentence case, with an optional right-aligned .eyebrow meta and a 1px --rule below; this is the existing 'Today · 23 items' pattern. Map 'Signatures', 'Replies', 'Top tracks', 'Identity' and 'Record types I made' onto these two. Put .small-caps on a span, never on an h2/h3. Add a stylelint rule that rejects raw rem/px font-size and letter-spacing outside theme.css.

**Evidence.**
- metrics/*__desktop__h13.json: 26 distinct rendered font sizes site-wide; 13 of them between 9.28px and 12.6px (9.28, 9.92, 10.0, 10.37, 10.6, 11.04, 11.2, 11.22, 11.4, 11.52, 12, 12.54, 12.6); ratioed 14 sizes, participants 13
- CSS: 61 distinct font-size values, 121 of 737 declarations bypass --text-*; 18 letter-spacing values; 97 all-small-caps declarations
- welcoming__desktop__h13__s0.png: '36 SIGNATURES' = h2.small-caps → 28px, weight 600 (src/pages/Guestbook.jsx:280, Guestbook.css:131-136)
- record-reposting__desktop__h13__s0.png: 'REPLIES' 22px small caps (src/components/Comments.css:7-13)
- listening: 'TOP TRACKS' 12px weight 600 (ListeningStats.css:123); exploring: 'IDENTITY' 14px weight 600 0.18em (ExploringHome.css:29), group titles 22px (ExploringHome.css:246)
- ratioed-piece__desktop__h13__s0.png: small-caps 'POSTED / STOOD FOR' band directly above lowercase 'the ratio / reaction' labels
- Sub-xs sizes: RatioedParticipants.css:77 (0.58rem = 9.3px), blocks/RatioedBlock.css:171,183,237,323,338,443,652 (0.58–0.62rem), ChromeBar.css:567 (0.72rem)

**Prior review:** RECOMMENDATIONS §9 (Low: 33 font-sizes bypass the scale) — still open

#### TYP-09 · Section headings use eight different styles: '36 SIGNATURES' at 28px tracked caps, 'Recent state' at 22px, 'TOP TRACKS' at 12px  
*Merged into SYS-05.*

`medium` · `visual` · effort M · verdict *confirmed* · lens: Typography & reading experience

**Pages:** /welcoming, /logging, /listening, /available, /blogging/:slug, /listening/albums/:slug, /exploring

**Observation.** There is no single section-heading voice. Equivalent structural levels are set loud on one page and whisper-small on the next. The guestbook count heading is the loudest text on its page after the H1, while the résumé's 'Experience' is a 14px label.

**Recommendation** (carried forward in SYS-05). Adopt three tiers. Section (H2) is 22px semibold sentence case over a hairline ('Recent listening', 'Signatures', 'Replies', 'Experience'). Panel or sub-section (H3) uses the single .label style from TYP-05. Counts move out of the heading into right-aligned metadata ('Signatures' at the left, '36' in tabular figures at the right), matching the day-header pattern ('Today … 23 items').

**Evidence.**
- welcoming__desktop__h13__s0.png ('36 SIGNATURES': h2 at 28px, synthesized small caps, 0.05em)
- logging__desktop__h13__s0.png ('Recent state' 22px sentence case; 'HEART RATE' 12px small caps 0.14em)
- listening__desktop__h13__s0.png ('Recent listening' 22px; 'TOP TRACKS' 12px)
- available__desktop__h13__s0.png ('EXPERIENCE' 14px small caps 0.05em)
- extra/typography/blog-replies-desktop.png ('REPLIES' 22px small caps 0.18em)
- album__desktop__h13__s0.png ('TRACKS PLAYED' 12px)
- heading inventory (heads.cjs): section-level heads appear at 12/14/22/28px × sentence-case/small-caps × 0.05/0.12/0.14/0.18em
- Guestbook.css:131-136 adds small-caps and 0.18em but inherits the global h2 28px (typography.css:18)

#### SYS-08 · /listening's own cover thumbnail lacks AlbumCover's error fallback and shows broken-image glyphs

`medium` · `functional` · effort S · verdict *confirmed* · lens: Component system & visual consistency · **merges:** IDN-09

**Pages:** /listening

**Observation.** ListeningStats defines its own Cover instead of reusing AlbumCover. When the resolved thumbnail URL fails, the browser's broken-image glyph appears inside the cyan square. AlbumCover already handles this case with an empty-state class. The bug was observed on desktop in the corpus; the same rows rendered fine on mobile, so it is intermittent and depends on the art source.

**Recommendation.** Replace the local Cover with AlbumCover, or generalise it into a shared &lt;Thumb> with loading, empty and error states. Use the same component for album shelf cells, record pages, listen rows, moth ledger thumbs and link-card thumbnails.

**Evidence.**
- listening__desktop__h13__s0.png (Top tracks #1 'Killing Time', #5 'Cry for Me' and Top albums #1 'Imaginal Disk' show Chromium's broken-image icon)
- extra/sys/listening-cover-crop.png
- src/components/ListeningStats.jsx:188-195 (local Cover: plain &lt;img>, no onError)
- src/components/AlbumCover.jsx:60-90 (onError → .album-cover-empty)

#### IDN-09 · Album art fails to the browser's broken-image glyph on /listening  
*Merged into SYS-08.*

`low` · `functional` · effort S · verdict *adjusted* · lens: Visual identity & aesthetic

**Pages:** /listening

**Observation.** The ranked-list Cover() helper on /listening (ListeningStats.jsx:188-195) renders the resolved artwork URL with no onError fallback. When an artwork request fails transiently, as it did in the main corpus capture, the browser's broken-image glyph appears. The shared AlbumCover component already handles this case. The covers resolve normally in a later capture and a fresh probe.

**Recommendation** (carried forward in SYS-08). Give Cover() the same onError → empty-square fallback as AlbumCover, or reuse AlbumCover at size 100. Design the empty square as an 'unillustrated record' plate instead of a gradient: a hairline circle with a centre dot (a vinyl label) in ink-faint on --rule-soft.

**Evidence.**
- listening__desktop__h13__s0.png: top tracks 'Killing Time', 'Cry for Me' and top album 'Imaginal Disk' show the broken-image icon
- extra/identity/listening-art-zoom.png (zoom)
- src/components/ListeningStats.jsx:188-195: Cover() renders &lt;img> with no onError
- src/components/AlbumCover.jsx: already tracks a `broken` URL and falls back to the empty square, with a comment explaining why

**Verification note (adjusted).** The broken-image glyph in listening__desktop__h13__s0.png was transient. A later capture (extra/collections/listening-wait__desktop.png) shows every Top Tracks and Top Albums cover loaded, including Killing Time, Cry for Me and Imaginal Disk. A fresh Playwright probe I ran found all listen-rank-cover images complete with naturalWidth > 0 and no failed image requests. The code gap is real: ListeningStats.jsx:188-195 Cover() has no onError, while AlbumCover.jsx:30-77 guards against exactly this. A visitor on a flaky connection or hitting an mzstatic hiccup would see the browser glyph. It is not a persistent failure, so low.

#### SYS-09 · Token layer has gaps (undefined, ad-hoc, misused), so components invent values

`medium` · `visual` · effort S · verdict *adjusted* · lens: Component system & visual consistency

**Pages:** /creating/:work, /listening/albums/:album, guestbook sign sheet, all

**Observation.** Beyond the drift covered in SYS-01, 02, 04 and 05, the token layer has silent failures. --text-md is undefined, so Leaflet h4–h6 and the link-card title inherit body size. --surface-soft/-2/-3 are undefined, so the music-link hover paints nothing and the blocks fall back to hard-coded rgba. The sign-in error uses --tan, which tracks the accent hue most hours, so an error reads as ordinary accent text. There are 19 ad-hoc breakpoint widths, though no capture shows a resulting broken tablet state.

**Recommendation.** Define --text-md (or replace its uses with --text-lg/--text-base). Switch .signin-error to --danger. Resolve the phantom --surface-* references with a selector-scoped nest-mix class rather than :root tokens (see SYS-04). Add --wash-hover/--wash-selected; plain accent-into-page mixes are safe on :root only if the sky studio never re-themes --accent/--page in a subtree, otherwise scope them like the nest mix. Consolidate breakpoints to two documented values; use a comment table, or add postcss-custom-media if build-time names are wanted. Add stylelint with declaration-property-value allow-lists for font-size, letter-spacing and border-radius.

**Evidence.**
- --text-md used but undefined: src/components/LeafletDocument.css:42 (document h4–h6) and :188 (link-card title)
- --surface-soft undefined: ChromeBar.css:373, Feed.css:681 (music-link hover is transparent), Comments.css:142; --surface-2/-3 undefined: blocks/blocks.css:169,176,295,339,391
- 12 accent-wash strengths for hover/selected: 4, 5, 6, 8, 10, 12, 14, 16, 20, 30, 52% plus --highlight
- Literal radii: Feed.css:669 var(--radius-2, 8px); Feed.css:35,57,477,507 (4px owner marks); SearchSheet.css:93 (3px kbd); blocks.css:575 (6px)
- src/components/SignInPanel.css:62 sign-in error in --tan, although theme.css:22-30 documents that --tan ≈ --accent most hours and added --danger for this
- 19 distinct media-query widths (480, 540, 544, 560, 600, 639, 640, 700, 701, 720, 760, 54rem, 46rem, 40rem, 60rem, 1000, 1080…)

**Prior review:** RECOMMENDATIONS §9.1 and §9.3 — still open

**Verification note (adjusted).** The specific defects are verified. --text-md is undefined (LeafletDocument.css:42, :188), so h4–h6 and the link-card title fall back to inherited size. --surface-soft and -2/-3 are undefined (ChromeBar.css:373, Feed.css:681, Comments.css:142, blocks.css). SignInPanel.css:62 paints the error in --tan, the exact case theme.css:24-31 says --danger was added to avoid. There are 11 accent-wash strengths from 4% to 52% plus --highlight, and 19 media-query widths. However, much of this finding restates SYS-01, 02, 04 and 05 (washes, control heights, surface levels, --text-2xs). The claim that tablet widths show 'half-mobile, half-desktop states' is not evidenced by any capture. The recommendation also has two problems. --surface-1..3 on :root conflicts with theme.css:227-230 (see SYS-04). @custom-media needs a PostCSS plugin the repo doesn't have: there is no postcss config, and custom properties can't be used in media queries.

#### TYP-10 · Dates and times appear in five absolute formats, and two relative rounding rules contradict each other on the same page

`medium` · `content` · effort M · verdict *confirmed* · lens: Typography & reading experience · **merges:** COL-08, SYS-11

**Pages:** /blogging, /blogging/:slug, /creating, /listening/albums/:slug, /creating/ratioed, /mothing, /logging/:rkey

**Observation.** Absolute dates appear as 'January 29, 2025', 'Jan 29, 2025', '22 June 2026', 'Oct 16, 2026' and ISO '2025-06-17'. Times appear as '3:17 pm', '10:39pm' and '9:36 PM'. Relative times are used even where they erase information: a contents page of seven essays where six say '1y ago'.

**Recommendation.** Write one formatter module and a short house style. Long date 'January 29, 2025'; short 'Jan 2025' for ToC and list columns; time '3:17 pm' with a space and lowercase; ISO only inside x-ray and raw data. Use relative phrasing only under 30 days, and absolute otherwise. Make Elapsed and the footer use the same rounding.

**Evidence.**
- blogpost__desktop__h13__s0.png ('Elapsed: 2 years ago') vs blogpost__desktop__h13__bottom.png ('WRITTEN 1Y AGO', reply '1y ago') for the same Jan 29, 2025 record
- time.js:16-28 relativeTime floors (1.74 y → '1y') vs time.js:73-95 relativeDay rounds (→ '2 years')
- blogging__desktop__h13__s0.png (6 of 7 ToC rows read '1y ago')
- creating__desktop__h13__s0.png ('projects from the past two decades', most dated '1y ago')
- album__desktop__h13__s0.png ('22 June 2026')
- ratioed__desktop__h13__s2.png ('2025-06-17')
- blogpost__mobile__h13__s0.png ('Jan 29, 2025')
- mothing__desktop__h13__s0.png ('10:39pm') vs home ('3:17 pm') vs record-logging__mobile__h13__s0.png ('9:36 PM')

#### COL-08 · Dates are relative where the year matters, and long-date formats vary by page and viewport  
*Merged into TYP-10.*

`medium` · `content` · effort S · verdict *confirmed* · lens: Collection, gallery & detail pages

**Pages:** /creating, /blogging, /creating/ratioed/:take, /listening/albums/:album, /creating/:slug

**Observation.** Index pages use relative age as the only date, which collapses a two-decade portfolio and a year of essays into identical '1y ago' labels. Detail pages mix US long dates, day-month dates, ISO dates (on mobile only for Ratioed) and raw UTC timestamps, sometimes next to each other (album FIRST absolute / LAST relative).

**Recommendation** (carried forward in TYP-10). Adopt a date style rule. Index folios show the year on /creating ('2011') and the full date on /blogging ('October 14, 2025'), in old-style figures. Relative time appears only for things under about a week old, or as a secondary muted line. Use one long format site-wide (formatDateFull, 'June 22, 2026') and retire formatDateLong. Pair absolutes on detail pages ('first heard June 22 · last heard Sep 29'). Keep ISO and Z timestamps for x-ray and the Provenance block only, identical across viewports.

**Evidence.**
- creating__desktop__h13__s0.png / s1: 7 of 21 works read '1y ago'; the portfolio's oldest reads '15y ago' (src/pages/Creating.jsx:168)
- blogging__desktop__h13__s0.png: 6 of 7 posts read '1y ago' (src/pages/Blogging.jsx:80)
- ratioed-piece__desktop__h13__s0.png 'Oct 27, 2026' vs ratioed-piece__mobile__h13__s0.png '2026-10-27' for the same POSTED field
- album__desktop__h13__s0.png: FIRST '22 June 2026' (day-month, src/lib/time.js:145-149 formatDateLong) next to LAST '4 wks' (relative), src/pages/ListeningAlbum.jsx:132-133
- creating-work-software__desktop__h13__s0.png 'January 1, 2026' (time.js:155 formatDateFull); ratioed-piece__desktop__h13__s2.png Provenance '2026-10-27 01:00:52Z'; listening__desktop__h13__s1.png 'October 24, 2026'

#### SYS-11 · Time and date formatting has no single primitive: 3 clock styles and 5 date styles  
*Merged into TYP-10.*

`low` · `content` · effort S · verdict *confirmed* · lens: Component system & visual consistency

**Pages:** /, /mothing, /mothing/:night, /listening/albums/:album, /creating/ratioed, /creating/ratioed/:n, /blogging/:slug, bottom bar

**Observation.** Clock times appear with and without a space before am/pm, and in uppercase on the hour chip. Dates appear day-first ('22 June 2026'), US long ('June 27, 2025'), abbreviated ('Oct 27, 2026'), short ('Jan 29, 2025') and ISO ('2026-10-27', mono, on phones only). The same DocumentMeta band switches to ISO on Ratioed pieces but not on blog posts.

**Recommendation** (carried forward in TYP-10). Use one &lt;Time variant='clock|date|dateShort|relative'> backed by lib/time.js, and delete the mothing formatter. House style: '10:39 pm'; 'June 27, 2025' long and 'Jun 27, 2025' short; ISO only in x-ray and code contexts. Render the hour chip as small caps '1 pm' to match.

**Evidence.**
- home__desktop__h13__s0.png '3:17 pm' vs mothing__desktop__h13__s0.png '10:39pm' vs bottom-bar chip '1PM'
- album__desktop__h13__s0.png 'FIRST 22 June 2026' (formatDateLong, src/lib/time.js:145-149)
- ratioed__desktop__h13__s0.png 'June 27, 2025' (formatDateFull, time.js:155)
- ratioed-piece desktop 'Oct 27, 2026' (formatDateAbbrev) vs ratioed-piece__mobile__h13__s0.png '2026-10-27' (ISO short form, src/pages/RatioedPiece.jsx:912-913) vs blog post short form 'Jan 29, 2025' (DocumentMeta.jsx:66)
- src/lib/mothing.js:32-38 ('8:47pm') vs src/lib/time.js:203-210 ('2:59 pm')

#### COL-12 · Ratioed participants board: bars misalign row to row and the stat grid leaves empty cells

`low` · `visual` · effort S · verdict *confirmed* · lens: Collection, gallery & detail pages · **merges:** LAY-11

**Pages:** /creating/ratioed/participants

**Observation.** Because every row sizes its last column independently, the inline distribution bars, which are meant to be read against each other, start at different x positions whenever the role chip is long. The headline stats grid ends with three blank framed cells.

**Recommendation.** Give the role column a fixed track (e.g. 11rem, with an ellipsis and full text in a title), or use subgrid so all rows share tracks. Lay the 9 stats out 3×3 (or let the last cell span), with the shared tally component from COL-07.

**Evidence.**
- ratioed-participants__desktop__h13__s2.png: row 18 (@ponder.ooo, role chip 'broke #15 & #16 & #26') has its 'pieces' bar starting ~70px left of its neighbours; ratioed-participants__desktop__h13__s1.png shows rows 4 and 7 shifted the same way
- src/pages/RatioedParticipants.css:65-70 (each row is its own grid with a trailing 'auto' track, so a wider role chip steals width from the 1fr name column and shifts the 7rem bar column)
- ratioed-participants__desktop__h13__s0.png: 9 stat cells in a 4-column grid, 'too late 127' alone on the last row beside 3 empty bordered cells

#### LAY-11 · Activity bars start at label-dependent x-positions  
*Merged into COL-12.*

`low` · `visual` · effort S · verdict *confirmed* · lens: Layout, grid, spacing & responsive behaviour

**Pages:** /logging

**Observation.** Each activity row is an independent grid whose label column auto-sizes to its own text, so the bars, which should share a zero line, start at different x-positions and their lengths can't be compared by eye.

**Recommendation** (carried forward in COL-12). Make .state-bars the grid (grid-template-columns: max-content 1fr 2.4rem) and give rows display: contents or grid-template-columns: subgrid, so every label shares one column width.

**Evidence.**
- logging__desktop__h13__s0.png: the 'stationary' bar starts at x≈928, 'in vehicle' at x≈923
- logging__mobile__h13__s1.png: bars start at ≈113 vs ≈108 CSS px
- StateStats.css:251-256 (.state-bar-row is its own grid with minmax(5rem, auto) for the label)

#### SYS-07 · Link / reference card built four times with different host, title and thumbnail rules

`low` · `visual` · effort M · verdict *adjusted* · lens: Component system & visual consistency

**Pages:** /, /posting, /reposting/:rkey, /creating/:work, /available

**Observation.** External link previews are built twice: PostEmbed's .post-embed-link-card and LeafletDocument's .leaflet-website. They differ in host style (lowercase accent vs small caps at 0.12em), fill (nest mix vs page), border tone (--rule-soft vs --rule) and title size (16px vs an inherited ~16.8px from the undefined --text-md). The résumé 'Selected work' rows and .creating-card are different objects (internal index rows and feed cards) and should not be folded in.

**Recommendation.** Make LeafletDocument's website block render PostEmbed's link card, or extract one shared &lt;LinkCard compact|full> used by both, with the host as one consistent small-caps eyebrow, the nest-mix fill and a --rule-soft border. Keep the résumé 'Selected work' as a hairline index list in the blogging/creating ledger idiom rather than turning it into link cards with fake host lines.

**Evidence.**
- home__desktop__h13__s1.png (atpota.to card: host lowercase accent 12px, title 14px, 60×40 thumb, nest fill)
- record-reposting__desktop__h13__s0.png (same component at 588px: title 16px, 144×90 thumb)
- creating-work-software__desktop__h13__s0.png (Leaflet card: host 'ATURI.TO' small caps, title 16.8px, page fill, --rule border, 9rem thumb)
- available__desktop__h13__s1.png (résumé 'Selected work': 50px thumb, no host, --rule-soft border, 70px rows)
- src/components/PostEmbed.css:162-225
- src/components/LeafletDocument.css:137-195 (title uses undefined --text-md)
- src/pages/Resume.css:220-270
- src/components/Feed.css:685-700 (.creating-card)

**Verification note (adjusted).** Only two of the four 'link cards' are actually the same object. PostEmbed's link card (home__desktop__h13__s1 and record-reposting: lowercase accent host, nest fill, --rule-soft border) and LeafletDocument's website card (creating-work-software: small-caps host, page fill, --rule border, a title on the undefined --text-md) are both external link previews. LeafletDocument.css:146 even calls itself a 'visual cousin of post-embed-link-card', so that duplication is real and visible. The résumé 'Selected work' rows (Resume.css:220-270) link to on-site creating works and have no host or description; they are an index list, not a link preview. .creating-card is a feed card for works. Title-size differences within PostEmbed (14px in the feed vs 16px on a record page) are one responsive component, not separate builds. The cross-context inconsistency is polish, so low.

#### TYP-05 · The site-wide small-caps label voice is browser-synthesized: about 5px capitals, four different trackings, and it turns '1mo' into 'IMO' and 'dB' into 'DB'

`low` · `visual` · effort M · verdict *adjusted* · lens: Typography & reading experience

**Pages:** all pages (chrome), /blogging/:slug, /available, /logging, /listening, /exploring, /welcoming

**Observation.** The small-caps label voice is browser-synthesized (the served font has no smcp), so strokes are thinner than the surrounding text. Tracking varies between 0.05, 0.12, 0.14 and 0.18em across equivalent labels. Case-folding also turns units and abbreviations into 'DB' and '1MO'. The faintness of these labels comes mostly from their size and --ink-faint colour (TYP-01), not from synthesis.

**Recommendation.** Keep the caps label voice, since running-head caps are book-appropriate, but stop relying on synthesis. Use one `.label` style: real uppercase at about 0.75rem, weight 500, a single 0.08–0.1em tracking, in --ink-muted. Exempt units and abbreviations (dB, bpm, mo) from case transforms, and put a thin space between number and unit. An italic-lowercase marginal-note voice is an acceptable on-brand alternative, but pick one and use it everywhere.

**Evidence.**
- extra/typography/zoom-chrome-desktop-2x.png ('LISTENING TO', 'BPM', 'CAL', 'DB' visibly lighter and smaller than the values)
- extra/typography/zoom-docmeta-desktop-2x.png ('PUBLISHED', 'ELAPSED')
- extra/typography/zoom-footer-available-2x.png ('UPDATED 1MO AGO' reads as 'UPDATED IMO AGO')
- extra/typography/feature-test.png (with font-synthesis-small-caps:none, all-small-caps falls back to lowercase, so the served font has no smcp; the upstream Fonthausen build has none either)
- state-chrome-toggle__mobile__h13.png ('65 DB')
- typography.css:113-118 .small-caps 0.05em; ChromeBar.css:243-247 0.12em; Blogging.css:259-266 0.12em; StateStats/ListeningStats 0.14em; RatioedPanel.css:33 and Guestbook.css:131-136 0.18em
- 109 all-small-caps declarations across public CSS
- VitalsPanel.jsx:78 &lt;span class="vital-unit">dB&lt;/span>; RecordTimestamp.jsx:55-66 wraps relativeTime output ('1mo', '1y') in .small-caps

**Verification note (adjusted).** The facts mostly hold. feature-test.png shows all-small-caps falling back to mixed case when synthesis is disabled, so the served Crimson Pro has no smcp. Tracking varies: 0.05em in .small-caps, 0.12em in ChromeBar, 0.14em and 0.18em elsewhere. '65 DB' and 'UPDATED 1MO AGO' are visible in the zoom captures, and VitalsPanel and RecordTimestamp do feed 'dB' and '1mo' into small caps. The causal claim is overstated. Synthesized caps of a 12px label have a cap height of about 5.5px, which is about what true small caps would have, so synthesis is not 'the main thing' making the chrome faint. The main causes are the 11.4–12px size and the --ink-faint colour, already covered by TYP-01. What is left and distinct (thinner synthesized strokes, inconsistent tracking, case-folded units) is polish. '1MO' reading as 'IMO' is a subjective stretch. It is still legible as 1MO in zoom-footer-available-2x.png.

#### TYP-06 · Numerals: oldstyle figures are stripped by the Google Fonts build, and ledger times, day stats and stat tiles don't share figure style or baselines

`low` · `visual` · effort M · verdict *adjusted* · lens: Typography & reading experience

**Pages:** /blogging/:slug, /, /mothing, /listening, /logging

**Observation.** Running text such as 'In November of 2007' and '4-5 years' uses lining figures that stand as tall as capitals. The book-appropriate oldstyle figures exist in Crimson Pro but are lost in the Google Fonts subset. Meanwhile, the places that need tabular lining figures (right-aligned time columns, day stats) use proportional ones, and stat tiles centre their content, so one extra sub-line knocks a numeral off the shared baseline.

**Recommendation.** First do the cheap, visible fixes: top-align stat-tile values so all numerals share a baseline, and add `font-variant-numeric: tabular-nums` (lining is already the default) to ledger time, day meta, mothing time and ratioed columns. Treat self-hosting upstream Crimson Pro for oldstyle prose figures as an optional later step, bundled with any other font-loading work.

**Evidence.**
- extra/typography/numerals-onum-test.png (Google Fonts Crimson Pro ignores oldstyle-nums; the upstream Fonthausen build renders true oldstyle figures)
- extra/typography/feature-test.png (tnum does work: width 465 → 511px)
- index.html:98 loads Crimson Pro from fonts.googleapis.com
- Feed.css:1872-1880 .ledger-time, Feed.css:1814 .day-header-meta and Mothing.css:251-259 .mothing-ledger-time have no font-variant-numeric (probe: num=normal)
- extra/typography/zoom-mothing-timecol-2x.png: in the right-aligned time column the colon x jitters between 1179.3 and 1182.0px
- listening__desktop__h13__s0.png: the '463' minutes numeral sits about 12px higher than 126/102/36/38 because its tile adds '≈ 7.7 hrs' and ListeningStats.css:76-80 centres the tile content vertically

**Verification note (adjusted).** Each fact is verifiable. numerals-onum-test.png shows the Google Fonts build ignores onum while the upstream build honours it. .ledger-time, .day-header-meta and .mothing-ledger-time have no font-variant-numeric. In listening__desktop__h13__s0.png, '463' sits about 11px above 126/102/36/38 because .listen-stat-tile uses justify-content:center (ListeningStats.css) and that tile carries an extra '≈ 7.7 hrs' line. The impact is minor, though. Lining figures in prose are a style preference and do not hurt reading. The time-column colon jitter is about 2.7px. Only the stat-tile baseline break is plainly visible. Self-hosting fonts is M effort with performance trade-offs, which is a lot for polish. Low, not medium.

### Theme 10 — The protocol moments undersell themselves

#### GAP-01 · Shared post links drop their photo, and image-only posts answer HTTP 404

`medium` · `functional` · effort M · verdict *adjusted* · lens: Gap pass (cross-lens)

**Pages:** /posting/:rkey, /reposting/:rkey, /liking/:rkey and other non-section verbs, link unfurls on Bluesky/iMessage/Slack

**Observation.** The per-record card for app.bsky.feed.post uses only the post text, so posts with photos (such as 'gm from cooper', which has embed.images) unfurl with no picture. A post with empty text, such as the image-plus-quote recordWithMedia 3myujs5nl522g, makes shapeMeta return null. The edge then answers 404 + noindex with the generic posting card, even though the record exists and the SPA renders it. Repost record pages fall through to the site-wide title, description and card because 'reposting' is not in RECORD_SECTIONS. Empty-text posts are uncommon (about 1 in 40 recent posts), so the 404 is a narrow but real bug. The missing photo affects every photo post's unfurl.

**Recommendation.** In og/records.js, never return null for a post that exists. When text is empty, take the title from the first image's alt text (e.g. 'dril tweet about spending 3,600 on candles') or 'A photo, day 12,227'. When a post has images (embed.images or recordWithMedia.media.images), pass the first image's CDN thumb and alt text to /api/og and use the plate layout the listening card already has: image right, text as caption. Add reposting/quoting/liking to RECORD_SECTIONS with a 'Reposted @handle — …' card that shows the original author's avatar. Make the SPA title for image-only posts use the alt text instead of 'A post'.

**Evidence.**
- extra/gaps/og-post-gm-cooper.png: the 'gm from cooper' dog-photo post unfurls as a 1200×630 ruled sheet with three words at ~26px and no picture
- curl https://dame.is/posting/3myujs5nl522g → HTTP/2 404, cache-control: no-store, &lt;meta name=robots content=noindex>, &lt;title>dame.is posting&lt;/title>, og:image ?page=/posting (generic section card). The post is real: an image + quote (recordWithMedia) with empty text, and the SPA renders it (record-posting__desktop__h13 metrics status 404, title 'A post — dame.is')
- og/records.js:163: a post's card is built from v.text only. og/records.js:353 'if (!cleanTitle) return null' makes any text-less post unresolvable. middleware.js:435 + :476 turn that into noindex + 404
- Nine other recent posts with text all return 200 (curl loop), so the cause is empty text, not snapshot age as CORPUS.md guessed
- curl /reposting/3myuh64psn623 → 200 but &lt;title>dame.is&lt;/title>, description 'An atmospheric website by dame…', og:image ?page=/reposting/… = the site home card (extra/gaps/og-reposting.png), while the SPA title is 'Reposted: @poe.atpota.to — new dispatch!…'; og/records.js:81-89 RECORD_SECTIONS omits reposting and the other verbs
- Counter-examples showing the card system can carry imagery: extra/gaps/og-listen-rec.png (album cover plate), og-night.png (five moth plates)

**Prior review:** RECOMMENDATIONS §10 (shareable routes fall back to the generic home card) — still open for /reposting and the other non-section verbs

**Verification note (adjusted).** Verified (404 + noindex for the empty-text post; photo-less 'gm from cooper' card; /reposting falls through to the home card). High overstates the reach: only 1 of the last 40 top-level posts has empty text, /posting/:rkey mirror URLs are shared less often than bsky.app links, and a photo-less card is still a working, on-brand unfurl. A real bug on a secondary share surface.

#### INT-03 · X-ray on home hides the content it should explain, and skips the chrome's live records

`medium` · `ux` · effort L · verdict *adjusted* · lens: Interaction, motion, feedback & states · **merges:** IDN-10

**Pages:** /, /posting, /logging, /mothing

**Observation.** In x-ray on ledger pages, every row's verb, body and time are hidden and replaced by one mono line, at://…/&lt;collection>/&lt;rkey> plus a short CID. Posts and reposts can be told apart by NSID, but not which post is which (the dril image, the 'moats' text). Nothing says rows can be tapped. Home DETAILS shows dashes. The live chrome signals and hero phrases carry no record and can't be inspected. The x-ray line is aria-hidden, so screen-reader users gain nothing.

**Recommendation.** Use the blog-post model everywhere: dim content to about 35% opacity rather than hiding it. Set the collection NSID as a mono sidenote in the verb column (replacing 'posting' with 'app.bsky.feed.post') and the rkey and CID in the time column, with the full at:// line under the row only when it is tapped. Give the chrome signals and hero rotator data-atproto, so status, now-playing, followers and vitals each get a dotted underline and a hover/tap card. HUD copy for aggregate pages: '71 records · 6 collections · tap any row to open it'. DETAILS should list collections with counts and links to /exploring. Remove aria-hidden and expose the URI as an accessible description of each row.

**Evidence.**
- state-xray-on__desktop__h13.png, state-xray-on__mobile__h13.png (every row collapses to 'at://…/app.bsky.feed.post/3myu…'; the hero, chrome and vitals are unchanged)
- extra/interaction/xray-row-tapped-desktop.png, xray-row-tapped-mobile.png (tapping a row works, but nothing on screen says rows are tappable)
- extra/interaction/xray-details-mobile.png (DETAILS on home: 'AT URI — / CID — / LEXICON —', 'No backing record for this route yet.')
- state-xray-on-blogpost__desktop__h13.png (contrast: margin 'blocks.text' sidenotes with content kept)
- src/components/Xray.css:79-95 (ledger-verb/body/time set to display:none)
- src/components/LedgerXrayLine.jsx:15 (aria-hidden="true" on the only x-ray content)
- src/components/XrayLayer.jsx:87 (HUD text 'the protocol data')
- DOM probe: 71 [data-atproto] in the feed, 0 inside .chrome-bar, none on .hero-sentence

**Verification note (adjusted).** Xray.css:79-95 does hide verb, body and time. LedgerXrayLine is aria-hidden. HUD reads 'the protocol data'. DETAILS on home is all dashes. No data-atproto exists in ChromeBar or HeroSentence (only FeedItem, FlatLedger, Mothing, Guestbook, Resume, AtUriHead). Two parts are overstated. First, the rows do not differ 'only in an rkey': the collection NSID is shown and highlighted (app.bsky.feed.post vs app.bsky.feed.repost are visible in both viewports), so a repost can be told from a post. Second, x-ray is an opt-in tool, not a primary task, so high is too strong. The collapse was deliberate (the CSS comment explains that tall rows left the address floating and the panel far from the tap), so any 'dim instead of hide' fix must keep that panel-under-tap behaviour.

#### IDN-10 · X-ray speaks two different languages: marginalia on blog posts, but on home it replaces the content  
*Merged into INT-03.*

`medium` · `ux` · effort M · verdict *confirmed* · lens: Visual identity & aesthetic

**Pages:** /, /blogging/*

**Observation.** On a blog post, inspect mode works like an annotated edition: the text stays, and the protocol appears in the margins. On home, the same toggle swaps every row's content for an at:// URI and CID. The page under inspection disappears, and nothing connects a URI to the post it represents.

**Recommendation** (carried forward in INT-03). Make marginalia the one x-ray grammar. In the ledger, keep the content visible, replace the verb column with the collection NSID (app.bsky.feed.post) and the time column with rkey or a short CID, in the accent mono at the existing 11–12px. Put the full URI in the bottom 'INSPECTING' bar on hover and focus, which the HUD already supports.

**Evidence.**
- state-xray-on-blogpost__desktop__h13.png: 'blocks.text' marginalia beside each paragraph plus the 'Atmosphere record' tree
- state-xray-on__desktop__h13.png, state-xray-on__mobile__h13.png: every ledger row's content replaced by 'at://did:plc:…/app.bsky.feed.post/3myujs5nl522g' with a CID at right
- src/components/LedgerXrayLine.jsx

#### INT-10 · Guestbook signing gates on sign-in first, with an off-palette dead-grey button

`medium` · `ux` · effort M · verdict *confirmed* · lens: Interaction, motion, feedback & states

**Pages:** /welcoming, / (signature CTA), nav → Account

**Observation.** Pressing 'Sign guestbook' opens a sheet that repeats the page intro and asks for a handle or DID before the visitor can write anything. The empty-field state is a grey block (ink at 50% over cyan) that looks broken rather than waiting. The enabled state is the only black-filled CTA on a site whose primary is teal. 'Sign in to sign' is clumsy. On phones the sheet is full height (to keep the field above the keyboard, RECOMMENDATIONS §5.1) and leaves about 1,000 device px empty.

**Recommendation.** Compose first: textarea and optional location, with a live preview of the entry as it will appear in the list (placeholder avatar, 'you.bsky.social', 'just now'). Then a single commit, 'Sign with your atproto handle →', where the handle field appears inline and the OAuth step is explained ('you'll hop to your PDS and back'). Disabled = hairline --rule outline with --ink-faint text. Enabled = the same teal fill as 'Resume'. Use the empty mobile space for the preview.

**Evidence.**
- state-guestbook-sign__desktop__h13.png, state-guestbook-sign__mobile__h13.png (disabled 'SIGN IN TO SIGN' is a 50%-opacity ink slab; mobile sheet is ~60% empty)
- extra/interaction/guestbook-typed-mobile.png (enabled button is solid near-black rgb(19,30,32), unlike the teal 'Resume' primary)
- state-nav-account__desktop__h13.png ('SIGN IN' same treatment)
- src/components/SignInPanel.css:31-56 (background var(--ink); :disabled opacity .5)

#### COL-14 · Guestbook reads like a comment thread; signature metadata is louder than the signatures

`low` · `visual` · effort S · verdict *confirmed* · lens: Collection, gallery & detail pages

**Pages:** /welcoming

**Observation.** Entries are laid out like social replies: avatar, name, handle, relative time, then two metadata lines. The CID, a cryptographic detail that x-ray already exposes, gets the same weight as the guest's location. The count heading is the loudest type on the page after the H1.

**Recommendation.** Style the guestbook as a ruled register. Each entry shows the name (serif) and handle (muted), the message in italic, and a right-aligned folio 'London, UK · Sep 2026'. Remove the CID line from the default view (keep it in x-ray and the record page). Set the count as a standard small-caps xs section label.

**Evidence.**
- welcoming__desktop__h13__s0.png: '36 SIGNATURES' set at h2 size in tracked caps, far louder than every other section label on the site ('TOP TRACKS', 'EXPERIENCE', 'IDENTITY' are text-xs). src/pages/Guestbook.css:131-136 (small-caps on an h2, inherits text-2xl)
- welcoming__desktop__h13__s1.png: every entry spends a full line on a truncated CID with a fingerprint icon ('bafyreie3x…wlmsqm'). src/components/GuestbookEntryRow.jsx:139-146
- welcoming__mobile__h13__s0.png: each signature takes ~300px of height on a phone (avatar, name, handle, message, CID line, location line)

#### GAP-09 · Every Bluesky link opens an unexplained 'Open in…' chooser that never remembers the answer

`low` · `ux` · effort S · verdict *confirmed* · lens: Gap pass (cross-lens)

**Pages:** /, /posting, /blogging/:slug (replies), record pages, any page with bsky.app links

**Observation.** Links that look like ordinary links, such as timestamps and @handles, open a sheet instead of navigating. The sheet doesn't say why, gives bare app names a newcomer can't tell apart, and asks again on every click.

**Recommendation.** Add one explanatory line to the sheet header and a short descriptor per app. Label Anisota 'made by Dame'. Add an 'Always open in this app' checkbox stored per viewer; after that, links go straight to the chosen app, with a small app mark after the link and a 'change' link in the ⓘ sheet. Keep the chooser for the explicit 'Open in…' buttons. On desktop, cap rows at the reading measure.

**Evidence.**
- extra/gaps/waypoints-mobile.png, extra/gaps/waypoints-desktop.png: clicking a quoted post's '1d ago' opens 'OPEN IN… / Post · segyges.bsky.social / RECOMMENDED FOR POSTS: Bluesky, Anisota / BLUESKY FORKS: Red Dwarf / DEV TOOLS: Aturi Explore / Open the original link'
- src/hooks/useWaypointsModal.jsx:37-63: a capture-phase document click listener intercepts every plain left-click on a bsky.app record or profile link
- src/components/WaypointsSheet.jsx: no storage or 'remember' logic; no per-app description; Anisota (Dame's own client) is not identified as Dame's
- On desktop each 6–10 letter app name sits in a ~940px-wide outlined row (waypoints-desktop.png)

#### MOB-14 · Text fields in sheets suppress the focus ring, and the iOS zoom guard misses landscape

`low` · `accessibility` · effort S · verdict *adjusted* · lens: Mobile experience & accessible design (MOB)

**Pages:** /welcoming (Sign guestbook), compass → Account

**Observation.** The global 2px accent focus ring does reach the sign-in field (verified on keyboard focus despite its 'outline: none'). The guestbook textarea is unverified. The remaining defect is the iOS anti-zoom rule: it is width-gated (max-width: 700px), so a landscape iPhone gets a 14px input and Safari zooms on focus.

**Recommendation.** Gate the 16px form-control rule on (pointer: coarse), or apply it unconditionally to text inputs, instead of max-width: 700px. Delete the now-redundant 'outline: none' declarations in SignInPanel.css:23 and Guestbook.css:43 so the global ring can't be lost if CSS chunk order changes.

**Evidence.**
- src/components/SignInPanel.css:23 and src/pages/Guestbook.css:43: 'outline: none'. Focus is shown only as a 1px border-colour change to --accent, which overrides the global ring (reset.css:97-100).
- shots/state-guestbook-sign__mobile__h13.png, state-nav-account__mobile__h13.png: the sign-in field.
- src/styles/app.css:42-48: the 16px input guard is inside @media (max-width: 700px). An iPhone in landscape (844–932px CSS width) gets the field's --text-sm 14px, and Safari zooms on focus.

**Prior review:** RECOMMENDATIONS §5 (Low: iOS input-zoom guard width-gated at 700 px, misses landscape) — still open

**Verification note (adjusted).** I tested the focus-ring claim live and it does not hold for the cited sign-in field. Tabbing into .signin-input on /welcoming gives :focus-visible=true with a computed outline of 2px solid rgb(15,117,138) at 2px offset (a verification capture (signin-focus.png)). reset.css's global :focus-visible wins because main.jsx imports App (and its component CSS) before reset.css, so the same-specificity 'outline: none' is overridden. The guestbook textarea needs a sign-in and could not be verified; it could lose the ring only if Guestbook.css loads in a later lazy chunk. The landscape zoom-guard claim stands: app.css:42-48 gates the 16px rule on max-width: 700px, so a landscape iPhone (844–932px) gets the 14px --text-sm field and Safari zooms on focus. Prior §5 Low is still open.

#### TYP-14 · Code details: inline code in italic context renders as faux-oblique Plex Mono, and at-URIs break mid-segment

`low` · `visual` · effort S · verdict *confirmed* · lens: Typography & reading experience

**Pages:** /sharing, /logging/:rkey, /posting/:rkey

**Observation.** Plex Mono is reserved for genuine data, which is a good rule, but it is shown with a synthesized slant whenever it sits inside &lt;em>, and long at-URIs wrap at arbitrary characters instead of at their '/' and '.' boundaries.

**Recommendation.** Add `code { font-style: normal }` so code stays upright inside italic sentences. When rendering at-URIs and NSIDs, insert &lt;wbr> after '/' and before '.' so lines break at segment boundaries, and drop overflow-wrap:anywhere for those elements.

**Evidence.**
- sharing__desktop__h13__s0.png ('is.dame.page/sharing' slanted mono inside the italic empty-state line)
- record-logging__mobile__h13__s0.png (at-uri breaks as 'is.dam' / 'e.now/3mysojzqy3z23')
- index.html:98 loads IBM Plex Mono wght 400;500 roman only, so italic is synthesized
- typography.css:73-90 code/pre rules don't reset font-style

