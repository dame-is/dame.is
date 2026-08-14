# dame.is admin rebuild — Front Desk + Workbench

**Architecture spec. Single source of truth for the implementation fleet.**

Every claim about current behaviour below is cited `file:line` and was read directly. Where the
seven reader maps disagreed or were silent, the file was re-read and the resolution is marked
**[RESOLVED]**. Judgement calls are marked **[CALL]** with the rejected runner-up.

**Revision 2.** Three review passes challenged revision 1. Every objection was re-verified against
the working tree; 31 were accepted and folded in below, one was rejected. See
**Appendix A — Rejected objections** and **Appendix B — What changed in revision 2**.

## Verified baseline (measured today, in this working tree)

| Check | Value | How |
|---|---|---|
| Tests | **339 passed, 20 files** | `npx vitest run` |
| Lint | **3 errors, 67 warnings** | `npx eslint .` |
| Build | must succeed | `npm run build:offline` (= `vite build`, no prefetch — `package.json:11`) |

Additional facts established by direct probe, because two maps assumed otherwise:

- **`public/data/` does not exist and is gitignored** (`.gitignore:5`). It is written only by
  `scripts/prefetch.mjs` during `npm run build`. `npm run build:offline` and `npm run dev` never
  create it. → **The Front Desk must never read a snapshot file.** `fetchSnapshot`
  (`src/lib/snapshot.js:42`) would return `null` in dev and in the offline build. **[RESOLVED]**
- **A short final `listRecords` page still returns a cursor.** `site.standard.document` returned
  27 records *and* a cursor; that cursor's page is empty. Verified live again this pass against
  `https://pds.atpota.to`. The exhaustion test must be `records.length < limit`, not
  `!cursor` (which is what `src/pages/Admin.jsx:449` does today).
- **`describeRepo` is a cheap presence oracle.** Live: 147 collections. `is.dame.profile`,
  `is.dame.creating.work`, `fm.teal.feed.play` and **`is.dame.guestbook.entry`** are **absent** from
  the repo; `fm.teal.alpha.feed.play` and `is.dame.guestbook` are **present**.
  **[RESOLVED — one map assumed `is.dame.profile` exists.]**
- **`--tan` IS defined** (`src/styles/theme.css:21`, `:134`, `:164`). One map flagged it as
  missing; it is not.
- **`--paper` is genuinely undefined and is a live bug**; **`--surface-3` is undefined *by design*.**
  Both are referenced with no definition anywhere in `src/` (`--paper-rule` / `--paper-dot` /
  `--paper-drop` in `src/styles/paper.css` are different tokens). The difference is the fallback:
  `Admin.css:667` writes `var(--surface-3, rgba(0,0,0,0.05))` — an undefined token behind a
  deliberate literal, the **same idiom used three times in `src/components/blocks/blocks.css`**
  (`:295`, `:339`, `:391`). That is a pattern, not an oversight. `Admin.css:672` writes
  `color: var(--paper)` with **no fallback**, which is invalid-at-computed-value-time and falls
  back to `inherit`. Only `:672` is a bug. **[RESOLVED — revision 1 called both bugs.]**
- **`no-await-in-loop` is NOT an enabled ESLint rule.** It is absent from `eslint.config.js:60-74`
  and from `js.configs.recommended`. Every in-tree `// eslint-disable-next-line no-await-in-loop`
  therefore produces a **warning** — `Unused eslint-disable directive (no problems were reported
  from 'no-await-in-loop')` — and those warnings are part of the 67. There are **eight**:
  `EditModeBar.jsx:146`, `legacyBlog.js:169`, `legacyBlog.js:171`, `resumeAdmin.js:92`,
  **`Admin.jsx:513`, `:542`, `:1105`, `:1311`**. The four in `Admin.jsx` must survive the code
  moves verbatim or the count drops; **no owner may add a new one** or the count rises. See §9.
  **[RESOLVED — revision 1 said the rule "is enforced" and told owners to add directives. Both
  were wrong and would have broken the acceptance gate.]**
- `writing/blogs/*.md` = **8** legacy posts (`LEGACY_POSTS`, `src/lib/legacyBlog.js:54`).

### Live repo census (re-probed this pass — used only to sanity-check the Front Desk copy, never hardcoded)

`did:plc:gq4fo3u6tqzzdkjlwzpb23tj` @ `https://pds.atpota.to`:

| Collection | Records | Notable |
|---|---|---|
| `site.standard.document` | 27 | **0 carry `updatedAt`, 0 carry `createdAt`, 27 carry `publishedAt`**; 3 are `draft: true` |
| `is.dame.arena.channel` | 15 | **0 carry `title`** → `previewFor` returns `arenaSlug`; 0 have `enabled: false` |
| `is.dame.hero.phrase` | 22 | 0 have `enabled: false` |
| `is.dame.page` | 11 | rkeys are exactly the 11 slugs in `knownPageSlugs()` (`pageRegistry.js:19-92`) |
| `is.dame.resume` | 2 | exactly 1 `featured: true`; both `visibility: "public"` |
| `site.standard.publication` | 3 | 0 missing `url` |
| `is.dame.guestbook` | 1 | the book singleton |
| `is.dame.guestbook.entry` | **absent** | by design — entries live on the *signers'* repos |

Consequence, stated once: **four of the six revision-1 "Needs you" items and one of the four
revision-1 count tiles evaluate to zero or to a duplicate on this repo today.** §5 is rewritten
accordingly.

---

# 1. INVENTORY

Every admin surface. `key` is the stable identifier and, for `urlByView` surfaces, the literal
`?view=` value — **these strings must not change** (see §4).

Groups are **Content / Site / Studios / Legacy**. `kind` is how the surface renders, independent
of group.

| key | Label | NSID | Group | Kind | URL form | Renders today | Target home |
|---|---|---|---|---|---|---|---|
| `blogging` | Blogging | `site.standard.document` | Content | records-list | `?view=` | `RecordList` w/ filter, `Admin.jsx:112-125` | List pane + Record detail. `recordFilter: v => v?.site !== PORTFOLIO_PUBLICATION` |
| `creating` | Creating | `site.standard.document` | Content | records-list | `?view=` | `RecordList` w/ filter, `Admin.jsx:126-139` | List pane + Record detail. `recordFilter: v => v?.site === PORTFOLIO_PUBLICATION` |
| `logging` | Logging | `is.dame.now` | Content | records-list | `?c=` | `RecordList` via `?c=`, `Admin.jsx:160` | List pane + Record detail |
| `posting` | Posting | `app.bsky.feed.post` | Content | records-list | `?c=` | `RecordList` via `?c=`, `Admin.jsx:160` | List pane + Record detail |
| `curating` | Curating | `is.dame.arena.channel` | Content | records-list | `?c=` | `RecordList` via `?c=`, `Admin.jsx:160` | List pane + Record detail |
| `listening` | Listening | `fm.teal.feed.play` (+ `fm.teal.alpha.feed.play`) | Content | studio | `?view=` | `ListeningManager`, `Admin.jsx:1216` | Studio pane. Stays bespoke — dual-cursor paging + per-row NSID resolution (`Admin.jsx:1304-1313`) |
| `pages` | Site pages | `is.dame.page` | Site | studio | `?view=` | `PagesOverview`, `Admin.jsx:925` | Studio pane |
| `nav` | Nav menu | `is.dame.nav` | Site | studio | `?view=` | `NavMenuPanel`, `NavMenuPanel.jsx:23` | Studio pane |
| `sky` | Sky theme studio | `is.dame.sky` | Site | studio | `?view=` | `SkyThemeStudio`, `SkyThemeStudio.jsx:131` | Studio pane, `fullWidth` (§3.6) |
| `publications` | Publications | `site.standard.publication` | Site | studio | `?view=` | `PublicationsManager`, `PublicationsManager.jsx:87` | Studio pane; **selection lives at `?view=publications&r=<rkey>`** (§3.6) |
| `guestbook` | Guestbook | `is.dame.guestbook` *(`offRepo`)* | Site | studio | `?view=` | `GuestbookModerationPanel`, `GuestbookModerationPanel.jsx:18` | Studio pane |
| `about` | About | `is.dame.profile` | Site | records-list | `?c=` | `RecordList` via `?c=`, `Admin.jsx:160` | List pane + Record detail (fixed rkey `self`) |
| `hero` | Hero phrases | `is.dame.hero.phrase` | Site | records-list | `?c=` | `RecordList` via `?c=` + `HeroSeedButton`, `Admin.jsx:574` | List pane + Record detail; seed button moves to list-pane toolbar |
| `resume` | Resume studio | `is.dame.resume` | Studios | studio | `?view=` | `ResumeStudio`, `ResumeStudio.jsx:26` | Studio pane |
| `resume-tailor` | Tailor version | `is.dame.resume` | Studios | studio | `?view=` + `&r=` | `ResumeWorkbench`, `ResumeWorkbench.jsx:106` | Studio pane; requires `&r=` (`Admin.jsx:109`). Reports dirty to the strip |
| `ratioed-studio` | Ratioed studio | `is.dame.creating.ratioed.piece` | Studios | studio | `?view=` | `RatioedStudio`, `RatioedStudio.jsx:81` | Studio pane, `fullWidth` |
| `ratioed` | Ratioed catalogue | `is.dame.creating.ratioed.piece` | Studios | studio | `?view=` | `RatioedPanel`, `RatioedPanel.jsx:91` | Studio pane |
| `legacy-blogs` | Legacy blog migration | — | Legacy | studio | `?view=` | `LegacyBlogMigration`, `Admin.jsx:1044` | Studio pane |
| *(derived)* | e.g. Creative work (legacy) | any `LEXICONS[n].legacy === true` | Legacy | records-list | `?c=` | Legacy group in picker, `Admin.jsx:277` | List pane + Record detail. **Derive, never enumerate** — `knownCollections().filter(n => LEXICONS[n]?.legacy)`; today exactly `is.dame.creating.work` (`src/lib/lexicons.js:61`), which is **absent from the repo** |
| `_dashboard` | Front desk | — | — | dashboard | `/admin` | `CollectionPicker`, `Admin.jsx:274` | **Deleted.** Replaced by `FrontDesk` |
| *(control)* | Open any NSID | any | — | — | `?c=` | `CustomCollectionInput`, `Admin.jsx:377` | Front Desk footer input + rail overflow. **Must use `navigate()`**, not `window.location.assign` (`Admin.jsx:386`) |

**The guestbook NSID — [RESOLVED, revision 2].** Revision 1 gave this surface
`nsid: 'is.dame.guestbook.entry'`. That collection **does not and will not exist on this repo**:
`src/config.js:61-67` documents that visitors write `is.dame.guestbook.entry` **on their own PDS**,
and `guestbook.js:393-398` writes with `repo: agent.assertDid` of the signer. `listRecords` for it
returns HTTP 200 `{"records":[]}` — a *successful empty page*, indistinguishable from a real empty
collection — so the revision-1 dashboard would have silently reported `0` for the one surface with
real moderation work. It is also **not in `LEXICONS`** (only `is.dame.guestbook` is,
`lexicons.js:382`). Therefore:

- `nsid: 'is.dame.guestbook'` — the book singleton, which *is* on the repo (1 record) and *does*
  have a lexicon.
- `nsids: ['is.dame.guestbook', 'is.dame.guestbook.entry']` — the entry NSID is kept for labelling
  and for the Constellation `source` string only.
- **`offRepo: true`** — a new registry flag meaning "this surface's working set does not live in
  this repo". It exempts the surface from the Tier-A count *and* from the empty-count dimming rule
  (§5.1). Every guestbook number comes from §5.3 and nowhere else. Any future surface reading other
  people's repos takes the same flag.

**Not a surface, deleted:** `ResumeActiveSelector` (`Admin.jsx:782`). It is the third
implementation of "set the active resume version" (with `ResumeStudio.jsx:194` and the `featured`
checkbox at `ResumeWorkbench.jsx:490`) and only appears inside the generic `?c=is.dame.resume`
list. Setting the active version belongs to the Resume studio. **[CALL]** Delete it, **and extract
the remaining two into one exported mutation** (§3.6, `setActiveResume`). *Revision 1 rejected the
extraction; revision 2 reverses that — see Appendix B.*

---

# 2. FILE PLAN

Seven owner slots. **No file appears under two owners.** An owner may *import* another owner's
file; it may not *edit* it.

## 2.1 CREATE

| File | Purpose | Owner |
|---|---|---|
| `src/admin/surfaces.js` | The surface registry (§3.1) | **OWNER-DATA** |
| `src/admin/surfaces.test.js` | Registry invariants (keys unique, every `urlByView` key round-trips, every `?c=` surface resolves) | **OWNER-DATA** |
| `src/admin/recordFields.js` | `recordInstant`, `previewFor`, `truncate`, `stampAutoTimestamps` lifted verbatim from `Admin.jsx:729-780`, plus the two new accessors `latestInstant` and `rowLabel` (§5.5) | **OWNER-DATA** |
| `src/admin/useAdminData.js` | Front-desk counts, needs-you derivation, cache (§5) | **OWNER-DATA** |
| `src/admin/useAdminShell.jsx` | The shell context (§3.2) | **OWNER-SHELL** |
| `src/admin/AdminShell.jsx` | Layout, param reading, pane dispatch, `data-admin-shell` toggle | **OWNER-SHELL** |
| `src/admin/AdminRail.jsx` | Icon rail / mobile chip row | **OWNER-SHELL** |
| `src/admin/AdminStatusStrip.jsx` | Unsaved-changes strip + Save/Delete | **OWNER-SHELL** |
| `src/admin/WorkbenchSkeleton.jsx` | Shell-shaped loading placeholder (§7.6). **Lives here, not in `Skeleton.jsx`** | **OWNER-SHELL** |
| `src/admin/adminShell.css` | `.wb`, `.wb-shell*`, `.wb-rail*`, `.wb-pane*`, `.wb-tabs*`, `.wb-strip*`, `.wb-skel*`, the `.main` escape, the density token block | **OWNER-SHELL** |
| `src/admin/FrontDesk.jsx` | Counts row, Needs you, Latest records, surface grid | **OWNER-DESK** |
| `src/admin/frontDesk.css` | `.fd-*` only | **OWNER-DESK** |
| `src/admin/panes/RecordListPane.jsx` | Generic filterable/sortable record list column | **OWNER-LIST** |
| `src/admin/panes/recordListPane.css` | `.wb-list*` only | **OWNER-LIST** |
| `src/admin/panes/RecordDetail.jsx` | Detail pane for a record: tabs + `RecordEditor` + action registration | **OWNER-EDITOR** |
| `src/admin/panes/recordDetail.css` | `.wb-editor*` only | **OWNER-EDITOR** |
| `src/lib/recordDiff.js` | Pure dirty-diff helpers (§6.2) | **OWNER-EDITOR** |
| `src/lib/recordDiff.test.js` | Unit tests for the above | **OWNER-EDITOR** |
| `src/admin/panes/StudioPane.jsx` | Mounts a studio component by surface key; owns the studio contract | **OWNER-STUDIOS** |
| `src/components/ListeningManager.jsx` | Lifted from `Admin.jsx:1203-1414` | **OWNER-STUDIOS** |
| `src/components/PagesOverview.jsx` | Lifted from `Admin.jsx:925-1042` | **OWNER-STUDIOS** |
| `src/components/LegacyBlogMigration.jsx` | Lifted from `Admin.jsx:1044-1201` | **OWNER-STUDIOS** |

## 2.2 MODIFY

| File | Change | Owner |
|---|---|---|
| `src/pages/Admin.jsx` | Gut to: hooks → three gates (`:55`, `:63`, `:71`) → **one** `<AdminShell/>`. Keeps `SignInGate` (`:167`) and `import './Admin.css'` (`:34`). Deletes `PICKER_GROUPS`, `CollectionPicker`, `CustomCollectionInput`, `RecordList`, `RecordRowBody`, `ResumeActiveSelector`, `HeroSeedButton`*, `PagesOverview`, `LegacyBlogMigration`, `ListeningManager`, `RecordEditorPage`, and the helper block `:729-780`. (*`HeroSeedButton` moves into `RecordListPane.jsx` — OWNER-LIST copies it; OWNER-SHELL deletes the original.) **The four `no-await-in-loop` disable comments at `:513`, `:542`, `:1105`, `:1311` travel with the code they annotate** — see §9. | **OWNER-SHELL** |
| `src/components/ChromeBar.jsx` | Exactly two additions, §6.1. Nothing else. | **OWNER-SHELL** |
| `src/components/RecordEditor.jsx` | Additive props + four internal fixes, §6. **Must not touch line 20 (`import '../pages/Admin.css'`)** and **must not change the `onStatus` payload or its effect's dep array** (§6.2). | **OWNER-EDITOR** |
| `src/components/EditModeBar.jsx` | Remove the `pageEditor` half (§6.1). Stage 8 only. **Do not disturb the disable comment at `:146`.** | **OWNER-EDITOR** |
| `src/hooks/useEditMode.jsx` | Remove `pageEditor` / `setPageEditor` (§6.1). Stage 8 only. | **OWNER-EDITOR** |
| `src/components/SkyThemeStudio.jsx` | Studio contract (§3.6) | **OWNER-STUDIOS** |
| `src/components/RatioedStudio.jsx` | Studio contract | **OWNER-STUDIOS** |
| `src/components/RatioedPanel.jsx` | Studio contract + `.admin-danger`, drop dead classes | **OWNER-STUDIOS** |
| `src/components/RatioedPanel.css` | `border-radius: 3px`/`2px` → `0` (`:46`, `:69`); container query (`:103`) | **OWNER-STUDIOS** |
| `src/components/NavMenuPanel.jsx` | Studio contract + dirty reporting | **OWNER-STUDIOS** |
| `src/components/PublicationsManager.jsx` | Studio contract + URL-driven selection under `?view=publications` + dirty reporting | **OWNER-STUDIOS** |
| `src/components/PublicationsManager.css` | Replace `var(--paper)` (`:21`, `:115`) with `var(--page-edge)`; wrap `.pub-raw` (`:149`) | **OWNER-STUDIOS** |
| `src/components/GuestbookModerationPanel.jsx` | Studio contract + abort guard | **OWNER-STUDIOS** |
| `src/components/PageContentPanel.jsx` | Studio contract (it renders no PageShell today; only the `?c=` Edit link needs to preserve the surface) | **OWNER-STUDIOS** |
| `src/components/resume/ResumeStudio.jsx` | Studio contract; **take the bundle as a prop** instead of calling `useResumeBundle`; call `setActiveResume` | **OWNER-STUDIOS** |
| `src/components/resume/ResumeWorkbench.jsx` | Studio contract; **take the bundle as a prop**; **remove `setPageEditor`** (`:301-313`); report dirty + register actions; `featured` staged until `save()` | **OWNER-STUDIOS** |
| `src/lib/resumeAdmin.js` | **NEW in revision 2.** Export `setActiveResume(agent, did, resumes, rkey)`, lifted from the unexported closure `VersionsSection.setActive` (`ResumeStudio.jsx:194-215`). **Do not add a new `no-await-in-loop` comment** — the existing one at `:92` stays exactly where it is (§9) | **OWNER-STUDIOS** |
| `src/components/resume/resumeStudio.css` | Pane-width container queries at **both** `:228` and `:554` (§3.6 item 4) | **OWNER-STUDIOS** |
| `src/components/NavMenuPanel.css` | Viewport `@media` → container query (`:160`) | **OWNER-STUDIOS** |
| `src/components/SkyThemeStudio.css` | Container query (`:476`); keep the fixed hour bar (`:47`) | **OWNER-STUDIOS** |
| `src/components/RatioedStudio.css` | Container queries (`:127`, `:233`); resolve `--ratioed-*` (§7.5) | **OWNER-STUDIOS** |
| `src/pages/Admin.css` | **One** var fix + enumerated deletions (§7.4). **Append-only otherwise.** | **OWNER-CSS** |
| `src/components/Skeleton.css` | Re-sync `.skeleton-admin-rkey` `9ch` → `14ch` (`:443`). **Nothing else.** | **OWNER-CSS** |

## 2.3 DELETE

**No files are deleted.** Code is deleted from `src/pages/Admin.jsx` (owner: OWNER-SHELL) and CSS
rules from `src/pages/Admin.css` (owner: OWNER-CSS).

## 2.4 Shared files — explicit disposition

Named because the maps flagged them as blast-radius risks.

| File | Disposition | Owner | Note to every other owner |
|---|---|---|---|
| `src/App.jsx` | **UNCHANGED** | OWNER-SHELL (read-only custodian) | The `/admin` route (`:188-197`), the lazy import (`:25`), the provider stack (`:136-148`) and the four body-level overlays (`:228-233`) all stay exactly as they are. Nobody edits this file. |
| `src/components/Skeleton.jsx` | **UNCHANGED — read-only** | OWNER-CSS (custodian) | **Revision 2 change.** It is in the *eager public bundle*: `App.jsx:34` statically imports `EditSheet` → `EditSheet.jsx:10` imports `RecordEditor` → `RecordEditor.jsx:11` imports `Skeleton.jsx`. The admin is otherwise lazy (`App.jsx:25`). `WorkbenchSkeleton` therefore lives in `src/admin/`, not here. `AdminEditorSkeleton` (`:566`) and `AdminRecordListSkeleton` (`:500`) are **reused as-is**; only `Skeleton.css:443` is edited. |
| `src/components/resume/useResumeBundle.js` | **UNCHANGED — read-only** | OWNER-STUDIOS (custodian) | **Revision 2 change.** `StudioPane` calls the hook once and passes its whole return value down as one `bundle` prop; the studios stop calling it themselves. The hook needs no `external` escape hatch. Its `if (!agent || !did) return undefined;` guard (`:22-23`) is what makes the single call safe on non-resume surfaces (§3.6). |
| `src/pages/Admin.css` | One fix + deletions | **OWNER-CSS** | It is **public API**: `RecordEditor.jsx:20` imports it and `EditSheet` (mounted app-wide, `App.jsx:231`) renders `RecordEditor`; `Exploring.css:6` `@import`s it into the public `/exploring` route. No other owner may add, rename or restyle an `.admin-*` / `.rf-*` / `.record-preview*` / `.arena-cover-*` / `.category-field-*` rule. |
| `src/components/blocks/blocks.css` | **UNCHANGED — read-only** | — | Cited only as precedent: `:295`, `:339`, `:391` all use `var(--surface-3, rgba(0,0,0,0.0x))`. Do not "fix" that idiom anywhere. |
| `src/styles/theme.css` | **UNCHANGED** | OWNER-CSS (read-only custodian) | The shell paints panes on `--page` and the rail on `--surface-raised` with `--ink-soft` glyphs only, so the raised-surface ink re-tune (`:207-227`) does not need a new selector. Nobody edits this file. `--highlight` (`:22`, `:135`, `:165`) is an **accent wash**, not a neutral — never substitute it for a neutral literal. |
| `src/hooks/useEditMode.jsx` | One removal, Stage 8 | **OWNER-EDITOR** | Everything except `pageEditor`/`setPageEditor` is load-bearing for public pages: `active`/`selected*`/`removedUris` (feed rows), `pageRecord` (ChromeBar NSID strip + pencil), `selectionPage`, `editSheet`/`sheetEditor` (quick-edit sheet). Do not touch them. |
| `src/styles/app.css` | **UNCHANGED** | OWNER-CSS (read-only custodian) | `.main` is escaped by specificity from `adminShell.css`, never by editing `.main` (`:49-62`). |
| `src/components/RouteTransition.jsx` | **UNCHANGED** | OWNER-SHELL (read-only custodian) | Already correct for us: keyed on `location.pathname` only (`:45`), scroll-reset/focus deps `[location.pathname, navType]` (`:36`), and `mode="wait"` so the admin unmounts before an incoming public page mounts — `data-admin-shell` cannot leak across the transition. |
| `src/components/PageShell.jsx` | **UNCHANGED** | OWNER-SHELL (read-only custodian) | Reused as-is — the shell renders exactly one, with no `title`/`intro`, to get `registerPageRecord(null)` + `registerSelectionPage(false)` + `AtUriHead` for free (`:26-36`). |
| `src/components/EditSheet.jsx` | **UNCHANGED** | OWNER-EDITOR (read-only custodian) | The public quick-edit sheet. It forces a remount with `key={editSheet.atUri}` (`:150`) and passes `compact hideActions` (`:154-155`). **It must keep receiving today's exact four-boolean `onStatus` payload** — see §6.2 and Appendix A. |
| `vercel.json` | **UNCHANGED** | — | Six per-NSID rewrites exist because dotted path segments are treated as files. See §4. |
| `src/lib/lexicons.js`, `recordVisibility.js`, `verbRegistry.js`, `pageRegistry.js`, `publications.js`, `teal.js`, `resumeHelpers.js`, `skyTuning.js`, `skyTheme.js`, `guestbook.js`, `legacyBlog.js`, `constellation.js`, `atproto.js`, `feedCache.js`, `profanity.js`, `slingshot.js` | **UNCHANGED — read-only** | — | All are consumed by the public site and/or `scripts/prefetch.mjs`. The admin joins them; it never edits them. Adding a field to `VERB_REGISTRY` or changing a `max` resizes public snapshots and the sitemap. **In particular no owner may add `updatedAt` to the `site.standard.document` lexicon** — see §5.5. |
| `src/components/GuestbookEntryRow.jsx`, `src/pages/Guestbook.css` | **UNCHANGED — read-only** | — | Shared verbatim with the public `/welcoming` page (`GuestbookEntryRow.jsx:8` imports `Guestbook.css`). Admin-specific row treatment goes on a new wrapper class applied by the admin. |
| `src/components/Modal.jsx`, `Lightbox.jsx`, `BottomSheet.jsx`, `ActionDock.jsx` | **UNCHANGED — read-only** | — | Cited because §3.6 puts `container-type: inline-size` on the detail pane, which makes it a containing block for `position: fixed` descendants. **All four `createPortal` to `document.body`** (`Modal.jsx:116`, `Lightbox.jsx:166`, `BottomSheet.jsx:68`, `ActionDock.jsx:63`), as does the sky hour bar (`SkyThemeStudio.jsx:456-487`). Nothing fixed is left inside the pane, so the containment is safe. Verified: the only `position: fixed` rule reachable from a non-portalled admin subtree is `SkyThemeStudio.css:47`, which styles the portalled bar. |
---

# 3. THE SHELL CONTRACT

## 3.1 `src/admin/surfaces.js` — the surface registry (OWNER-DATA)

**Reuse, do not reinvent.** This module *joins* four existing sources read-only. It is the promoted,
data-shaped form of `PICKER_GROUPS` (`Admin.jsx:218-272`), which is today the only place the
`view=` surfaces are enumerated at all.

Sources:
- `src/lib/lexicons.js` — `LEXICONS`, `lexiconFor`, `knownCollections` → label, summary, `legacy`
- `src/config.js` — `COLLECTIONS`, `PORTFOLIO_PUBLICATION`, `GUESTBOOK_NSID`, `GUESTBOOK_ENTRY_NSID`
- `src/lib/pageRegistry.js` — `pageSlugForCollection`, `knownPageSlugs`
- `src/lib/verbRegistry.js` — `nsidConfig`, `recordHrefFor` (public "view on site" link)

```js
/**
 * @typedef {Object} AdminSurface
 * @property {string}  key        Stable id, unique across allSurfaces(). MUST NOT change (§4).
 * @property {boolean} urlByView  TRUE when the surface is addressed as `/admin?view=<key>`,
 *                                FALSE when it is addressed as `/admin?c=<nsid>`.
 *                                This is INDEPENDENT of `kind`: `blogging` and `creating` are
 *                                `kind:'records-list'` AND `urlByView:true` (Admin.jsx:112, :126),
 *                                while `curating` is `kind:'records-list'` and `urlByView:false`.
 *                                `href`, `rowHref` and the surfaces.test.js round-trip invariant
 *                                are all defined in terms of THIS field, never `kind`.
 * @property {string}  label      Display name, e.g. "Blogging".
 * @property {string|null} nsid   Primary NSID, or null (legacy-blogs has none).
 * @property {string[]} nsids     Every NSID this surface reads. `listening` has two; `guestbook`
 *                                lists the entry NSID for labelling only.
 * @property {'content'|'site'|'studios'|'legacy'} group
 * @property {'records-list'|'studio'|'dashboard'} kind
 * @property {string}  href       Fully-formed href. `urlByView` → `/admin?view=${key}`;
 *                                otherwise `/admin?c=${encodeURIComponent(nsid)}`.
 * @property {string}  icon       lucide-react icon NAME (string). The rail maps name → component;
 *                                surfaces.js must not import lucide (keeps it tree-shakeable and
 *                                testable in the node vitest environment, vitest.config.js:9-11).
 * @property {string}  blurb      One short sentence. Seeded from PICKER_GROUPS' `summary`
 *                                (Admin.jsx:224-269) but trimmed to one clause — the Front Desk
 *                                shows it as a tile subtitle, not a paragraph.
 * @property {boolean} offRepo    TRUE when this surface's working set does NOT live in the
 *                                owner's repo. Today only `guestbook` (§1). An offRepo surface is
 *                                never counted (§5.1) and never dimmed for a zero count.
 * @property {boolean} countable  May the dashboard attempt an exact count? (§5.1)
 * @property {((value:object)=>boolean)|null} recordFilter  Client-side filter, applied AFTER
 *                                fetching, exactly as Admin.jsx:471 does today.
 * @property {string|null} newHref  Override for "New record".
 * @property {string|null} pageSlug Page-content panel slug, or null to suppress. `undefined` is
 *                                NOT allowed here — resolve it eagerly with pageSlugForCollection.
 * @property {boolean} fullWidth  Studio wants the pane's full measure — see the definition below.
 */

/** @type {AdminSurface[]} Ordered: content, site, studios, legacy. */
export const SURFACES;

/** @returns {AdminSurface[]} SURFACES plus one derived entry per legacy lexicon. */
export function allSurfaces();

/** @param {string} key @returns {AdminSurface|null} */
export function surfaceByKey(key);

/**
 * Resolve the surface for a URL state. Mirrors Admin.jsx:82-160 precedence exactly.
 * @param {{ view: string|null, collection: string|null }} params
 * @returns {AdminSurface}  Never null.
 */
export function resolveSurface({ view, collection });

/** Groups for the Front Desk grid and the rail, in order. */
export const SURFACE_GROUPS; // [{ key:'content', heading:'Content', note:'…' }, …]
```

### `resolveSurface` — the exact precedence [RESOLVED, revision 2]

Revision 1 left the `?c=` branch ambiguous, which is how the PublicationsManager bug (§3.6) got in.
Stated fully, mirroring `Admin.jsx:82-160` line for line:

1. `view` non-null **and** `surfaceByKey(view)?.urlByView === true` → **that surface**.
   (`Admin.jsx:82-140` — the `view === '…'` ladder.)
2. Otherwise, if `collection` is non-null → **a records-list surface for that NSID**, chosen as
   `allSurfaces().find(s => !s.urlByView && s.nsid === collection)` **or**, when nothing matches,
   a synthetic records-list surface with `label = lexiconFor(nsid)?.label || nsid`,
   `urlByView: false`, `countable: false`, `blurb: ''`.
   **A `?c=` URL never resolves to a studio.** `?c=site.standard.publication` must land on the
   generic record list, not on `PublicationsManager`; `?c=is.dame.guestbook&r=self` must land on the
   generic editor for the book record, not on the moderation panel. That is exactly what
   `Admin.jsx:160` does today, and `GuestbookModerationPanel.jsx:86` and `PageContentPanel.jsx:130`
   both depend on it (§4.2).
3. Otherwise → the **dashboard** surface (`kind: 'dashboard'`, `key: '_dashboard'`).

An unrecognised `view` falls through to step 2, then step 3 — today it lands on the picker
(`Admin.jsx:143`); now it lands on the Front Desk, or on the records surface if `c` is also present.

**`r` and `mode` are legal on a `urlByView` surface.** `resolveSurface` ignores them; `AdminShell`
passes them on to `StudioPane` as `rkey` / `isNew` props. `?view=resume-tailor&r=<rkey>` already
relies on this (`Admin.jsx:109`), and `?view=publications&r=<rkey>` now does too (§3.6).

### `countable`

```js
const LARGE_NSIDS = new Set([
  'is.dame.now', 'app.bsky.feed.post', 'fm.teal.feed.play', 'fm.teal.alpha.feed.play',
]);
countable = !surface.offRepo && surface.nsid != null && !LARGE_NSIDS.has(surface.nsid);
```

Do not hardcode counts. Rationale in §5.1.

### `fullWidth` — what it actually does [RESOLVED, revision 2]

Revision 1 defined `showList = kind === 'records-list' && !fullWidth`, which made `fullWidth` a
**no-op**: `sky` and `ratioed-studio` are `kind: 'studio'`, so `showList` was already false for
them and for every other studio, and all ten studios got the identical layout. `fullWidth` now
controls the **measure clamp inside the detail pane**, not the column count:

- Column count is decided by `showList` alone (§3.3) — every studio is rail + detail.
- `fullWidth: true` → the pane's content is **not** clamped: `--wb-measure: none`.
- `fullWidth: false` → the studio body is clamped to `--measure` (`68ch` inside `.wb`, §7.3) so a
  form studio does not stretch to 1400px on a wide monitor.

`fullWidth` is `true` for `sky` (the palette grid and hour strip are inherently wide) and
`ratioed-studio` (the live feed is a 4-column grid, `RatioedStudio.css:180`). The `dashboard`
surface is treated as full-width too — the Front Desk owns its own grid.

**`ownsTitle` is deleted.** Revision 1 gave it to `ratioed-studio` so the shell would pass
`headTitle={undefined}`. That is wrong: `RatioedStudio`'s title effect early-returns
`if (!live) return undefined;` (`RatioedStudio.jsx:258`) and only then writes `document.title`, and
`AtUriHead` no-ops on a falsy title (`AtUriHead.jsx:21-23`). Opening `?view=ratioed-studio` with no
live piece would have left the tab showing whichever surface you came from. The shell now **always**
passes its own `headTitle`; the studio's effect snapshots `prevTitle` (`:259`) and restores it on
cleanup (`:267-269`), so it composes correctly on top — shell sets the baseline, studio overrides it
while a piece is alive, studio restores the baseline when the piece ends.

## 3.2 `src/admin/useAdminShell.jsx` — the context (OWNER-SHELL)

One new context. It is the only new abstraction in this rebuild.

```js
/**
 * @typedef {Object} DirtyState
 * @property {boolean}  dirty     Anything unsaved in the active pane?
 * @property {string[]} fields    Human field LABELS (from lex.fields[].label), possibly empty
 *                                even when dirty — raw-JSON edits have no field granularity.
 * @property {number}   records   How many OTHER records are staged dirty. Non-zero only in the
 *                                resume workbench (dirtyUris.size, ResumeWorkbench.jsx:124).
 * @property {string|null} note   Free-text override, e.g. "raw JSON edited".
 */

/**
 * @typedef {Object} PaneActions
 * @property {(() => void)|null} save
 * @property {(() => void)|null} remove
 * @property {boolean} saving
 * @property {boolean} deleting
 * @property {boolean} loading
 * @property {boolean} canDelete
 * @property {boolean} isNew
 */

/**
 * @typedef {Object} AdminShellCtx
 * @property {object}  agent          The @atproto/api Agent. Never null inside the shell — the
 *                                    gates in Admin.jsx guarantee it (useAtprotoSession keeps
 *                                    `loading` true until the Agent module resolves,
 *                                    useAtprotoSession.jsx:167).
 * @property {string}  did
 * @property {AdminSurface} surface   Never null; `.kind === 'dashboard'` at /admin.
 * @property {string|null} collection The `c` param, or surface.nsid for a urlByView records surface.
 * @property {string|null} rkey       The `r` param.
 * @property {boolean} isNew          `mode === 'new'`.
 * @property {string|null} preset     The `for` param.
 * @property {'edit'|'preview'|'json'} tab
 * @property {(t:'edit'|'preview'|'json') => void} setTab
 * @property {(patch: {c?:string|null, r?:string|null, view?:string|null,
 *                     mode?:string|null, for?:string|null},
 *            opts?: {replace?:boolean, force?:boolean}) => void} go
 *           Merge-patch the query string. `null` DELETES a key — callers that change surface MUST
 *           pass explicit nulls (§3.4). Guards on `dirty.dirty` unless `force` (§4.3).
 *           STABLE identity.
 * @property {DirtyState} dirty
 * @property {(d: DirtyState|null) => void} reportDirty   STABLE identity. `null` = clean.
 * @property {PaneActions|null} actions
 * @property {(a: PaneActions|null) => void} registerActions  STABLE identity.
 * @property {number} dataRev
 * @property {(scope?: string|string[]|null) => void} invalidate
 *           Bump dataRev and drop cached counts. `scope` is one NSID or a list of them; omitted or
 *           null means "everything". STABLE identity. (§5.1)
 * @property {boolean} stacked        True below the 60rem breakpoint (§8).
 * @property {'list'|'detail'} column DERIVED, read-only. Which column is on screen when `stacked`.
 */

/** @throws if used outside <AdminShell>. */
export function useAdminShell();
```

**`setColumn` is deleted [RESOLVED, revision 2].** Revision 1 exposed it "only for the explicit
Back control", but the same section defined Back as `go({ r: null, mode: null })` — a URL change,
after which `column` re-derives on its own. Nothing would ever have called it, and a setter that can
desync the visible pane from the URL is a footgun. `column` is a derived read-only value.

**Stability requirement.** `go`, `reportDirty`, `registerActions`, `setTab` and `invalidate` MUST be
`useCallback`-stable with empty or ref-backed deps, and the context value MUST be `useMemo`'d.
Panes call `reportDirty` / `registerActions` from effects; an unstable callback loops. This is the
same discipline `Admin.jsx:1447` and `EditSheet.jsx:55` already use for `onStatus`.

**Teardown requirement.** Every pane that calls `registerActions` or `reportDirty` MUST return a
cleanup that calls it with `null`. The shell additionally clears both whenever
`` `${surface.key}/${collection}/${rkey}` `` changes, so a pane that forgets cannot strand a stale
Save button.

## 3.3 `AdminShell` (OWNER-SHELL)

```jsx
/**
 * The persistent admin frame. Mounted exactly once, from Admin.jsx, after the three gates.
 * Reads c / r / mode / view / for from useSearchParams and NEVER changes its own element type,
 * so React reconciles rather than remounts on every navigation.
 *
 * @param {object} props
 * @param {object} props.agent
 * @param {string} props.did
 */
export default function AdminShell({ agent, did });
```

### Render tree (exact) — [RESOLVED, revision 2]

Revision 1's tree contained no `.wb-shell` element even though every grid rule targeted it, and it
emitted `<AdminStatusStrip/>` as a fourth grid sibling — which cannot `position: sticky` to the top
or bottom of a pane it is not inside. Both are fixed here:

```jsx
<PageShell headTitle={headTitle}>
  <div
    className="wb"
    data-surface={surface.key}
    data-stacked={stacked ? '' : undefined}
    data-full-width={fullWidth ? '' : undefined}
  >
    <div className="wb-shell">
      <AdminRail />                                       {/* always */}
      {showList && (
        <div className="wb-pane wb-pane-list">{listPane}</div>
      )}
      {showDetail && (
        <div className="wb-pane wb-pane-detail">
          <AdminStatusStrip />                            {/* FIRST child; null when idle */}
          {detailPane}
        </div>
      )}
    </div>
  </div>
</PageShell>
```

Derivations, all pure:

```js
const isList     = surface.kind === 'records-list';
const stacked    = /* matchMedia('(max-width: 60rem)') */;
const column     = (rkey || isNew) ? 'detail' : 'list';        // §8.1, URL-derived
const showList   = isList && (!stacked || column === 'list');
const showDetail = !isList || !stacked || column === 'detail';
const fullWidth  = surface.fullWidth === true || surface.kind === 'dashboard';
```

`showDetail` is what revision 1 was missing: it rendered `.wb-pane-detail` unconditionally, so in
the stacked drill-down **both** columns rendered whenever `showList` was true, flatly contradicting
§8.1's "exactly one … the other is unmounted, not hidden".

Notes on the tree:

- Exactly **one** `PageShell`, with **no `title` and no `intro`** — the shell draws its own
  headers. It exists to (a) register `pageRecord = null` and `selectionPage = false`
  (`PageShell.jsx:26-32`), preventing a stale `selectionPage` from a public feed page leaking into
  the admin, and (b) set `document.title` via `AtUriHead` (`AtUriHead.jsx:20-23`, which no-ops when
  `title` is falsy — verified). Every studio therefore **stops rendering its own PageShell** (§3.6).
- `headTitle` = `` `${surface.label} — Admin — dame.is` ``, or, with a record selected,
  `` `${recordTitle || rkey} — ${surface.label} — Admin — dame.is` ``. It is passed for **every**
  surface, including `ratioed-studio` (see §3.1, `ownsTitle` deleted).
- `AdminStatusStrip` is the **first child of `.wb-pane-detail`**. That is what makes `top`-sticky
  work on desktop *and* `bottom`-sticky work when stacked: a first-child sticky box with only
  `bottom` set floats down to the scrollport bottom and pins there until the pane's own bottom edge
  scrolls past it.
- `.wb-pane-detail` carries `container-type: inline-size; container-name: wbpane` (§3.6 item 4).
  That makes it a containing block for `position: fixed` descendants — verified safe, because every
  overlay in reach portals to `document.body` (§2.4, last row).

### Clearing residual edit mode on entry — [NEW, revision 2]

`AdminShell` calls `exit()` from `useEditMode()` **once on mount**:

```js
const { exit } = useEditMode();
useEffect(() => { exit(); }, [exit]);   // exit is useCallback-stable, useEditMode.jsx:75-80
```

Why: `useEditMode`'s route-change effect (`:108-118`) clears the selection and the edit sheet but
deliberately does **not** reset `active`, and its `exit()` call fires only when `dockOpen || panel`
(`:127-129`). An owner who enters select mode on `/logging` and reaches `/admin` by the ChromeBar
home button, the browser back button, or a typed URL therefore arrives with `active === true` — and
`EditModeBar`'s publisher early-returns to `0px` only when `!active && !editing`
(`EditModeBar.jsx:110-114`). Without this call, an empty "Tap items to select" bar renders over the
workbench and `--edit-bar-h` stays non-zero, reserving space in `.app-shell`'s padding sum
(`app.css:15-18`). See §6.1, which revision 1 got wrong.

Subscribing to `EditModeContext` here costs nothing: `PageShell.jsx:26` already subscribes inside
this subtree, and on `/admin` nothing publishes to the context.

### Escaping `.main` — **[CALL]**

`AdminShell` sets `document.documentElement.dataset.adminShell = ''` on mount and deletes it on
unmount. `adminShell.css` then wins on specificity:

```css
:root[data-admin-shell] .main {          /* (0,3,0) beats .main's (0,1,0) */
  max-width: none;
  padding-left: var(--space-4);
  padding-right: var(--space-4);
  padding-top: calc(var(--space-5) + var(--chrome-crumb-pin-h, 0px));
  padding-bottom: var(--space-5);
}
```

Specificity is **(0,3,0)** — `:root` (0,1,0) + `[data-admin-shell]` (0,1,0) + `.main` (0,1,0).
*(Revision 1 said (0,2,1); the conclusion was right, the arithmetic was not.)*

Specificity, not source order — necessary because `app.css` is bundled *after* `Admin.css`
(built `index-*.css`: `.admin-input{` at ~143k, `.layout{` at ~203k). `src/pages/Resume.css:376`
already resorts to `!important` for exactly this, but that rule sits inside `@media print`
(`Resume.css:350`) so it never competes on screen; specificity is the cleaner fix.

*Runner-up rejected: a fixed full-viewport overlay copying `EditSheet.css:19-53` geometry.* It
would give full-bleed and independent scrolling for free, but it makes the document unscrollable,
which permanently reveals the site footer strip (`ChromeBar.jsx:1097-1107` reveals it when the page
is unscrollable for 500ms) and permanently reserves `--chrome-bottom-footer-h` in `.app-shell`
padding (`app.css:15-18`). Keeping document scroll keeps every ChromeBar scroll hook behaving
exactly as it does on any long public page.

### Column scrolling

The **detail pane scrolls with the document**. The **rail and list pane are `position: sticky`**
with their own `overflow-y: auto`:

```css
.wb-pane-list, .wb-rail {
  position: sticky;
  top: calc(var(--chrome-top-h, var(--chrome-h)) + var(--space-3));
  max-height: calc(100dvh - var(--chrome-top-h, var(--chrome-h)) - var(--chrome-h) - var(--space-5));
  overflow-y: auto;
  min-height: 0;              /* flex/grid items default to min-height:auto and refuse to shrink */
}
```

`--chrome-top-h` is published live by `ChromeBar.jsx:160-210`; `--chrome-h` is `56px`
(`theme.css:90`).

### Grid

```css
.wb-shell {
  display: grid;
  grid-template-columns: var(--wb-rail-w) minmax(16rem, var(--wb-list-w)) minmax(0, 1fr);
  align-items: start;
  --wb-rail-w: 3.25rem;
  --wb-list-w: 22rem;
  --wb-measure: var(--measure);
}
.wb-shell:not(:has(.wb-pane-list)) {
  grid-template-columns: var(--wb-rail-w) minmax(0, 1fr);
}
.wb[data-full-width] .wb-shell { --wb-measure: none; }

.wb-pane-detail {
  container-type: inline-size;
  container-name: wbpane;
  min-width: 0;
}
.wb-pane-detail > .wb-studio,
.wb-pane-detail > .wb-editor { max-width: var(--wb-measure); }
```

Breakpoint: **`@media (max-width: 60rem)`** → drill-down stack (§8).

### Keyboard

`AdminShell` binds one `keydown` listener on its root (not `document`): `Cmd/Ctrl+S` calls
`actions.save()` and `preventDefault()`s. Nothing else. Note `BlocksEditor` already owns
`Cmd/Ctrl+Z` scoped to its own root (`BlocksEditor.jsx:419`) — do not bind undo here.

## 3.4 `AdminRail` (OWNER-SHELL)

```jsx
/** Narrow icon rail of surfaces. Reads everything from useAdminShell(). No props. */
export default function AdminRail();
```

- One button per `allSurfaces()` entry, grouped with a hairline between groups, plus a home
  button (`/admin`, the Front Desk) at the top and an overflow "open any NSID" control at the
  bottom.
- **Reuse the existing button vocabulary**: geometry and states copied from `.chrome-nav`
  (`ChromeBar.css:473-539`) — 1.75rem square, `1px solid var(--rule)`, `border-radius: 0`,
  `background: var(--page)`, `color: var(--ink-soft)`, `.is-open` = accent border +
  `color-mix(in srgb, var(--accent) 20%, var(--page))`, and the `@media (pointer: coarse)`
  `::before { inset: -8px }` 44px hit area. Class names are `.wb-rail-btn` etc. — **do not reuse
  the `.chrome-nav` class itself**, it belongs to the public chrome.
- Icons: `stroke-width` is globally overridden to 1.5 (`app.css:26`); pass `size={17}`.
- Each button is a react-router `<Link to={surface.href}>` so middle-click / cmd-click open a new
  tab, but its `onClick` calls `go(...)` and `preventDefault()`s so the dirty guard runs.

### The exact `go` patch for a rail click — [RESOLVED, revision 2]

`go` is merge-only (§4.3), so a patch that omits a key **leaves the old value in the URL**. Moving
from `?c=is.dame.now&r=abc` to `?view=sky` with `go({ view: 'sky' })` would leave a stale `c` and
`r` that reappear the moment `view` is dropped. Every rail click therefore passes explicit nulls:

```js
// urlByView surface
go({ view: surface.key, c: null, r: null, mode: null, for: null });
// ?c= surface
go({ view: null, c: surface.nsid, r: null, mode: null, for: null });
// home / Front Desk
go({ view: null, c: null, r: null, mode: null, for: null });
```

This is one history entry per click, and it removes the need for the "programmatic correction" pass
revision 1 described in §4.3 (which would have pushed a second entry for one click).

- `title` + `aria-label` = `surface.label`. A surface whose count came back `0` and which is **not**
  `offRepo` gets `data-absent` and 55% opacity, but stays clickable (§5.1).

## 3.5 `RecordListPane` and `RecordDetail`

```jsx
/**
 * The list column. Descendant of RecordList (Admin.jsx:405) — keep its fetch, its bulk
 * hide/unhide (Admin.jsx:499) and bulk delete (Admin.jsx:532) VERBATIM, including the
 * JSON.parse(JSON.stringify(...)) BlobRef flattening at :511 and stampAutoTimestamps at :513,
 * and both `// eslint-disable-next-line no-await-in-loop` comments (:513, :542) — they are two
 * of the 67 baseline warnings and must move with the code (§9).
 *
 * @param {object}  props
 * @param {AdminSurface} props.surface
 * @param {object}  props.agent
 * @param {string}  props.did
 */
export default function RecordListPane({ surface, agent, did });
```

Changes from today's `RecordList`:

1. `limit: 50` → **`limit: 100`** (`Admin.jsx:442`). Same request count, twice the rows; 100 is
   the API maximum (verified: `limit=101` → `InvalidRequest … maximum 100`).
2. Exhaustion test `!next?.cursor || batch.length === 0` (`Admin.jsx:449`) → **`batch.length < limit`**,
   keeping `!next?.cursor` as a secondary guard. This removes today's phantom "Load more" on short
   lists (verified again this pass: 27 records returned with a live-but-empty cursor).
3. **New: filter + sort**, both client-side, both component state, **neither in the URL**.
   - Filter: a free-text box matching `rowLabel(value, nsid, lex)` + rkey, case-insensitive; plus a
     visibility segmented control `All / Visible / Hidden` shown **only when
     `visibilityModelFor(collection)` is non-null** (four collections — `recordVisibility.js:22-55`).
   - Sort: `Newest / Oldest / Key A→Z`, where newest/oldest use `latestInstant` from
     `src/admin/recordFields.js` (§5.5).
   - **Paging stays driven by the raw `records.length`, never the filtered length** — the existing
     bug shape at `Admin.jsx:471`/`:687` where a filtered view can look empty while more pages
     exist.
4. **Selection model**: adopt Listening's always-on multiselect toolbar
   (`Admin.jsx:1343`) over `RecordList`'s Select/Done toggle (`Admin.jsx:577-590`). **[CALL]** One
   model, and the persistent pane makes a mode toggle pointless. *Runner-up: keep the toggle —
   rejected: two interaction models for one list is the thing being fixed.* Checkboxes appear on
   hover/focus and whenever anything is selected.
5. Rows are `<Link to={rowHref(rec)}>` (as today, `Admin.jsx:673`) with `onClick` → `go()` +
   `preventDefault()`. `rowHref` **preserves the surface**, keyed on `urlByView`: for a `urlByView`
   records surface it is `/admin?view=<key>&r=<rkey>`; otherwise `/admin?c=<nsid>&r=<rkey>`.
   The click patch is `go({ r: rkey, mode: null })` — surface keys are already correct, so no nulls
   are needed here.
6. `PageContentPanel` (`Admin.jsx:593`) and `HeroSeedButton` (`Admin.jsx:574`) move into this
   pane's header, unchanged in behaviour.
7. **Do not emit `data-nsid` on rows.** `ChromeBar.jsx:1002` sweeps `document.querySelectorAll('[data-nsid]')`
   on every scroll frame and would start driving the public breadcrumb's NSID chip from the admin
   list. **Do not use the class name `.feed-item`** — `ChromeBar.jsx:1170` counts those.
8. After a bulk delete, call `invalidate(surface.nsids)` — scoped, not global (§5.1).

```jsx
/**
 * The detail pane for one record. The pane SHELL (header, tab bar, error slot) stays mounted
 * across record changes; only <RecordEditor> is keyed.
 *
 * @param {object}  props
 * @param {AdminSurface} props.surface
 * @param {object}  props.agent
 * @param {string}  props.did
 * @param {string}  props.collection
 * @param {string|null} props.rkey     null ⇒ new record
 * @param {string|null} props.preset   the `for` param
 */
export default function RecordDetail({ surface, agent, did, collection, rkey, preset });
```

**The remount rule — [CALL].** `<RecordEditor key={`${collection}/${rkey ?? 'new'}`} …>`. The
requirement "selecting a record must not remount the editor" is satisfied at the level that
matters: no route transition (`RouteTransition.jsx:45`), no scroll reset (`:36`), no loss of the
rail, list, list scroll position, tab bar or strip. `RecordEditor` itself is a data-bound leaf
whose load effect already keys on `rkey` (`RecordEditor.jsx:183`), so it refetches either way; the
key additionally discards per-record state that would otherwise leak — `rawMode`, `preview`,
`error`, `savedFlash`, `coverPreview` (an object URL for a *different* record's image),
`rkeyDraft`, and above all `BlocksEditor`'s 200-deep undo stack (`BlocksEditor.jsx:61-63`), where
one Cmd+Z would write record A's body into record B (`:85-94`).
*Runner-up rejected: one permanently-mounted `RecordEditor` with reset effects keyed on the same
string.* It needs a `resetKey` prop threaded into `BlocksEditor`, an object-URL revoke, and five
state resets, to arrive at what `key` does correctly for free.

Other required behaviour:
- `initialValue` MUST stay referentially stable — keep the `useMemo` at `Admin.jsx:1421`. It is in
  `RecordEditor`'s load-effect dep array (`RecordEditor.jsx:183`); a fresh literal refetches on
  every render and wipes a new-record draft.
- `onCreated` → `go({ r: newRkey, mode: null }, { replace: true, force: true })`. **Not**
  `window.location.assign` (`Admin.jsx:1488`), which reloads the whole SPA.
- `onDeleted` → `go({ r: null, mode: null }, { force: true })` and `invalidate(collection)`. **Not**
  `window.location.assign` (`Admin.jsx:1493`).
- `registerActions({ save, remove, saving, deleting, loading, canDelete: !isNew, isNew })` from an
  effect; `registerActions(null)` on cleanup. Same payload shape `Admin.jsx:1450-1459` publishes
  today, minus `close` (the rail is the way out). Fed by today's unchanged `onStatus` payload.
- `reportDirty` from the **new, separate** `onDirtyChange` prop (§6.2) — **not** from `onStatus`.
  `onDirtyChange`'s payload is `{ dirty, fields, note }`; `DirtyState` (§3.2) also carries
  `records`. `RecordDetail` widens it with the constant `records: 0` — a single record editor never
  stages edits to *other* records, and only `ResumeWorkbench` ever sets that field non-zero (§3.6).
  Do the widening inside the same stable `useCallback` that forwards to `reportDirty`, so no fresh
  object is created per render.
## 3.6 Studios in the detail pane (OWNER-STUDIOS)

`StudioPane.jsx` is the single dispatch point:

```jsx
/**
 * @param {object} props
 * @param {AdminSurface} props.surface
 * @param {object} props.agent
 * @param {string} props.did
 * @param {string|null} props.rkey    the `r` param — legal on a urlByView surface (§3.1)
 * @param {boolean} props.isNew       `mode === 'new'`
 */
export default function StudioPane({ surface, agent, did, rkey, isNew });
```

It renders a `.wb-studio` wrapper with an `<h1 class="wb-pane-title">{surface.label}</h1>` and the
surface `blurb`, then the studio component. Existing prop signatures are preserved verbatim:
`{ agent, did }` for all of them (`SkyThemeStudio.jsx:131`, `RatioedPanel.jsx:91`,
`RatioedStudio.jsx:81`, `NavMenuPanel.jsx:23`, `PublicationsManager.jsx:87`,
`ResumeStudio.jsx:26`), `{ agent }` only for `GuestbookModerationPanel` (`:18` — it derives the
repo from `agent.assertDid` inside `setEntryHidden`, `guestbook.js:490`), and
`{ agent, did, rkey }` for `ResumeWorkbench` (`:106`). Two surfaces gain props: `PublicationsManager`
takes `{ rkey, isNew }`, and both resume studios take `{ bundle }`.

### The resume bundle — how the hoist actually works [RESOLVED, revision 2]

Revision 1 said "`StudioPane` calls `useResumeBundle(agent, did)` once for both resume surfaces"
without saying how, which is impossible as written — hooks cannot be called conditionally, so a
single `StudioPane` would fire four fully-paginated `listRecords` sweeps
(`useResumeBundle.js:26-51`) on **every** studio surface: sky, nav, guestbook, ratioed, pages,
legacy-blogs. And acceptance #25 requires the bundle to survive `view=resume` →
`view=resume-tailor`, which forbids keying `StudioPane` on `surface.key` — yet that is the natural
way to satisfy the RatioedStudio unmount requirement below. Both halves, explicitly:

```jsx
const isResume = surface.key === 'resume' || surface.key === 'resume-tailor';
// Unconditional call. The hook's own `if (!agent || !did) return undefined;` guard
// (useResumeBundle.js:22-23) makes this a ZERO-REQUEST no-op on every other surface.
const bundle = useResumeBundle(isResume ? agent : null, isResume ? did : null);
```

- **`StudioPane` itself is never keyed.** It stays mounted across `resume` → `resume-tailor`, so
  the bundle is fetched once (acceptance #25).
- **The child studio element is keyed on `surface.key`.** `{React.createElement(Studio, { key: surface.key, … })}`.
  That is what unmounts `RatioedStudio` — and closes its Jetstream socket — the moment another
  surface is selected.
- `useResumeBundle.js` is therefore **UNCHANGED** (§2.4). `ResumeStudio` and `ResumeWorkbench` stop
  calling it and destructure from the `bundle` prop instead. The hook already returns exactly the
  shape they destructure: `{ resumes, jobs, education, documents, loading, error, reload }`
  (`useResumeBundle.js:67-76`).

### What every studio MUST STOP doing

1. **Stop rendering `<PageShell>`.** Nine components, twelve call sites: `SkyThemeStudio.jsx:297`,
   `RatioedStudio.jsx:557`, `RatioedPanel.jsx:473`, `NavMenuPanel.jsx:128`,
   `PublicationsManager.jsx:147` and `:350`, `GuestbookModerationPanel.jsx:77`,
   `ResumeStudio.jsx:107`, `ResumeWorkbench.jsx:332` and `:342`, plus the three lifted ones
   (`Admin.jsx:958`, `:1114`, `:1329`). Replace each with a `<>…</>` fragment or a plain `<div>`.
   Two PageShells alive at once corrupt `registerPageRecord` / `registerSelectionPage` — the
   comment at `useEditMode.jsx:99-105` states that the last page to mount wins.
2. **Stop rendering the "← All collections" link.** Call sites:
   `GuestbookModerationPanel.jsx:83`, `NavMenuPanel.jsx:134`, `PublicationsManager.jsx:153` and
   `:360`, `RatioedPanel.jsx:479`, `SkyThemeStudio.jsx:303`, `ResumeStudio.jsx:113`, plus
   `Admin.jsx:566`, `:963`, `:1120`, `:1335`, `:1465`. The rail is the way back. Keep the *other*
   toolbar contents (the NSID `<code>`, "New publication", "View /welcoming", "Edit the book
   record") — move them into the pane header row.
3. **Stop calling `setPageEditor`.** One call site: `ResumeWorkbench.jsx:301-313`. Replace with
   `registerActions` + `reportDirty` from `useAdminShell()`. (The other producer,
   `RecordEditorPage`, is deleted with `Admin.jsx`.)
4. **Stop using viewport `@media` for pane-width reflow.** The audit rule, not a fixed list:
   **every `@media (max-width: …)` block in a studio stylesheet becomes
   `@container wbpane (max-width: …)`**, with one exception — `app.css:35`'s iOS 16px input floor,
   which is a public-site zoom guard and is not a studio sheet. The complete set today is **seven
   blocks in six files** (grepped this pass):

   | File:line | Reflows |
   |---|---|
   | `resumeStudio.css:228` | `.rw-framing` → 1 column — **missed by revision 1**, and §8.5 wrongly claimed the workbench needed "only the conversion at :554" |
   | `resumeStudio.css:554` | `.rw-bullet` wrap + `.rw-bullet-order` |
   | `NavMenuPanel.css:160` | nav row stack |
   | `SkyThemeStudio.css:476` | palette grid |
   | `RatioedStudio.css:127` | header cluster |
   | `RatioedStudio.css:233` | `.rs-feed-row` grid |
   | `RatioedPanel.css:103` | catalogue rows |

   The container is declared once, by OWNER-SHELL:
   `.wb-pane-detail { container-type: inline-size; container-name: wbpane; }` (§3.3). Left as
   viewport queries these fire at ~640px viewport while the pane is already ~34rem, so
   e.g. `.rw-framing` stays two-column in a pane far too narrow for it.

### What each studio MUST do

| Studio | Requirement |
|---|---|
| `SkyThemeStudio` | `fullWidth: true` — its body is not clamped to `--measure`. Keeps `applySkyTheme` painting the whole document (`skyTheme.js:454`) — that IS the feature; the shell and rail recolouring with it is correct. Keeps the body-portalled hour bar (`SkyThemeStudio.jsx:456-487`, portalled because `RouteTransition`'s `motion.div` is a transform containing block — and now also because the detail pane is a `container-type` containing block) and `--sky-hourbar-h` (`:147-162`, summed in `app.css:15-18`). Keeps its own Save. `clearTimeout` the 2400 ms flash (`:284`). |
| `RatioedStudio` | `fullWidth: true`. **No `ownsTitle`** — it receives the shell's `headTitle` and its own effect (`:257-270`) overrides and restores it correctly on top (§3.1). **Do not route `seal` through anything.** `RatioedStudio.jsx:335-361` and the comment at `:328-334`: the threadgate write goes first and alone because every millisecond of latency is in the recorded reaction time. No confirm, no debounce, no generic Save. Keep the `!live \|\| sealed \|\| !streamOn` guards on the Jetstream socket (`:222-243`, ~166 KB/s, 256 MB budget, `jetstream.js:35`) — the `key={surface.key}` on the studio element (above) is what guarantees this pane unmounts when another surface is selected. Add cancellation to the profile-resolution effect (`:246-252`). |
| `RatioedPanel` | **Exempt from all dirty reporting and any auto-save.** `measured` (`:98`) and `found` (`:99`) are the results of multi-minute Constellation scans and are *intentionally* unsaved (`remeasure` at `:226` writes nothing by design). Never call `reportDirty`. Fix `admin-gate-button-danger` (`:530`, defined nowhere) → `admin-danger` (`Admin.css:85`); drop `admin-back-link` (`:478`, defined nowhere). Add cancellation to the backlink-count effect (`:134-140`). |
| `NavMenuPanel` | **Must report dirty.** Snapshot `items` on load and after save. Take the post-save baseline from `cleanItems` (`:117`), not the pre-save `items`, or the strip reads dirty immediately after a successful save. Put `resetDefaults` (`:84`) behind a confirm — it silently destroys edits today. `clearTimeout` the flash (`:119`). |
| `PublicationsManager` | **Must report dirty**, and **must move selection into the URL** — see the box below. Today it routes internally (`:113-144`) and forces a remount with `key={editing.rkey}` (`:137`) — which is load-bearing, because `PublicationEditor`'s `value` is a lazy `useState(() => clone(record.value))` that never re-syncs to the `record` prop (`:194`). When the `key` is dropped, add a sync effect keyed on `record.uri`. **Keep the empty-url refusal** (`:320`). Add cancellation to `load` (`:92-106`). `clearTimeout` both flashes (`:338`, `:547`). |
| `GuestbookModerationPanel` | Add a cancellation guard to `load` (`:28-46`) — `fetchGuestbookEntries` is a multi-round-trip Constellation + per-signer-PDS + profile walk (`guestbook.js:86-151`) and a fast surface flip queues real work. **This surface, and only this surface, computes `flaggedCount`** (§5.4 item 3 moved here). Treat `GuestbookEntryRow.jsx` and `Guestbook.css` as read-only. |
| `PagesOverview` (lifted) | Keep the batched single `listRecords(is.dame.page, limit:100)` and `exists={existing.has(slug)}` per panel (`Admin.jsx:929-947`, `:987`) — never render more than one `PageContentPanel` without `exists`, or it self-fetches one `getRecord` each (`PageContentPanel.jsx:28-50`). |
| `ListeningManager` (lifted) | Keep dual-namespace paging with one cursor per NSID (`Admin.jsx:1222`, `:1249-1257`) and per-row NSID resolution on delete via `nsidFromAtUri` (`:1304-1313`). Deleting from the wrong namespace is a silent no-op. Consume `src/lib/teal.js` read-only. **The disable comment at `Admin.jsx:1311` moves with this code** (§9). |
| `LegacyBlogMigration` (lifted) | Unchanged behaviour. Note the migrated-set read is un-paginated `limit: 100` (`Admin.jsx:1054`) — see §5.4 for the guard the Front Desk applies. **The disable comment at `Admin.jsx:1105` moves with this code** (§9). |
| `ResumeStudio` + `ResumeWorkbench` | Take `bundle` as a prop (above); stop calling `useResumeBundle`. `ResumeWorkbench` keeps its staged-draft model verbatim (`recordDrafts`/`dirtyUris`/`save`, `:122-125`, `:226-269`) and reports it through `reportDirty` as `{ dirty, fields: [], records: dirtyUris.size, note: null }`. **Add the missing guard**: the init effect at `:136-155` re-initialises on `rkey` change with no unsaved check — the shell's `go()` guard (§4.3) covers list clicks, but the effect must also bail-and-warn if it ever runs while dirty. Keep the `beforeunload` guard (`:316`). The `featured` checkbox: see the box below. |

### PublicationsManager selection — the URL scheme [RESOLVED, revision 2]

Revision 1 required `?c=site.standard.publication&r=<rkey>`. Under §3.1's precedence that URL has
no `view`, so it resolves to a **records-list surface** for `site.standard.publication` —
`PublicationsManager` unmounts entirely and the generic `RecordDetail` renders instead, while
acceptance #27 asked for fields to update in a component no longer on screen. A `c`→studio fallback
cannot rescue it either, because `is.dame.creating.ratioed.piece` maps to two surfaces
(`Admin.jsx:236`, `:238`) and `site.standard.document` to three (`:117`, `:131`, `:1054`). The
scheme is therefore:

```
/admin?view=publications                 → the list
/admin?view=publications&r=<rkey>        → editing that publication
/admin?view=publications&mode=new        → the new-publication draft
```

`StudioPane` passes `{ rkey, isNew }` through; `PublicationsManager` replaces its internal
`editingRkey` / `draft` state with those props and navigates with
`go({ r: rkey, mode: null })` / `go({ r: null, mode: 'new' })` / `go({ r: null, mode: null })`.
`onSaved(rkey)` for a newly created record becomes
`go({ r: rkey, mode: null }, { replace: true, force: true })`.
`?c=site.standard.publication` keeps working and keeps meaning the generic record list (§3.1 step 2).

### The `featured` checkbox and `setActiveResume` [RESOLVED, revision 2]

Revision 1 said to route `ResumeWorkbench`'s `featured` checkbox "through the same mutation
`VersionsSection.setActive` uses". That function is a **local closure inside `VersionsSection`**
(`ResumeStudio.jsx:194-215`), is not exported, and writes to the PDS immediately in a loop over
every sibling — while the workbench checkbox is a staged draft edit
(`patchDraft({ featured: e.target.checked })`, `ResumeWorkbench.jsx:492-494`) whose entire contract
is "nothing is written until Save" (`:226-269`). Wiring one to the other would change the
workbench's save semantics, and revision 1 named no file to put a shared helper in.

- **`src/lib/resumeAdmin.js` gains an owner** (OWNER-STUDIOS, §2.2). It is already the resume
  admin's mutation module (`renameRecordKey` at `:48`, `countBacklinks` at `:23`).
- Export `setActiveResume(agent, did, resumes, rkey)` — the body of `VersionsSection.setActive`
  minus its `busy`/`onError`/`onChanged` UI plumbing. **Reuse the existing `no-await-in-loop`
  disable comment at `:92`; do not add a second one** (§9).
- `VersionsSection.setActive` becomes a thin wrapper that calls it (immediate write — that studio's
  contract is unchanged).
- **In the workbench the checkbox stays staged.** `patchDraft({ featured })` is untouched; `save()`
  (`:226-269`) calls `setActiveResume(...)` for the sibling-clearing pass **only when the staged
  `featured` differs from the loaded value**, after its own writes land. Nothing is written on click.

## 3.7 `AdminStatusStrip` (OWNER-SHELL)

```jsx
/** Renders null when `!dirty.dirty && !actions`. No props; reads useAdminShell(). */
export default function AdminStatusStrip();
```

It is the **first child of `.wb-pane-detail`** (§3.3), never a grid sibling of the panes.

- Desktop: `position: sticky; top: <same offset as the list pane>; z-index: 5`. Always visible while
  a pane has registered actions; shows "No unsaved changes" when clean and the dirty sentence when
  not.
- Dirty sentence, in priority order: `dirty.note` → `${fields.length} field${s} changed: ${fields.slice(0,3).join(', ')}${…}`
  → `Unsaved changes`. Append `` · ${records} shared record${s} `` when `dirty.records > 0`
  (matching today's resume chip wording, `ResumeWorkbench.jsx:346-354`).
- Buttons: **Save** (label flips `Create`/`Creating…`/`Save`/`Saving…` on `actions.isNew`, exactly
  as `EditModeBar.jsx:220-234`), **Delete** when `actions.canDelete`, both disabled while
  `saving || deleting || loading`.
- **Save must be a plain `<button type="button" onClick>` rendered outside `.blocks-editor`.**
  `BlocksEditor.jsx:334-384` documents the regression: its outside-press dismisser runs on
  capture-phase `click` (not `mousedown`) with `flushSync`, so markdown is resolved before the save
  handler reads it; wiring Save to `pointerdown`/`touchstart` or nesting it inside the editor root
  reintroduces the swallowed-first-tap bug and can save unresolved markdown source.
- Mobile: `position: sticky; bottom: calc(var(--chrome-h) + env(safe-area-inset-bottom, 0px));
  z-index: 20`. **Sticky, not fixed** — it needs no `--*-h` custom property and cannot fight
  `.app-shell`'s padding sum (`app.css:15-18`). z-index 20 is below both chrome bars (30) and the
  edit bar (33), so the public chrome always wins. As the pane's first child, a `bottom`-only
  sticky box floats to the scrollport bottom and pins there — see §8.4.

---

# 4. ROUTING

## 4.1 The contract (unchanged)

`/admin` remains the **only** pathname. All state is query params:

```
/admin                                          → Front Desk
/admin?view=<key>                               → studio surface
/admin?view=resume-tailor&r=<rkey>              → resume workbench (r REQUIRED, Admin.jsx:109)
/admin?view=publications[&r=<rkey>|&mode=new]   → publications studio        [NEW, additive]
/admin?view=blogging|creating                   → records surface (filtered site.standard.document)
/admin?view=blogging|creating&r=<rkey>          → …with a record selected     [NEW, additive]
/admin?c=<nsid>                                 → records surface
/admin?c=<nsid>&r=<rkey>                        → …with a record selected
/admin?c=<nsid>&mode=new[&for=creating]         → new record
```

**Why query params, not paths.** `vercel.json` needs **one explicit rewrite per dotted NSID**
(`/app.bsky.feed.post/:rkey`, `/fm.teal.feed.play/:rkey`, `/fm.teal.alpha.feed.play/:rkey`,
`/is.dame.now/:rkey`, `/site.standard.document/:rkey`, `/pub.leaflet.document/:rkey`,
`/is.dame.creating.work/:rkey`) **despite** a catch-all rewrite already being present — dotted path
segments are treated as static files. And `CustomCollectionInput` lets the owner browse an
*arbitrary, unenumerated* NSID (`Admin.jsx:386`), which no rewrite list can cover. The rationale is
documented in-code at `Admin.jsx:36-46`. **Do not change this.**

## 4.2 What must not change

- Param **names**: `c`, `r`, `mode`, `view`, `for`. New params may be added; none may be renamed
  or repurposed.
- NSIDs stay `encodeURIComponent`'d.
- **Precedence, exactly as `Admin.jsx:82-160`** — written out in full in §3.1. In particular
  `view` beats `c`, an unrecognised `view` falls through, `mode === 'new'` beats `r` (`:146` before
  `:157`), and **a `?c=` URL never resolves to a studio.**
- **External deep links that must keep working unchanged:** `EditSheet.jsx:77-78` (public-site
  "open in full editor" → `/admin?c=&r=`), `PageContentPanel.jsx:130`,
  `GuestbookModerationPanel.jsx:86` (`?c=is.dame.guestbook&r=self` → the **generic** editor for the
  book record, per §3.1 step 2), `SignInPanel.jsx:142`, `OauthCallback.jsx:26`, and the
  `/admin?view=guestbook` hint in `lexicons.js:396`.
- `ChromeBar.jsx:501`'s `inSkyStudio` check (`pathname === '/admin' && params.get('view') === 'sky'`)
  — the sky surface **must keep the key `sky`** or the bottom-bar hour chip silently reverts to
  opening the public `SkyHourSheet`, whose `setSkyHour` would then fight the studio's live
  `applySkyTheme` preview.

## 4.3 Selection without a remount

`go(patch, opts)` is the only navigation primitive inside the shell:

```js
function go(patch, { replace = false, force = false } = {}) {
  if (!force && dirtyRef.current?.dirty && !window.confirm('Discard unsaved changes?')) return;
  const next = new URLSearchParams(searchParamsRef.current);
  for (const [k, v] of Object.entries(patch)) {
    if (v == null) next.delete(k); else next.set(k, v);
  }
  setSearchParams(next, { replace });
}
```

- It is **merge-only**. A key you do not mention keeps its current value. Callers that change
  surface must pass explicit nulls — the rail's exact patches are given in §3.4, the list row's and
  the studios' in §3.5 and §3.6.
- The confirm string is taken verbatim from `ResumeWorkbench.jsx:289`, the one place this guard
  exists today.
- **Push, not replace, for both surface changes and record selection.** **[CALL]** This matches
  exactly what every `<Link>` in the admin does today (`Admin.jsx:673-682`) and makes the browser
  back button walk your path. *Runner-up: `replace` on record selection — rejected: back would
  then jump straight out of the surface, and it diverges from current behaviour for no gain.*
- `replace: true` is used for exactly **two** things: the create→edit transition after `onCreated`,
  and the same transition in `PublicationsManager`. *(Revision 1 listed a third — a programmatic
  "drop a stale `&r=`" correction pass. It is deleted: with explicit nulls in the rail patch there
  is no stale `&r=` to drop, and a second `setSearchParams` for one click would push a second
  history entry.)*
- **No remount.** `Admin()` returns a single `<AdminShell/>` after the gates, so `useSearchParams`
  re-renders reconcile rather than swap component types. This is the whole fix: today
  `Admin.jsx:82-160` returns 13 different component types from a flat `if` ladder, and React
  unmounts one subtree and mounts another at the same position.
- **Hooks rule.** `Admin()` calls `useAtprotoSession()` and `useSearchParams()` before any gate
  (`:48-49`) and then only early-returns. Any new hook must sit above the gates or inside
  `AdminShell`; adding one below them changes hook order across the loading→signed-in transition
  and crashes.

## 4.4 RouteTransition and the back button

**No change to `RouteTransition.jsx`, and nobody may touch it.** It is already correct:

- `AnimatePresence` is keyed on `location.pathname` only (`:45`), so `/admin?c=X&r=A` →
  `/admin?c=X&r=B` plays no crossfade.
- Its scroll-reset + `#main-content` focus effect depends on `[location.pathname, navType]`
  (`:36`), so param navigation neither scrolls to top nor moves focus.
- `useEditMode`'s selection-reset effect also keys on `location.pathname` (`:110-118`), so it does
  not fire inside the admin either.
- Its `mode="wait"` means the outgoing route unmounts **before** the incoming one mounts, so
  `AdminShell`'s unmount cleanup runs before any public page paints and `data-admin-shell` cannot
  leak onto a public route.

Back/forward: `navType === 'POP'` inside `/admin` changes only the search string, so the shell
re-reads params and reconciles. The list pane's scroll position and filter state survive (they are
component state on a component that is never unmounted). The keyed `<RecordEditor>` remounts and
refetches, which is correct.

**Entering and leaving `/admin`** *does* change the pathname, so the crossfade and scroll reset run
normally. `AdminShell`'s unmount effect must remove `data-admin-shell` from `<html>` so `.main`
snaps back to 72rem for the public site.
---

# 5. FRONT DESK DATA

Owned by **OWNER-DATA** (`useAdminData.js`), consumed by **OWNER-DESK** (`FrontDesk.jsx`).

**Ground rules, stated up front:**

- **There is no count API in AT Protocol.** `listRecords` caps at `limit=100` (verified:
  `limit=101` → `InvalidRequest … maximum 100`), its envelope is `{uri, cid, value}` with **no
  `indexedAt`** and no rev, and `describeRepo` returns a `collections` array with no counts
  (`atproto.js:130`). The one real count endpoint in the stack is Constellation's
  `getBacklinkCount` (`constellation.js:36-41`), and it counts backlinks, not records.
- **No snapshot files.** `public/data/` is gitignored (`.gitignore:5`) and absent in dev and in
  `build:offline`. `fetchSnapshot` (`snapshot.js:42`) returns `null` there. The Front Desk reads
  **zero** snapshot files. **[RESOLVED — two maps proposed reading `snapshot-meta.json`.]**
- **No invented state.** Every number below is derived from records actually fetched, and every
  approximate number is labelled at the point of display.
- **No number that is a sum across collections.** See §5.2.

## 5.1 What is fetched, and when

One tier of counted surfaces and one tier of deliberately uncounted ones, both keyed off
`surfaces.js`'s `countable` flag (§3.1).

**Tier A — countable (one request each).** Every registry NSID except the four in `LARGE_NSIDS`
and except any `offRepo` surface. Today that is ~12 NSIDs.
One `agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100 })` per NSID.

- If `records.length < 100` → the count is **exact and complete**.
- If `records.length === 100` → render **`100+`** and set `complete: false`. Never a bare number.
  This is the rule that keeps the dashboard honest as collections grow; **do not hardcode any
  count.**
- If `records.length === 0` → the surface renders dimmed with the caption "no records yet"
  (`data-absent` on the rail button, §3.4). An absent collection and an empty one are
  indistinguishable at the API — `listRecords` for a collection that has never existed returns
  HTTP 200 `{"records":[]}`, not an error — and they are indistinguishable to the owner too, so one
  presentation serves both. **`offRepo` surfaces are exempt from this rule** and are never dimmed.

**Tier B — never counted.** `is.dame.now`, `app.bsky.feed.post`, both teal namespaces. Measured:
`app.bsky.feed.post` = 24,409 records = **246 requests / 120 s**;
`fm.teal.alpha.feed.play` = 4,326 = 45 requests; `is.dame.now` = 1,186 = 13 requests. Their tiles
show the label and an "Open →" affordance and **no number at all**. Not "many", not "1000+" — no
number.

**The presence probe is deleted [RESOLVED, revision 2].** Revision 1 specified
`resolvePds(did)` + `describeRepo(pds, did)` as "one extra pair of requests, non-blocking" and,
four lines later, used its result to *skip* counts — which requires awaiting it. Those are mutually
exclusive. It is also redundant: an empty `records` array is already the honest "no records yet",
and the probe costs two unauthenticated cross-origin hops (`atproto.js:35-44`, `:58-65`,
`config.js:13`) to learn something the count already tells us. Today it would change the rendering
of exactly three NSIDs — `is.dame.profile`, `is.dame.creating.work`, and (under revision 1's wrong
NSID) `is.dame.guestbook.entry` — all of which now fall out of the `count === 0` rule for free.

**Concurrency.** All Tier-A requests go through a small pool, **max 6 in flight**, via
`Promise.allSettled`. A rejected request yields `{ count: null, error }` for that surface only —
one failure never blanks the dashboard. No client-side retry: there is none anywhere in `src/`
today (the only backoff is build-time, `prefetch.mjs:156-183`), and inventing one here would be the
first and only such path. No rate-limit headers were observed on this PDS; 246 sequential requests
were served unthrottled, so 6-way concurrency over ~12 NSIDs is polite.

**When.** On `AdminShell` mount, once the gates have passed — `agent` is null until the dynamic
`import('@atproto/api')` resolves and `useAtprotoSession` reports `loading: true` for that whole
window (`useAtprotoSession.jsx:167`). The Front Desk renders its full layout immediately with
per-tile skeletons; nothing blocks on the fetch.

**Caching.** The existing in-memory `feedCache` (`src/lib/feedCache.js`), key `admin:counts:<nsid>`,
**TTL 60 s**. **Never `localStorage`.** Two reasons: `feedCache` explicitly evaporates on reload by
design (`feedCache.js:1-8`), and `getLatestCommit` (`atproto.js:290`) is repo-wide, so on this repo
— which external mirrors write to constantly (`is.dame.state`, teal plays, iNaturalist, are.na) —
the rev differs on most revisits even when nothing admin-relevant changed. It is a sound "skip
everything" probe and a poor per-count invalidator.

**`invalidate(scope)` — the exact mechanism [RESOLVED, revision 2].** Revision 1 said it "clears the
entry", but `feedCache.js` exports no delete or clear function — it exports exactly `readFeedCache`
(`:12`), `writeFeedCache` (`:16`), `isCacheFresh` (`:20`), `beginRefresh` (`:36`), `endRefresh`
(`:41`), `isRefreshing` (`:47`), `subscribeRefresh` (`:51`) — and §2.4 lists it read-only. So:

```js
function invalidate(scope) {
  const keys = scope == null
    ? countedNsids                       // everything
    : (Array.isArray(scope) ? scope : [scope]);
  for (const nsid of keys) writeFeedCache(`admin:counts:${nsid}`, { fetchedAt: 0 });
  setDataRev((r) => r + 1);
}
```

`fetchedAt: 0` makes `isCacheFresh` false for any TTL without touching the module. Because the cache
key is per-NSID, a record delete invalidates **only** the collection that changed
(`invalidate(collection)`, §3.5) rather than re-running the whole batch.

**`beginRefresh` / `endRefresh` are NOT used [RESOLVED, revision 2].** Revision 1 wrapped the count
batch in them "so the ChromeBar mark pulses like every other fetch". Both halves are false:
`subscribeRefresh` and `isRefreshing` have **zero importers** anywhere in `src/` (the four hooks
that look like consumers import `subscribeRefreshTick` from the unrelated `src/lib/refreshTick.js`
— `useLiveFeed.js:3`, `useDameState.js:4`, `useNowPlaying.js:4`, `useNowStatus.js:4`), the
ChromeBar mark is an avatar image (`ChromeBar.jsx:257-268`), not a refresh indicator, and
`beginRefresh` has exactly one caller in the codebase (`Home.jsx:300`, balanced at `:335`, `:350`,
`:402`). The pub/sub is currently unconsumed; wiring it here would cost an implementer the
three-site balance discipline for no observable effect. Do not use it.

## 5.2 What each number means

**Four tiles. None of them is a cross-collection sum.**

| Tile | Number | Source | Label |
|---|---|---|---|
| Documents published | `docs.filter(v => !isDraft(v)).length` | the single `site.standard.document` array | exact, or `N+` |
| Drafts | `docs.filter(v => isDraft(v)).length` — i.e. `v.draft === true` (`publications.js:49-51`, identical to `visibilityModelFor(STANDARD_DOC).isHidden`) | same array | exact |
| Hidden elsewhere | across the **three non-document** visibility collections: `is.dame.arena.channel` (`enabled:false`), `is.dame.hero.phrase` (`enabled:false`), `is.dame.resume` (`visibility !== 'public'`, where a **missing** `visibility` counts as hidden, `recordVisibility.js:47-49`) | those three arrays | exact; caption "galleries, phrases, resumes" |
| Guestbook | see §5.3 | Constellation + one book read | mixed |

**The revision-1 "Published" tile is deleted [RESOLVED].** It was specified as
"count of records where **not** `visibilityModelFor(nsid).isHidden(value)` over the Tier-A array".
Two independent faults:

1. **It throws.** `visibilityModelFor` returns `null` for every collection outside its four-entry
   `MODELS` map (`recordVisibility.js:66-68`). Seven Tier-A NSIDs have no model — `is.dame.page`,
   `is.dame.nav`, `is.dame.sky`, `site.standard.publication`,
   `is.dame.creating.ratioed.piece`, `is.dame.guestbook`, `is.dame.profile` — and `.isHidden` on
   `null` is a TypeError.
2. **Guarded, it is a forbidden sum.** It would total ~92 across nine unrelated collections while
   *excluding* the three collections where publishing actually happens (Tier B), and §5.2's own
   next paragraph forbids summing surface counts.

**Drafts and Hidden must be disjoint [RESOLVED, revision 2].** In revision 1 "Hidden" spanned all
four visibility collections *including* `site.standard.document`, whose `isHidden` **is** the draft
predicate (`recordVisibility.js:23-31`). Every draft is by definition hidden, so both tiles read 3
today over an identical set of three records, and their sum (6) is twice the number of affected
records. "Hidden elsewhere" now excludes documents and says so in its caption.

**Every visibility read is optional-chained.**

```js
const hidden = visibilityModelFor(nsid)?.isHidden(v) ?? false;
```

A collection with no visibility model has every record published. Never call `.isHidden` on an
unguarded result.

**Surface counts are not a partition — never sum them.** Blogging and Creating are the same
collection split client-side on `value.site` (`Admin.jsx:122`, `:136`), and `publications.js:67-78`
lets a document appear on **both** public surfaces via the reserved cross-post tags
(`blog`/`blogging` → /blogging, `creating`/`portfolio` → /creating). Compute all document numbers
from **one** fetched array using the existing predicates `isDraft` (`publications.js:49`),
`showOnBlog` (`:75`) and `showOnCreating` (`:67`), so the admin and the public site agree by
construction.

## 5.3 Guestbook — two requests, not twenty-three [RESOLVED, revision 2]

Revision 1 said "One `fetchGuestbookEntries({ limit: 25 })`". It is nothing of the kind. The real
path (`guestbook.js:86-151`) is:

1. `fetchGuestbookBook()` (`:88` → `:49-58`) — Slingshot, then a `resolvePds` + `getRecord`
   fallback. 1–3 requests.
2. `getBacklinks` on Constellation (`:107`) — 1 request.
3. `hydrateEntries` (`:113` → `:194-202`) — `await Promise.all(refs.map(hydrate))` with **no pool**,
   1–2 requests *per ref* (`fetchRefRecord`, `:224-236`: Slingshot, then `resolvePds` + `getRecord`),
   plus one `fetchProfiles` (`:200`).
4. Because the modern book fits in a single page, the branch at `:129-150` **also** runs
   `fetchLegacyEntries` (`:182-188`) — another `getBacklinks` at **limit 100**, another unbounded
   `Promise.all`, another `fetchProfiles`.

That is a floor of ~23 requests and a ceiling near 100, across three third-party hosts
(`constellation.microcosm.blue`, `slingshot.microcosm.blue`, `public.api.bsky.app` —
`constellation.js:6`, `slingshot.js:9`, `config.js:12`), with two unbounded `Promise.all`s that
break §5.1's "max 6 in flight" pool. §3.6 of this same spec already described it correctly as "a
multi-round-trip Constellation + per-signer-PDS + profile walk". Worse, revision 1's global
`invalidate()` re-ran the whole walk after every record delete.

**The Front Desk must not call `fetchGuestbookEntries`.** It makes exactly two requests:

| Value | Call | Honesty |
|---|---|---|
| signatures indexed | `getBacklinkCount(GUESTBOOK_SUBJECT, GUESTBOOK_SOURCE)` (`constellation.js:36-41`) | **Backlink count, not entry count.** Some backlinks fail to hydrate and are dropped from any rendered list (`guestbook.js:80-84`), so this is ≥ the number of signatures you can act on. Label it "signatures indexed". |
| on the hidden list | `fetchGuestbookBook()` (`guestbook.js:49-59`) → `book.value.hidden.length` | **Exact as a list length, approximate as a count of hidden signatures.** `guestbook.js:163-167` says so: a hidden record its signer has since deleted drops out of `total` but its uri lingers in the list. Caption it **"N on the hidden list"**, never "N hidden signatures", and mark it approximate-upward. Derive no Needs-you item from it. |

Not shown on the Front Desk at any cost: `publicTotal` (approximate by construction,
`guestbook.js:164-166`) and `flaggedCount` (first page only, recomputed per render,
`guestbook.js:154-161`). `flaggedCount` moves to the guestbook surface, where the full walk already
happens and the number is already computed (§5.4).

If either request returns `null` the tile reads "Guestbook index unavailable". It is not rendered
as 0.

*(Revision 1 also graded `hiddenCount` "**Exact.**" while quoting the very caveat that makes it
approximate two lines above it in the same file. Corrected above.)*

## 5.4 "Needs you" — exact derivations

**Every item is derived from data already fetched in §5.1 and §5.3; no item costs an extra
request.** An item renders only when its count is > 0.

**The empty state is specified, not left to the implementer.** When every item is zero the section
renders, verbatim: *"Nothing needs you right now."* On today's repo that is the state for four of
the five items below.

### Work (things you can act on)

1. **`N drafts`** — `docs.filter(v => isDraft(v))`. Rows link to `/admin?view=blogging&r=<rkey>` or
   `?view=creating&r=<rkey>` depending on `isPortfolioDoc(v)` (`publications.js:35`). Exact.
   *Live today: 3.*
2. **`N legacy posts not migrated`** — `LEGACY_POSTS` (build-time bundled,
   `legacyBlog.js:54`; 8 files today) minus `migratedSlugs(docs, slugs)` (`legacyBlog.js:137-145`),
   where `docs` is the same `site.standard.document` array. Zero extra requests.
   **Guard:** if that array came back with `length === 100` the migrated set may be incomplete —
   suppress this item rather than assert work that is already done. (Today's
   `LegacyBlogMigration` has the same un-paginated `limit: 100` bound, `Admin.jsx:1054`, and 27
   documents; the guard is for later.) Links to `/admin?view=legacy-blogs`.
   *Live today: 3.*

### Consistency checks (things that should always be zero)

Rendered under a separate sub-heading, **"Consistency checks"**, so that a permanently-empty check
does not read as a broken feature. All three are zero on today's repo, verified live.

3. **`More than one resume version is active`** — `resumes.filter(r => r.value?.featured).length > 1`.
   A real latent bug it guards against: the `featured` checkbox at `ResumeWorkbench.jsx:490-497`
   sets the flag without clearing siblings, while `ResumeStudio.jsx:194-207` `setActive` does clear
   them, and the public side takes first-featured-wins (`resumeHelpers.js:345`). §3.6's
   `setActiveResume` extraction closes the hole; this check is the tripwire.
   Links to `/admin?view=resume`. *Live today: 2 resumes, exactly 1 featured → 0.*
4. **`N page records outside the built-in surfaces`** —
   `pages.filter(r => !new Set(knownPageSlugs()).has(rkeyFromUri(r.uri)))`. This is exactly
   `PagesOverview`'s `extraRecords` (`Admin.jsx:955`), computed from the same array.
   Links to `/admin?view=pages`. *Live today: 11 page records, all 11 in `knownPageSlugs()`
   (`pageRegistry.js:19-92`) → 0.*
5. **`N publications with no url`** — `publications.filter(p => !p.value?.url)`.
   `PublicationEditor` hard-refuses to *save* one (`PublicationsManager.jsx:320`), but an older
   record can still lack it. Links to `/admin?view=publications`. *Live today: 3 publications, all
   with a `url` → 0.*

### Moved off the Front Desk

**Flagged signatures.** Revision 1's item 3 —
"`N signatures auto-hidden by the language filter, not on your hidden list`" — was the only Needs-you
item that cost a request, and it cost the entire ~23-request guestbook walk (§5.3). It moves to the
**guestbook surface**, where `fetchGuestbookEntries` already runs and already returns `flaggedCount`
(`guestbook.js:161`), and it is captioned there exactly as written plus "(first page)".

**The wording rules still stand, wherever it renders.** There is **no** "reviewed"/"unread"/
"awaiting" state anywhere in the codebase — grepping `src/` for those words returns only unrelated
prose. The only two guestbook states are `hidden` (a host-curated array of at-uris on
`is.dame.guestbook/self`, `guestbook.js:89`) and `flagged` (recomputed per render by
`src/lib/profanity.js`, **never persisted**, `guestbook.js:198`). **Do not label it "awaiting
review" and do not add a `reviewed` field to the book record** — that record also drives the public
`/welcoming`.

**Explicitly not offered**, because it would require inventing state: any notion of "reviewed",
"triaged", "scheduled", "stale", or a per-record read/unread flag.

## 5.5 "Latest records" [RESOLVED, revision 2 — renamed from "Pick back up"]

Top 8 records, newest first, merged across **the Tier-A collections only**.

### Why it is not called "Pick back up"

Revision 1 promised an edit-first list built on:

```js
touchedAt = value.updatedAt || value.publishedAt || value.createdAt || tidToTimestamp(rkey)
```

justified by "`updatedAt` is the `autoOnEdit` field shared by most `is.dame.*` lexicons". True for
most — and **false for the one collection the owner actually edits.**
`site.standard.document`'s field list (`lexicons.js:93-127`) never spreads `COMMON_TIMESTAMPS`
(the nine spreads are at `lexicons.js:57, 79, 158, 172, 237, 261, 305, 330, 398`) and carries
neither `updatedAt` nor `createdAt`. `RecordEditor.jsx:197-203` stamps only fields with
`f.autoOnEdit`, so **saving a document stamps nothing**. Live: 0 of 27 documents carry `updatedAt`;
all 27 carry `publishedAt`, an author-chosen publication date. Editing a 2024 post today does not
move it. Merging and sorting by the revision-1 accessor put the first `site.standard.document` at
**rank 11**, below `is.dame.nav/self`.

`src/lib/lexicons.js` is UNCHANGED — read-only (§2.4), so adding `updatedAt` to the document lexicon
is out of scope for this rebuild (it would resize public snapshots, and `recordInstant` and
prefetch/feed ordering both read the timestamp fields). **[CALL]** Rename the section to what the
data supports rather than shipping a promise the records cannot keep. *Runner-up: add
`{ key:'updatedAt', type:'datetime', autoOnEdit:true }` to `site.standard.document` — rejected here,
but it is the right follow-up, and it needs its own owner and a public-site regression pass.*

Section caption, verbatim:
*"Newest first — by edit date where the record keeps one, otherwise by publication date. Documents
carry no edit timestamp. Excludes logging, posting and listening."*

### The accessor

```js
// src/admin/recordFields.js  (OWNER-DATA)

/**
 * Best honest instant for a record, newest-first ordering only.
 * Returns null when the record has no trustworthy timestamp — such a record is
 * DROPPED from the list rather than dated wrong.
 */
export function latestInstant(value, uri, nsid) {
  const lex = lexiconFor(nsid);
  return value?.updatedAt
      || value?.publishedAt
      || value?.createdAt
      || LAST_RESORT[nsid]?.(value)
      // A TID rkey is only this record's own minting time when the lexicon MINTS it.
      || (lex?.rkeyMode === 'tid' ? tidToTimestamp(rkeyFromAtUri(uri)) : null)
      || null;
}

/** Per-collection last-resort accessors for records whose real instant is a named field. */
const LAST_RESORT = {
  'is.dame.creating.ratioed.piece': (v) => v?.measuredAt || null,
};
```

**Why the TID fallback is conditional [RESOLVED, revision 2].** Revision 1 endorsed
`tidToTimestamp(rkey)` for fixed-rkey collections "on completeness grounds" without checking what
the TID *means*. For `is.dame.creating.ratioed.piece` the rkey is **the subject Bluesky post's
rkey** — `rkeyMode: 'fixed'`, `rkeyPlaceholder: '3lrqlgyvftk27'`, and the lexicon summary says so:
*"The record key is the subject post's record key, mirroring how a threadgate keys off its post"*
(`lexicons.js:336-340`). `tidToTimestamp` (`atproto.js:324-337`) decodes it as a real timestamp, so
a measurement written today would be dated months old — and those rows dominate: five of today's top
eight were TID-derived, four of them ratioed pieces. Gating on `lexiconFor(nsid)?.rkeyMode === 'tid'`
means the TID is only trusted when the lexicon is the thing that minted it. The 13 ratioed pieces
carry no `createdAt`/`updatedAt`/`publishedAt` — their real instant is the required `measuredAt`
(`lexicons.js:364`), which `LAST_RESORT` now supplies.

`recordInstant` (`Admin.jsx:729-734`) moves to `recordFields.js` **unchanged** and keeps its
publication-first precedence for list rows. `latestInstant` is a separate accessor for this section
and for the list pane's Newest/Oldest sort.

### Row labels

```js
// src/admin/recordFields.js  (OWNER-DATA)

/** Display label for one record row. Falls back to previewFor, which is kept verbatim. */
export function rowLabel(value, nsid, lex) {
  const override = ROW_LABELS[nsid];
  const s = override ? override(value) : null;
  return s || previewFor(value, lex);
}

const ROW_LABELS = {
  'is.dame.creating.ratioed.piece': (v) => (v?.take != null ? `Take ${v.take}` : null),
  'is.dame.arena.channel':          (v) => v?.title || v?.arenaSlug || null,
};
```

**Why [RESOLVED, revision 2].** Revision 1 took labels straight from `previewFor`, which returns the
**first non-empty string field in lexicon order**, skipping only `createdAt`/`updatedAt`
(`Admin.jsx:751-763`). For ratioed the field order is `take` (a number, so skipped) then `subject`
(a text field holding `at://did:plc:…/app.bsky.feed.post/…`, `lexicons.js:342-347`) — so the label
is a raw at-URI. For arena the order starts `arenaSlug` before the `title` override
(`lexicons.js:316-322`), and live **all 15 channels have no `title`**, so the label equals the rkey
already rendered beside it. Four of today's top eight rows would have been at-URIs and one a
duplicated slug. `previewFor` itself is kept verbatim so the list pane's existing rendering is
unchanged; `lexicons.js` stays read-only.

### Scope

- **Logging, Posting and Listening are excluded**, stated in the caption above. They are
  append-only streams too large to scan, and they are streams you add to, not records you return to.
- `listRecords` returns **rkey order, which is alphabetical, not chronological**, for fixed-rkey
  collections (verified: `is.dame.arena.channel` returned `your-inventory-is-full`,
  `words-i-d-never-heard-of-until-now`, `weird-dog-photos-only`). Every Tier-A collection is small
  enough that the whole set is in hand, so sorting after the fetch is correct. **Never take "the
  first N of a page" as "the most recent N".**
- Each row: `rowLabel(value, nsid, lex)`, the surface name, a relative time, and a link that
  preserves the surface (`rowHref`, §3.5).
- A record whose `latestInstant` is `null` is **omitted**, not shown undated.

## 5.6 Loading and failure

- Every tile, the Needs-you list and Latest records render skeletons independently. Nothing blocks
  the surface grid, which is static and needs no data.
- A per-surface fetch failure shows a small `⚠` on that tile with the message on hover; the rest of
  the dashboard is unaffected.
- The whole dashboard renders and is fully navigable with **zero** successful requests.
---

# 6. EDITOR CHANGES

Owner: **OWNER-EDITOR** (except the `ResumeWorkbench` half of 6.1, which is OWNER-STUDIOS).

`src/components/RecordEditor.jsx` is a **public-path file**: `EditSheet.jsx:149-159` renders it
inside the quick-edit sheet, which `App.jsx:231` mounts app-wide, and `Exploring.jsx:919` renders it
on the public `/exploring/<repo>/<collection>/<rkey>` route. Every change in §6.2 and §6.3 is a
change to code the public site runs. §10.6 and §10.7 name the ones that are observable there.

## 6.1 Save/Delete move onto the pane header

Today the admin editor publishes its controls into the global bottom `EditModeBar` via
`setPageEditor` (`Admin.jsx:1440-1461`, `ResumeWorkbench.jsx:301-313`), and `EditModeBar` renders
them whenever `editing = onSheet || !!pageEditor` (`EditModeBar.jsx:97`).

Three steps, in this order:

1. **Stage 3** — `RecordDetail` (new) registers with `AdminStatusStrip` instead. `ResumeWorkbench`
   deletes its `setPageEditor` effect (OWNER-STUDIOS).
2. **Stage 8, `src/hooks/useEditMode.jsx`** — delete `const [pageEditor, setPageEditor] = useState(null)`
   (`:60`) and both entries in the `value` object and its dep array (`:198-199`, `:223-224`).
3. **Stage 8, `src/components/EditModeBar.jsx`** — four edits, and nothing else:
   - `:61` drop `pageEditor` from the destructure
   - `:96` `const ctl = onSheet ? sheetEditor : pageEditor;` → `const ctl = sheetEditor;`
   - `:97` `const editing = onSheet || !!pageEditor;` → `const editing = onSheet;`
   - `:100-103` `closeEditor()` → `closeEditSheet()` unconditionally
   The whole `editing ? … : …` cluster at `:198-239` **stays** — it still serves the public
   quick-edit sheet through `sheetEditor`. Do not disturb the disable comment at `:146` (§9).

### `--edit-bar-h` on `/admin` — corrected [RESOLVED, revision 2]

Revision 1 claimed `--edit-bar-h` "returns to `0px` on `/admin` automatically". It does not, always.
`EditModeBar`'s publisher early-returns to `0px` only when `!active && !editing`
(`EditModeBar.jsx:110-114`). After Stage 8, `editing === onSheet`, so the residual risk is `active`
— and `useEditMode`'s route-change effect (`:108-118`) clears the selection and the edit sheet but
**deliberately does not reset `active`**, while its `exit()` call fires only when `dockOpen || panel`
(`:127-129`). An owner who enters select mode on `/logging` and then reaches `/admin` by the
ChromeBar back/home buttons, the browser back button, or a typed URL arrives with `active === true`:
an empty "Tap items to select" bar renders over the workbench and `--edit-bar-h` stays non-zero,
reserving space in `.app-shell`'s padding sum (`app.css:15-18`).

**The fix is in §3.3: `AdminShell` calls `exit()` once on mount.** Restated correctly here:
`--edit-bar-h` returns to `0px` on `/admin` once `active` is also cleared, and the shell clears it
on mount. No consumer (`app.css:16`, `ActionDock.css:37`, `BottomSheet.css:33`, `EditSheet.css:53`)
needs changing.

*(The owner is never stranded either way: `ChromeBar.jsx:766-776`'s `chrome-edit-exit` X button is
gated on `isOwner && chromeEditOpen` alone, independent of the pencil's wrapper — so the guard added
below cannot trap anyone in edit mode.)*

**[CALL]** Remove the context member rather than leaving it unused. *Runner-up: leave
`pageEditor`/`setPageEditor` in place, unused — rejected: an idle `setPageEditor` is a footgun that
resurrects a second, competing save bar the first time anyone calls it.*

**Public site untouched:** `sheetEditor` (`useEditMode.jsx:55`) is a separate slot published only
by `EditSheet.jsx:87-95` and consumed only by `EditModeBar.jsx:96`. `EditSheet` itself is not edited.

### ChromeBar (OWNER-SHELL) — exactly two additions

Add beside `inSkyStudio` (`ChromeBar.jsx:501`), following its established pattern:

```js
const inAdmin = location.pathname === '/admin';
```

1. `:730` — wrap the owner pencil in `{isOwner && !inAdmin && (…)}`. On `/admin` it falls all the
   way through its four branches to `toggleEdit()` (because `pageEditUri` is null — the shell's
   `PageShell` passes no `atUri` — and `selectionPage` is false), opening an empty "Tap items to
   select" bar over the workbench.
2. `:705` — wrap the x-ray button in `{!inAdmin && (…)}`. X-ray annotates public record markup;
   there is none here.

**Nothing else in ChromeBar changes.** Do not touch `inSkyStudio` (`:501`, used at `:643-647`),
the layout math, or any measurement effect.

## 6.2 Dirty tracking

**There is no dirty tracking today.** `original` is declared at `RecordEditor.jsx:108` and written
at `:137`, `:168` and `:277` — and never read. Worse, those three writes store three *different*
shapes: the merged blank+preset draft, the **raw fetched value** (live `BlobRef` instances,
pre-`migrate`), and the post-`derive` saved payload. Meanwhile `value` holds the migrated,
`_url`-annotated form. A naive compare would report every legacy-migrated record as permanently
dirty.

New pure module, testable in vitest's node environment (`vitest.config.js:9-11`):

```js
// src/lib/recordDiff.js

/**
 * Canonical comparison form for a record value.
 *   - JSON round-trip so BlobRef instances collapse to wire form
 *     (structuredClone corrupts them — see RecordEditor.jsx:22-32)
 *   - strip `_url` display annotations (RecordEditor.jsx:35)
 *   - drop every field where `lex.fields[i].autoOnEdit === true`, because
 *     buildRecordPayload rewrites those to Date.now() on every call
 *     (RecordEditor.jsx:198-203). Today that is exactly `updatedAt`
 *     (COMMON_TIMESTAMPS, lexicons.js:46).
 * @param {object} value
 * @param {object|null} lex
 * @returns {object}
 */
export function normalizeForDiff(value, lex);

/**
 * @param {object} baseline  already normalized
 * @param {object} next      already normalized
 * @returns {{ dirty: boolean, keys: string[] }}  keys are top-level record keys,
 *          in lex.fields order first, then any extras alphabetically.
 */
export function diffRecord(baseline, next);

/** @returns {string[]} lex.fields[].label for each key, falling back to the key itself. */
export function labelFields(keys, lex);
```

Wiring inside `RecordEditor`:
- Replace the three `setOriginal` calls with **one** baseline written through `normalizeForDiff`:
  at load (both the new-record and fetched branches) and after every successful save.
- **Raw mode has no field granularity** — the whole record is one textarea (`:893-914`). In raw mode
  report `{ dirty: <text differs from the serialized baseline>, fields: [], note: 'raw JSON edited' }`.
- New unit tests must cover: an unchanged fetched record is clean; a record whose only difference
  is `updatedAt` is clean; a record with a `BlobRef` cover image is clean after a round-trip; a
  `migrate`-rewritten legacy value is clean (`migrateLegacyCreating`, `lexicons.js:466`).

### `onStatus` is NOT widened — a new prop is added instead [RESOLVED, revision 2]

Revision 1 changed the payload to
`onStatus?.({ saving, deleting, loading, isNew, dirty, dirtyFields, mode })`, arguing that
"`EditSheet` stores the whole object in state and reads named fields, so extra keys are inert".
**Semantically true, and false for render cost.** Today's effect is:

```js
useEffect(() => {
  onStatus?.({ saving, deleting, loading, isNew });
}, [saving, deleting, loading, isNew, onStatus]);        // RecordEditor.jsx:335-337
```

During typing none of those deps change, so it **never fires**. Publishing `dirty`/`dirtyFields`
forces them into the deps, and `updateField` does `setValue(prev => ({ ...prev, [key]: next }))`
(`:185-186`) — a **new object on every keystroke** — so any memo over `[value, …]` recomputes and
returns a fresh result every keystroke. The chain then runs, per keystroke, on **public routes**:

`handleStatus` → `setEditorStatus(s)` (`EditSheet.jsx:55`) → EditSheet re-renders → its
controller-publishing effect has `editorStatus` in its deps (`EditSheet.jsx:96`) →
`setSheetEditor({ … })` with a fresh object (`:87-94`) → `sheetEditor` is in the provider's memoized
`value` and its dep array (`useEditMode.jsx:196`, `:221`) → **a new EditModeContext value per
keystroke** → every `useEditMode` consumer re-renders: `ChromeBar.jsx:133` and `:479` (heavy, with
live measurement effects), `RecordTimestamp.jsx:32`, `XrayLayer.jsx:42`, and — on `/`, `/posting`,
`/logging`, `/listening` with the sheet open over a selected row — `FeedItem.jsx:107` and
`ListenRow.jsx:40` **once per feed row**. That is a behaviour change on public routes, which the
hard constraints forbid, and no test covers it.

**Therefore:**

- **`onStatus` keeps today's exact payload and today's exact dep array, verbatim.**
  `EditSheet.jsx:158` and `Exploring.jsx:919` are unaffected, and §2.4's "extra keys are inert"
  sentence is withdrawn.
- **A separate, optional prop carries dirtiness**, and only `RecordDetail` passes it:

```js
 * @param {(d: {dirty:boolean, fields:string[], note:string|null}) => void} [props.onDirtyChange]
 *        Called from its OWN effect when — and only when — the dirty state changes.
 *        EditSheet and Exploring pass nothing, so the effect's `onDirtyChange` is undefined and
 *        the effect body is a no-op for them.
```

- The payload MUST be **one `useMemo` returning the whole object, labels included**, keyed on
  `[value, rawText, rawMode, baseline, lex]` — not a memo for `{dirty, keys}` plus a separate
  `labelFields(keys, lex)` call, which would return a fresh array each render and loop through any
  consumer that stores it. The publishing effect's deps are `[status, onDirtyChange]` where `status`
  is that single memoized object.
- **The consumer's handler must stay `useCallback`-stable.** `RecordDetail` wraps it once with
  empty deps and forwards into `reportDirty` (itself stable, §3.2).

Net effect on the public path: zero. The quick-edit sheet's status effect fires on exactly the four
transitions it fires on today, and `EditModeContext` republishes exactly as often as it does today.

## 6.3 The Edit / Preview / JSON tab contract

Three body modes already exist, controlled by two booleans and a two-button toolbar
(`RecordEditor.jsx:345-364`, `:386-411`). The tab bar is a re-presentation of that tri-state, not
new machinery.

New **additive, optional** props on `RecordEditor`:

```js
 * @param {'form'|'raw'|'preview'} [props.mode]
 *        Controlled body mode. When supplied, `onModeChange` must drive it and the internal
 *        rawMode/preview state is bypassed. Omit for today's uncontrolled behaviour — EditSheet
 *        (EditSheet.jsx:149) and Exploring (Exploring.jsx:919) pass nothing and are unaffected.
 * @param {(m:'form'|'raw'|'preview') => void} [props.onModeChange]
 * @param {boolean} [props.hideModeToolbar=false]
 *        Suppress the internal button row at :345-364. Note `hideActions` does NOT hide it —
 *        that row is rendered under `{lex && !preview && …}` with no `compact`/`hideActions`
 *        guard, which is why the fixes below are reachable from the public sheet.
 * @param {string} [props.previewNote]
 *        Caption rendered under the preview body.
 * @param {(d: {dirty:boolean, fields:string[], note:string|null}) => void} [props.onDirtyChange]
 *        §6.2.
```

Tab bar rules in `RecordDetail`:

- `lexiconFor(collection)` non-null → **Edit · Preview · JSON**, default Edit.
- `lexiconFor(collection)` **null** → only **JSON**, and it is forced. `RecordEditor` already
  forces raw mode when `!lex` (`:113`, `:139`) and disables both toolbar buttons (`:346`, `:356`).
- Tab is **shell state, not URL state.** **[CALL]** It resets to `edit` whenever
  `` `${collection}/${rkey}` `` changes. *Runner-up: an `&t=` param — rejected: every tab click
  would push a history entry, and the parameter is meaningless for the ten `view=` studios.*
- **JSON is authoritative when active.** `buildRecordPayload` parses `rawText` in raw mode
  (`:189-193`) and `toggleRawMode` refuses to leave raw mode on a parse error (`:304-317`). Saving
  from the JSON tab saves the JSON. The pane header shows "Editing raw JSON — Save writes this
  text" while the tab is active. **[CALL]** Keep it editable and authoritative. *Runner-up: a
  read-only JSON view with `rawMode` kept as a separate escape hatch — rejected: raw mode is the
  only editor available for collections with no lexicon, and splitting it in two would give the
  owner two different JSON surfaces.*

### Four internal fixes — two of them observable on public routes

**(1) raw → form silently strips image display URLs. — PUBLIC-OBSERVABLE.**
`rawText` is stored `_url`-free (`:171`) and the raw→form branch does `setValue(JSON.parse(rawText))`
(`:310-311`), losing every annotation baked on at load. After parsing, re-run
`annotateRecordBlobs(parsed, lex, pds, did)` (`:53`) using a `pds` cached in a ref from the initial
load — do not re-`resolvePds` on every toggle. Without this, flipping Edit↔JSON makes existing
images render as "Click to upload" in the blocks editor and vanish from Preview.

**The `pds` ref is never populated on the new-record branch.** `RecordEditor.jsx:130-140` sets the
draft and `return undefined`s *before* `load()` runs, so `resolvePds` (`:158-163`) never executes and
the ref stays `null`. The re-annotation must **no-op safely** on a null `pds` rather than throw —
which is also the existing contract at `:164`, `if (pds) annotateRecordBlobs(...)`.

Reachable from the public quick-edit sheet: the "Edit JSON" / "Use form" toolbar at `:345-364` is
rendered under `{lex && !preview && …}` with **no `compact` and no `hideActions` guard**, and
`EditSheet.jsx:154-155` passes exactly `compact hideActions`. So the toolbar shows on every
quick-editable record, and this fix changes what the owner sees there. Acceptance: §10.6/#43.

**(2) The JSON tab must not show a phantom `updatedAt`.**
`toggleRawMode` seeds the textarea from `buildRecordPayload()` (`:306-307`), which has already
bumped every `autoOnEdit` field (`:198-203`). Build the tab's text from a payload variant that skips
that bump. Reachable from the public sheet through the same toolbar; the change is that a field the
record does not carry stops appearing.

**(3) `deleting` never resets on success.** `:292-302` — only the `catch` branch calls
`setDeleting(false)`. Correct today because all four callers unmount or hard-navigate; in a
persistent pane the Delete button would stick on "Deleting…". Reset it in `finally`.
**Not publicly observable** — see Appendix A, objection R1.

**(4) Fixed-rkey create returns early** without updating `original`/`value`/`rawText`/`savedFlash`
(`:233-245`), leaving the editor stale until the caller navigates. Since `RecordDetail` now
navigates in-place instead of reloading, refresh the baseline before calling `onCreated`.
Admin-only in reach: `EditSheet` never creates (it always opens an existing `atUri`,
`EditSheet.jsx:150`), and `Exploring` passes a `rkey` (`:922`).

## 6.4 What Preview can honestly render

`RecordPreview` (`RecordEditor.jsx:496-529`) is kept as-is and simply surfaced as a tab.

**It renders:** `title` as an `<h1>`; one lead from `description ?? intro ?? tagline ?? summary`;
every `blocks` field through the **real** public `<LeafletDocument>`; every `markdown` field
through the **real** `renderMarkdown` into `.blog-prose`.

**It does not render, and cannot without touching public files:** the cover image; the
`DocumentMeta` date/tag line; `InspectMargin` / Xray anchors; `<Comments>`; the
`.creating-work-page` treatment and `workCategory` chip; the `reveal` animation. The public bodies
that do those things — `StandardPostBody` (`src/pages/BlogPost.jsx:187`) and `CreatingWork`
(`src/pages/CreatingWork.jsx:107`) — are **not exported**, and `BlogPost` deliberately *omits*
`description` where the preview shows it.

**Therefore:** the tab is captioned, verbatim,
*"Approximate — the published page adds its cover, meta line and comments."*
**[CALL]** Do not refactor `BlogPost.jsx` or `CreatingWork.jsx`. *Runner-up: extract a shared body
component — rejected: it edits public route files, and `Xray.css:265` anchors on
`.blog-article, .creating-work-page`, so any DOM drift is a public regression with no test
coverage.*

One honest upside worth noting in the caption: for `blocks`-bodied records the Edit tab is already
~90% a preview — `BlockPreview` mounts the published `<LeafletBlock>` in collapsed rows
(`BlocksEditor.jsx:818`). The Preview tab's real value is the surrounding page chrome.

---

# 7. CSS ARCHITECTURE

Owner of `Admin.css`, `Skeleton.css`: **OWNER-CSS**. Owners of the new sheets: as per §2.1.

## 7.1 The hard constraint

`Admin.css` is **not admin-only**. `RecordEditor.jsx:20` imports it; `EditSheet` renders
`RecordEditor` and is mounted app-wide (`App.jsx:231`); `Exploring.css:6` `@import`s the whole file
into the public `/exploring` route. In the built bundle `.admin-input{` appears **twice** in the
eager `index-*.css`.

**Rule for every owner: treat every existing `.admin-*`, `.rf-*`, `.record-preview*`,
`.arena-cover-*` and `.category-field-*` selector as frozen public API.** No renames, no
declaration changes, no deletions except the enumerated list in §7.4.

## 7.2 Naming convention

| Prefix | Meaning | Sole owner | File |
|---|---|---|---|
| `.wb`, `.wb-shell*`, `.wb-rail*`, `.wb-pane*`, `.wb-tabs*`, `.wb-strip*`, `.wb-studio*`, `.wb-skel*` | Workbench shell | OWNER-SHELL | `src/admin/adminShell.css` |
| `.wb-list*` | List column | OWNER-LIST | `src/admin/panes/recordListPane.css` |
| `.wb-editor*` | Record detail pane | OWNER-EDITOR | `src/admin/panes/recordDetail.css` |
| `.fd-*` | Front desk | OWNER-DESK | `src/admin/frontDesk.css` |
| `.admin-*`, `.rf-*` | **Existing, frozen** | OWNER-CSS | `src/pages/Admin.css` |
| `.skeleton-*` | Loading placeholders | OWNER-CSS | `src/components/Skeleton.css` |

Sub-prefixes are disjoint, so three owners can write `.wb-`-prefixed rules without collision.
Zero `border-radius` everywhere (`--radius-1..3` are all `0`, `theme.css:87-89`) — do not
reintroduce one.

## 7.3 Density scoping — the concrete strategy

The shell root carries `class="wb"`. `adminShell.css` redefines an **enumerated, closed set** of
global tokens on that class only:

```css
.wb {
  --space-3: 0.6rem;
  --space-4: 0.8rem;
  --space-5: 1.1rem;
  --text-base: 0.95rem;
  --leading: 1.45;
  --measure: 68ch;
}
```

Because CSS custom properties inherit, every `.admin-field`, `.admin-input`, `.rf-card` etc.
rendered **inside** the shell gets the denser scale automatically, while the *same classes*
rendered in the public quick-edit sheet — which is portalled to `document.body`
(`EditSheet.jsx:196`), outside `.wb` — and on `/exploring` keep the global scale. **No `.admin-*`
rule is touched, and no rule is duplicated.**

**Hard limits on this mechanism.** `.wb` may redefine **only** the six tokens above. It must never
redefine a colour token (that fights `[data-theme]`, `theme.css:151-227`), `--chrome-*`,
`--radius-*`, `--edit-bar-h`, or the font stacks.

**Font tokens, for new `.wb-`/`.fd-` rules only.** Use `--code` for JSON dumps and raw data — it
stays monospace in every font mode (`theme.css:58-61`), unlike `--mono`, which folds to serif under
`[data-font='serif']` (`theme.css:104-111`), the mode `main.jsx` always sets. **This is guidance for
new rules and nothing else:** the reused, frozen `.admin-record-rkey` (`Admin.css:238-243`) is
deliberately `var(--mono-ui)`, which resolves to `var(--font-crimson)` (`theme.css:65`) — the serif.
Do not "fix" it; it is a design decision and §7.1 freezes it.

**[CALL]** Token re-scoping over rule duplication. *Runner-up: duplicate every needed rule as
`.wb .admin-field { … }` — rejected: it doubles the stylesheet and the two copies drift.*

Panes paint on `--page`; the rail paints on `--surface-raised` with `--ink-soft` glyphs only. That
keeps `theme.css` untouched — its raised-surface ink re-tune (`:207-227`) is scoped to
`.chrome-bar` / `.modal-panel` and exists for *muted text* on a raised surface, which the rail does
not have.

## 7.4 Disposition of every `Admin.css` rule

`src/pages/Admin.css` is **1074 lines, 160 rule blocks, zero `@media`, zero `[data-theme]`.**

**KEEP, FROZEN (the great majority).** Everything not listed below. In particular the whole
`RecordEditor`-facing set — `.admin-gate-input`/`.admin-input` (`:13`, `:32`), `.admin-textarea(-tall)`
(`:37`, `:43`), `.admin-mono` (`:47`), `.admin-gate-button` (+`-tight`, `:hover`, `:disabled`)
(`:52-83`), `.admin-danger` (`:85`), `.admin-error(-inline)` (`:97`, `:108`), `.admin-success`
(`:112`), `.admin-toolbar` (`:185`), `.admin-link-subtle` (`:194`), `.admin-form` (`:429`),
`.admin-field*` (`:435`, `:498-516`), `.admin-datetime` (`:517`), `.admin-checkbox` (`:527`),
`.admin-actions` (`:535`), `select.admin-input` (`:612`), `.record-preview*` (`:618-639`),
`.category-field*` (`:641-675`), `.arena-cover-*` (`:442-497`), and the entire `.rf-*` block
(`:833-1074`) — is reachable from the public site and must not move.

Also KEEP because they have consumers outside `Admin.jsx`:
`.admin-collection-nsid` (`:155`) — 6 studios; `.admin-collection-group-head/-heading/-note`
(`:707`, `:716`, `:724`) — `ResumeStudio`, `ResumeWorkbench`, `SkyThemeStudio`, `PagesOverview`;
`.admin-page-section` (`:746-762`) — `ResumeStudio`, `PagesOverview`; `.admin-page-panel*` /
`.admin-badge*` (`:543-611`) — `PageContentPanel`; `.admin-record-list` / `-row` / `-link` / `-rkey`
/ `-main` / `-preview` / `-chip` / `-time` (`:209-286`) — reused by the new list pane and by
`PagesOverview`, `ResumeStudio`, `ListeningManager`; `.legacy-blog-*` (`:764-828`) — the lifted
`LegacyBlogMigration`.

**FIX — exactly ONE declaration.**

| Line | Now | Becomes | Why |
|---|---|---|---|
| `:672` | `.category-field-chip.is-active { color: var(--paper) }` | `color: var(--page)` | `--paper` is defined nowhere and there is **no fallback**, so the declaration is invalid-at-computed-value-time and the property falls back to `inherit` — the chip renders `--ink` text on an `--ink` background. **This is a visible change** — call it out in the PR rather than claiming parity. Reach: §10.7. |

**The revision-1 `:667` fix is withdrawn [RESOLVED, revision 2].** It proposed
`.category-field-chip:hover { background: var(--surface-3, rgba(0,0,0,0.05)) }` →
`var(--highlight, …)`. Both the premise and the effect were wrong:

- `--surface-3` behind a deliberate literal fallback is an **established idiom in this codebase**,
  used identically three times in `src/components/blocks/blocks.css` (`:295`, `:339`, `:391`). An
  undefined token with a working fallback is not a bug report.
- `--highlight` is **not a neutral**: `rgba(94,122,71,0.16)` in light (`theme.css:22`),
  `rgba(163,180,134,0.16)` in dark (`:135`), and `var(--sky-highlight, rgba(156,201,201,0.16))` in
  the sky theme `main.jsx` always sets (`:165`). The swap would replace a 5% neutral black wash with
  a 16% accent-green/teal one — an unflagged visible change to a selector §7.1 declares frozen
  public API, listed in neither §7.4's annotations nor §10.7.

**Leave `Admin.css:667` exactly as it is.**

**DELETE (only rules whose sole consumer is deleted code — each verified by grep across
`src/**/*.jsx`).**

| Lines | Selectors | Sole consumer |
|---|---|---|
| `:118-134` | `.admin-collection-list`, `.admin-collection-row`, `.admin-collection-row:first-child` | `Admin.jsx` (`CollectionPicker`) |
| `:137-169` | `.admin-collection-link`, `:hover .admin-collection-label`, `.admin-collection-label`, `.admin-collection-summary` | `Admin.jsx` |
| `:170-184` | `.admin-custom-row` (3 rules) | `Admin.jsx` (`CustomCollectionInput` markup) |
| `:288-291` | `.admin-select-toggle` | `Admin.jsx` (Select/Done toggle, removed by §3.5.4) |
| `:300-382` | `.admin-active-resume*` (10 rules) | `Admin.jsx` (`ResumeActiveSelector`, deleted) |
| `:677-698` | `.admin-quick-actions` (3 rules) | `Admin.jsx` (picker quick actions) |
| `:699-706` | `.admin-collection-group`, `:first-of-type` | `Admin.jsx` only (the `-head`/`-heading`/`-note` children have other consumers — **keep those**) |
| `:732-744` | `.admin-collection-group-legacy`, `.admin-collection-row-legacy` (+ hover) | `Admin.jsx` |

Keep `.admin-multiselect-*` (`:293-298`, `:385-428`) — the new list pane adopts the always-on
multiselect model and reuses them verbatim.

Also delete from JSX (OWNER-SHELL, with `Admin.jsx`): the class `admin-collection-row-custom`
applied at `Admin.jsx:368`, which matches **no rule in any stylesheet**.

**Net:** ~35 rules deleted, **1** fixed, ~124 frozen, 0 renamed. `Admin.css` is otherwise
append-only for genuinely new names — and there should be none, because new work lives in the
`.wb-`/`.fd-` sheets.

## 7.5 Studio CSS notes

- `PublicationsManager.css:21` and `:115` use `var(--paper)` (undefined, **no fallback**) →
  `var(--page-edge)`. This changes those two surfaces from transparent to a card fill: **a
  deliberate visible change**, not a silent fix. Admin-only in reach.
- `RatioedPanel.css:46` (`border-radius: 3px`) and `:69` (`2px`) → `0`.
- `RatioedStudio.css` references `--ratioed-seal` / `--ratioed-reply` / `--ratioed-quote`, which
  are only ever defined on `.ratioed` (`blocks/RatioedBlock.css:12-15`), so the studio has always
  rendered the hardcoded fallbacks (`#8c3a2e`, `#5e7a47`, `#8a6f24`). **[CALL]** Define them on the
  studio's own root (`.rs-root { --ratioed-seal: …; }`) with today's fallback values, so the
  rendering is unchanged but no longer accidental. *Runner-up: drop the `var()` and inline the
  hexes — rejected: loses the seam for a future theme.*
- `PublicationsManager.css:149` `.pub-raw` is `white-space: pre` on a 22-row textarea — wrap it in
  an `overflow-x: auto` container so the pane body never scrolls horizontally.
- The seven container-query conversions are enumerated in §3.6 item 4.

## 7.6 Skeletons

`Skeleton.css:392-539` hand-mirrors `Admin.css` geometry, and the comments there say so
(`:392`, `:453`, `:502`).

**OWNER-CSS has exactly one obligation:** the rkey column is out of sync — skeleton `9ch`
(`Skeleton.css:443`) vs real `14ch` (`Admin.css:240`). Fix the skeleton to `14ch`. All seven
`AdminRecordListSkeleton` consumers are admin, so this is admin-only in reach.

**`WorkbenchSkeleton` does NOT live in `Skeleton.jsx` [RESOLVED, revision 2].** `Skeleton.jsx` and
`Skeleton.css` are in the **eager public bundle** — `App.jsx:34` statically imports `EditSheet`,
`EditSheet.jsx:10` imports `RecordEditor`, `RecordEditor.jsx:11` imports `Skeleton.jsx` — while the
admin is carefully lazy (`App.jsx:25`). Putting an admin-only component and an admin-only CSS block
there ships them to every public visitor for no benefit. Instead:

- `src/admin/WorkbenchSkeleton.jsx` (OWNER-SHELL, Stage 2) — rail strip + list rows + a field stack,
  mirroring `.wb-shell`'s grid, used by `AdminShell` while `useAdminData` first resolves.
- Its rules are `.wb-skel*` in `src/admin/adminShell.css` (OWNER-SHELL).
- It **reuses `AdminEditorSkeleton`** (`Skeleton.jsx:566`) inside the detail pane rather than
  inventing a second one; `RecordEditor` already renders it internally while fetching
  (`RecordEditor.jsx:338-340`). Importing from `Skeleton.jsx` is free — it is already in the eager
  bundle either way.
- `Skeleton.jsx` is therefore **UNCHANGED** (§2.4).
---

# 8. MOBILE

**Breakpoint: `@media (max-width: 60rem)` (960px).** **[CALL]** One admin breakpoint, and it
deliberately catches tablets. *Runner-up: the site's standard 700px (`app.css:35`, `:313`,
`ChromeBar.css:21`, `useChromeBar.jsx:5`) — rejected: between 701px and 960px, a 3.25rem rail plus
a 22rem list leaves the detail pane under 20rem wide, which is unusable for the blocks editor.*
The site's global 700px rules (type scale, the iOS 16px input floor) still apply on top and are
untouched.

Above 60rem: three columns. At or below: **drill-down stack**.

Note that pane-internal reflow is a **container** query against `wbpane`, not this breakpoint
(§3.6 item 4) — the two are independent, which is the point: a 34rem pane reflows at 1600px viewport
just as it does at 900px.

## 8.1 The stack

`AdminShell` sets `stacked: true` (from a `matchMedia('(max-width: 60rem)')` listener) and derives
`column` (§3.3):

- The **rail becomes a horizontal chip row** pinned under the top chrome:
  `position: sticky; top: var(--chrome-top-h, var(--chrome-h)); overflow-x: auto;
  scroll-snap-type: x proximity;` with the same `.wb-rail-btn` chips plus their labels, and
  `scroll-margin-inline` so the active chip scrolls into view on mount. Full-bleed to the viewport
  edges using the existing `--chrome-pad-x` inset (`ChromeBar.css:16-19`) so the chips line up with
  the chrome bars above and below.
- Exactly **one** of the list column and the detail pane is rendered at a time — the other is
  unmounted, not hidden. This is enforced by `showList` / `showDetail` in §3.3; revision 1 rendered
  the detail pane unconditionally and so violated its own rule. (Unmounting is safe: the list's
  fetched records live in `useAdminData`'s cache, and the detail pane's editor state is per-record
  anyway.)
- **Column derivation is from the URL, and only from the URL:**
  `column = (rkey || isNew) ? 'detail' : 'list'` for records surfaces; studios and the dashboard are
  always `'detail'`. There is **no `setColumn`** (§3.2).
- **Back** is a `← <Surface label>` button at the top of the detail pane. It calls
  `go({ r: null, mode: null })` — which pushes and changes the URL, so `column` re-derives, and the
  browser back button and the on-screen back button do the same thing and never desync.
- Browser back from a record lands on the list; back again lands on the previous surface; back
  again on the Front Desk. Same push chain as desktop (§4.3).

## 8.2 Dashboard on phones

- Counts row: `grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr))`.
- Needs you and Latest records stack full-width, Needs you first.
- Surface grid: one column per group, groups stacked, each group collapsed to its heading + a
  wrapped chip row (no `blurb` below 60rem — blurbs appear on the desktop tiles only).

## 8.3 List column on phones

Full-width rows, the filter box sticky at the pane top, the sort control folded into a `<select>`
beside it. Multiselect checkboxes are always visible (no hover state on touch). "Load more" stays
a button — no infinite scroll.

## 8.4 Detail pane and the sticky save bar

- Tab bar sticky at the pane top, directly under the chip row.
- **Sticky save bar** — the same `AdminStatusStrip` element, which is the **first child of
  `.wb-pane-detail`** (§3.3/§3.7), re-anchored:
  ```css
  @media (max-width: 60rem) {
    .wb-strip {
      position: sticky;
      top: auto;
      bottom: calc(var(--chrome-h) + env(safe-area-inset-bottom, 0px));
      z-index: 20;
    }
  }
  ```
  A first-child sticky box with `bottom` and no `top` floats **down** to the scrollport bottom and
  pins there, released only when the pane's own bottom edge scrolls past it — which is exactly the
  behaviour wanted, and it is only available because the strip lives *inside* the pane. Sticky (not
  fixed) so it needs no measured custom property and cannot double-count against `.app-shell`'s
  `padding-bottom` sum (`app.css:15-18`). z-index 20 keeps it under both chrome bars (30) and the
  edit bar (33).
- **The Save button is a plain `<button type="button" onClick>` rendered outside `.blocks-editor`.**
  Non-negotiable — see `BlocksEditor.jsx:334-384`.
- `usePreventScrollChain` is **not** used here; the detail pane scrolls with the document.

## 8.5 Studios on phones

Each studio's viewport `@media` blocks become container queries against `wbpane` (§3.6 item 4), so
they fire on pane width at every viewport. Specific notes:

- **Sky studio**: keeps its body-portalled fixed hour bar (`SkyThemeStudio.jsx:456-487`) and
  `--sky-hourbar-h` (`:147-162`). Because the admin save strip is *sticky* and the hour bar is
  *fixed*, they cannot stack — but if the strip is visible while the hour bar is up, the strip must
  add `bottom: calc(var(--chrome-h) + var(--sky-hourbar-h, 0px) + env(safe-area-inset-bottom, 0px))`.
  Sky is `fullWidth`, and it is a studio, so it has no list column to drill into.
- **Ratioed studio**: `fullWidth`, no list column. `.rs-feed-row`'s 4-column grid
  (`RatioedStudio.css:180`) collapses via the `:233` container query.
- **Resume workbench**: already a single vertical stack (`resumeStudio.css:188-191`) — no layout
  change, but **both** `@media (max-width: 40rem)` blocks convert: `:228` (`.rw-framing` → one
  column) and `:554` (`.rw-bullet` wrap). Revision 1 named only `:554`; left as a viewport query,
  `:228` fires at ~640px viewport while the pane is already ~34rem, so `.rw-framing` stays
  two-column in a pane far too narrow for it. Its unsaved chip is superseded by the strip.
- **Guestbook / Nav / Publications / Pages / Ratioed catalogue / Legacy blogs**: single column,
  unchanged internals.

---

# 9. BUILD ORDER

| Stage | Work | Owner(s) | Mode | Depends on |
|---|---|---|---|---|
| **0** | Record the baseline: `npx vitest run` → 339/339; `npx eslint .` → 3 errors / 67 warnings; `npm run build:offline` → success. Commit nothing. | any | **sequential (gate)** | — |
| **1** | `src/admin/surfaces.js`, `surfaces.test.js`, `recordFields.js`, `useAdminData.js`. Pure modules, no JSX beyond types. | OWNER-DATA | **sequential** | 0 |
| **2** | `src/admin/useAdminShell.jsx`, `AdminShell.jsx`, `AdminRail.jsx`, `AdminStatusStrip.jsx`, `WorkbenchSkeleton.jsx`, `adminShell.css`; rewrite `src/pages/Admin.jsx` to gates + `<AdminShell/>`. Panes may be `null` placeholders. **The admin must build and render an empty shell at the end of this stage.** | OWNER-SHELL | **sequential** | 1 |
| **3a** | `FrontDesk.jsx` + `frontDesk.css` | OWNER-DESK | **parallel** | 2 |
| **3b** | `RecordListPane.jsx` + `recordListPane.css` (+ `HeroSeedButton` copy) | OWNER-LIST | **parallel** | 2 |
| **3c** | `src/lib/recordDiff.js` + tests; `RecordEditor.jsx` additive props + four fixes; `RecordDetail.jsx` + `recordDetail.css` | OWNER-EDITOR | **parallel** | 2 |
| **3d** | `StudioPane.jsx`; lift `ListeningManager` / `PagesOverview` / `LegacyBlogMigration`; apply the studio contract to all 9 studios **including removing `setPageEditor` from `ResumeWorkbench`**; extract `setActiveResume` into `src/lib/resumeAdmin.js`; the seven studio-CSS container queries | OWNER-STUDIOS | **parallel** | 2 |
| **4** | ChromeBar's two `!inAdmin` guards | OWNER-SHELL | **parallel** | 2 |
| **5** | `Skeleton.css:443` rkey re-sync `9ch` → `14ch`. (One line. `Skeleton.jsx` is untouched — §7.6.) | OWNER-CSS | **parallel** | 0 |
| **6** | Integration pass: wire the four panes into `AdminShell`'s dispatch; verify no pane strands `registerActions` | OWNER-SHELL | **sequential** | 3a, 3b, 3c, 3d |
| **7** | `Admin.css` deletions + the one var fix; `PublicationsManager.css` / `RatioedPanel.css` fixes | OWNER-CSS + OWNER-STUDIOS (their own files) | **sequential** | 6 |
| **8** | Remove `pageEditor` / `setPageEditor` from `useEditMode.jsx` and `EditModeBar.jsx` (§6.1) | OWNER-EDITOR | **sequential** | 3d, 6 — **must be last code change**; 3d removes the only remaining producer |
| **9** | Acceptance (§10) | any | **sequential** | 8 |

Stages 1 and 2 may be run concurrently by a scheduler that trusts §3.1 and §3.2 verbatim; they are
marked sequential because the fleet does not communicate and the foundation is where a mismatch is
most expensive.

## Lint discipline — read this before writing any loop [RESOLVED, revision 2]

**`no-await-in-loop` is not an enabled rule.** It is absent from `eslint.config.js:60-74` and from
`js.configs.recommended`. Revision 1 said it "is enforced" and instructed every owner to add
`// eslint-disable-next-line no-await-in-loop` to new sequential write loops. **That instruction was
backwards and would have broken the acceptance gate**, because ESLint 9 reports an unused directive:

```
warning  Unused eslint-disable directive (no problems were reported from 'no-await-in-loop')
```

There are **eight** such directives in the tree and each contributes **one** of the 67 baseline
warnings: `EditModeBar.jsx:146`, `legacyBlog.js:169`, `legacyBlog.js:171`, `resumeAdmin.js:92`,
`Admin.jsx:513`, `Admin.jsx:542`, `Admin.jsx:1105`, `Admin.jsx:1311`.

The rules that follow from that:

1. **The four in `Admin.jsx` must survive the code moves verbatim**, or the warning count drops
   below 67 and §10.1 fails. They travel with the code they annotate:
   `:513` and `:542` → `src/admin/panes/RecordListPane.jsx` (OWNER-LIST);
   `:1105` → `src/components/LegacyBlogMigration.jsx` (OWNER-STUDIOS);
   `:1311` → `src/components/ListeningManager.jsx` (OWNER-STUDIOS).
2. **No owner may add a new `no-await-in-loop` directive** — including OWNER-STUDIOS when lifting
   `setActive` into `resumeAdmin.js` (§3.6). `resumeAdmin.js:92`'s existing directive stays exactly
   where it is; the new `setActiveResume` loop gets **no** directive.
3. Sequential writes are still deliberate throttling, not an oversight. Keep them sequential —
   there is simply no lint rule to placate.
4. The same applies to `react-hooks/exhaustive-deps` directives: `Home.jsx:433` and `:460` are
   already unused-directive warnings. Do not add or remove any.

If the warning count moves, the first thing to check is a directive added or dropped, not a real
new warning.

---

# 10. ACCEPTANCE

## 10.1 Machine checks (must not regress)

```
npx vitest run          # 339 pre-existing tests still pass; total may be HIGHER
                        # (recordDiff.test.js, surfaces.test.js). No existing test file
                        # may be modified.
npx eslint .            # EXACTLY 3 errors, 67 warnings
npm run build:offline   # succeeds
```

The three errors are pre-existing `react-hooks/rules-of-hooks` errors and none is in admin code.
If the warning count moved, see §9's lint discipline first.

## 10.2 Front Desk

1. Load `/admin` signed in as `did:plc:gq4fo3u6tqzzdkjlwzpb23tj`. The dashboard paints
   **immediately** with skeletons; the surface grid is fully clickable before any request resolves.
2. Counts fill in. Every displayed number is either exact or suffixed `+`. Logging, Posting and
   Listening show **no number**.
3. The four tiles read: Documents published, Drafts, Hidden elsewhere, Guestbook. **Drafts and
   Hidden elsewhere must not describe the same records** — with three drafts and nothing else
   hidden, Drafts reads 3 and Hidden elsewhere reads 0.
4. The Needs-you list shows only items with a count > 0, and renders
   *"Nothing needs you right now."* when all are zero. Consistency checks are under their own
   sub-heading. **No guestbook item appears here** — flagged signatures live on `?view=guestbook`.
5. Latest records lists ≤8 rows, newest first, and its caption states that documents carry no edit
   timestamp and that logging/posting/listening are excluded.
6. **No row label is a raw `at://` URI**, and no arena row's label is identical to the rkey beside
   it. A ratioed row reads `Take <n>`.
7. **No ratioed row is dated by its subject post.** Cross-check one against its `measuredAt`.
8. Open devtools → Network, hard-reload `/admin`. Count the requests: ~12 `listRecords`
   (one per countable NSID) **plus exactly two guestbook requests** — one
   `blue.microcosm.links.getBacklinksCount` and one book read. **Not** the ~23-request
   `fetchGuestbookEntries` walk. `app.bsky.feed.post` must appear **zero** times. There must be
   **no `describeRepo` and no `plc.directory` request** (the presence probe is gone).
9. Navigate away and back within 60 s: no new count requests (cache hit).
10. Delete a record from a list. Only that collection's count refetches — not the whole batch, and
    **not** the guestbook.
11. Type an arbitrary NSID into "open any NSID" (e.g. `app.bsky.graph.follow`) → it opens in the
    shell with **no full page reload** (the Network panel shows no document request).

## 10.3 Workbench

12. Pick Blogging in the rail. Three columns appear. Scroll the list; the detail pane and the page
    scroll independently of the sticky list.
13. Click record A, then record B. **Verify: no crossfade, no scroll-to-top, the rail and list stay
    mounted, and the list's scroll position and filter text are preserved.**
14. Type in the list filter, then click a record: the filter text survives. Click "Load more" with a
    filter applied: it loads (paging is driven by the raw record count).
15. Edit a field. The strip appears at the **top of the detail pane** naming the changed field.
    Click another record → a "Discard unsaved changes?" confirm. Cancel → you stay. Confirm → you
    move.
16. From `?c=is.dame.now&r=<rkey>`, click the Sky rail button. The resulting URL is
    `/admin?view=sky` with **no stale `c` or `r`**, and it is **one** history entry (a single back
    press returns to the record).
17. Open a document with a cover image. Switch Edit → JSON → Edit. **The cover image and any body
    images are still rendered** (`RecordEditor.jsx:310-311`).
18. In the JSON tab, verify the text contains no `updatedAt` that is not on the record.
19. Open a `blocks`-bodied post, type markdown (`## heading`) in a text block, then **tap Save once**.
    One tap must both convert the markdown and save. (`BlocksEditor.jsx:334-384`.)
20. Save. The strip returns to "No unsaved changes" **immediately** — not still dirty.
21. Create a new record: the URL becomes `?…&r=<newRkey>` **without a page reload**, and the shell
    stays mounted.
22. Delete a record: you land back on the list, in-place, and the Delete button is not stuck on
    "Deleting…".
23. Open `?c=app.bsky.graph.follow&r=<rkey>` (no lexicon): only a **JSON** tab is offered, and it is
    editable.
24. Undo test: open record A with a blocks body, edit a block, select record B, press Cmd+Z.
    **Record A's content must not appear in record B.**
25. Browser back walks: record B → record A → list → previous surface → Front Desk.
26. **Residual edit mode:** on `/logging`, tap the pencil to enter "Tap items to select" mode, then
    use the ChromeBar **home** button to reach `/`, then navigate to `/admin`. No edit bar renders
    over the workbench, and `<html>`'s `--edit-bar-h` is `0px`.

## 10.4 Studios

27. Each of the ten `view=` surfaces opens in the pane with **exactly one `<h1>`** on screen and
    **no "← All collections" link**.
28. Every studio's tab title is correct on arrival, including `?view=ratioed-studio` **with no live
    piece** — the tab must read "Ratioed studio — Admin — dame.is", not the title of whatever
    surface you came from.
29. `?view=ratioed-studio` **with** a live piece: the tab title becomes the studio's own alarm
    string; leaving the surface restores the shell title.
30. `?view=sky`: the bottom-bar hour chip still **advances the hour** (not the SkyHourSheet) —
    `ChromeBar.jsx:501` still matches. The palette previews live; leaving the surface restores it.
31. `?view=ratioed`: `measured` / `found` scan results are **not** auto-saved and the strip never
    claims they are unsaved. The Delete-all button is visibly a danger button.
32. Leave `?view=ratioed-studio` for another surface with a piece live: the Jetstream socket closes
    (devtools → Network → WS shows the connection ending).
33. `?view=resume`: duplicate a version → lands on `?view=resume-tailor&r=<slug>` with the bundle
    already loaded (**one** set of four paginated `listRecords`, not two — check Network).
34. Open `?view=sky`, `?view=nav`, `?view=guestbook`, `?view=pages` in turn and confirm **zero**
    `is.dame.resume` / `is.dame.resume.job` / `is.dame.resume.education` requests — the hoisted
    `useResumeBundle` must no-op off the resume surfaces.
35. `?view=resume-tailor&r=<x>`: edit a bullet, then click another version in the list → confirm
    prompt; the strip names the shared-record count. Tick **Active** → **nothing is written until
    Save**; after Save, exactly one version has `featured: true`.
36. `?view=publications`: select a publication → the URL becomes `?view=publications&r=<rkey>` and
    `PublicationsManager` is **still on screen**; select another → the fields update to the **new**
    record (the `key` remount was replaced by a sync effect). Try to save with an empty `url` →
    still refused.
37. `?c=site.standard.publication` still opens the **generic record list**, not the studio; and
    `?c=is.dame.guestbook&r=self` still opens the **generic editor** for the book record, not the
    moderation panel.
38. `?view=guestbook`: the flagged-signature count appears **here**, captioned
    "auto-hidden by the language filter, not on your hidden list (first page)" — **not** "awaiting
    review".
39. `?view=nav`: "Reset to site defaults" now confirms; the strip clears after a save that dropped
    incomplete rows.
40. Resize any studio's pane below ~34rem at a **wide viewport** (e.g. by opening the list column on
    a records surface): the studio's internal grids reflow. Specifically `.rw-framing` in the resume
    workbench goes to one column (`resumeStudio.css:228`).

## 10.5 Mobile (≤ 960px)

41. Narrow to 900px: the chip row appears, the list is a single full-width column, and **the detail
    pane is not in the DOM** (inspect: `.wb-pane-detail` is absent while on the list).
42. Tap a record → the detail pane replaces the list; `.wb-pane-list` is now absent; a `← Blogging`
    back control appears.
43. Edit a field → the sticky save bar sits directly above the bottom chrome bar, does not overlap
    it, and does not overlap the last field. Tap Save once — it saves.
44. Rotate / resize back above 960px mid-edit: the three columns return and the dirty state
    survives.
45. iOS: focusing a text field does not zoom the viewport (`app.css:35` still applies).

## 10.6 Public-site collateral — re-check every one of these

The whole point of the constraints. Sign in as the owner and check on **public routes**:

46. **The render-cost check.** On `/logging`, select a row and open the quick-edit sheet. Open the
    React DevTools profiler, record, type **20 characters** into a text field, stop. **`ChromeBar`
    must not re-render, and no `FeedItem` may re-render.** This is the constraint §6.2 protects: the
    `onStatus` payload and its dep array are unchanged, so `EditModeContext` must republish exactly
    as often as it did before.
47. `/blogging/<slug>` → pencil → quick-edit sheet opens; the bottom `EditModeBar` shows
    Close / Delete / Save; saving works. **This is the `sheetEditor` path and must be pixel- and
    behaviour-identical to before.**
48. In that sheet, on a record **with a cover image**: tap **Edit JSON**, then **Use form**.
    The cover image and any body images **still render** — they do not revert to "Click to upload".
    (This is §6.3 fix 1, and it is a change to what the owner sees on a public route.)
49. In that sheet, tap **Edit JSON** on a record that has no `updatedAt`: the JSON shows no
    `updatedAt`. (§6.3 fix 2, same reach.)
50. In that sheet, **delete** the record. The sheet closes cleanly, the row disappears, and the
    bottom bar's editor cluster unmounts with it. (§6.3 fix 3 — expected to be invisible; see
    Appendix A/R1.)
51. In that sheet, "Open in full editor" (`EditSheet.jsx:77-78`) lands on `/admin?c=…&r=…` and opens
    the record in the new shell.
52. `/` , `/posting`, `/logging`, `/listening`, `/welcoming` → pencil → "Tap items to select"
    select mode, bulk delete works. `selectionPage` behaves (visit `/logging`, then `/admin`, then
    `/blogging/<slug>` → the pencil still opens the record editor there, not select mode).
53. `/exploring` and `/exploring/<repo>/<collection>/<rkey>`: unchanged. It `@import`s `Admin.css`
    (`Exploring.css:6`), so any deleted rule shows up here first. `RecordEditor` renders there with
    no `onStatus`, no `mode` and no `onDirtyChange` (`Exploring.jsx:919`) and must behave exactly as
    today.
54. `/welcoming` in owner edit mode: the guestbook rows, hide/unhide badges and the "Earlier
    signatures" button are unchanged (`GuestbookEntryRow.jsx` + `Guestbook.css` are shared).
55. `/available` (resume): unchanged, including the bottom-bar print button.
56. Leave `/admin` for any public page and confirm **`document.documentElement` no longer has
    `data-admin-shell`** and `.main` is back to 72rem.
57. Inspect `<html>` on a public page: `--edit-bar-h` is `0px` when nothing is being edited.
58. `/curating`, `/creating/<slug>`, `/themself`: visual spot-check — these render
    `.record-preview*` / `.category-field-*` / `.blog-article` vocabulary indirectly.
59. **Font check:** `Admin.css:667`'s `.category-field-chip:hover` is unchanged — it still resolves
    to the neutral `rgba(0,0,0,0.05)` literal, **not** an accent wash.

## 10.7 Deliberate visual changes to confirm in review

Three changes are visible somewhere. **Two of them are on public routes, and neither is a "pixel"
change — they are changes to what the editor shows.** All must be named in the PR body rather than
discovered.

| # | Change | Where it is visible |
|---|---|---|
| 60 | `.category-field-chip.is-active` text colour: was `inherit` via the undefined, fallback-less `var(--paper)`; becomes `var(--page)` (`Admin.css:672`) | **`/exploring/<repo>/is.dame.creating.work/<rkey>`** — a public route (`Exploring.jsx:919` renders `RecordEditor`) — and the admin against a re-created record. **NOT** the public quick-edit sheet: `type: 'category'` appears on exactly one field in the whole registry, `COLLECTIONS.creating`'s `category` (`lexicons.js:72`), and `is.dame.creating.work` is **absent from this repo**, so no feed row can open a record that mounts `CategoryField` (`RecordEditor.jsx:922-950`). *(Revision 1 claimed the public quick-edit sheet; that acceptance step could not have been run.)* **Verify by pointing `/exploring` at a foreign repo that holds such a record**, or accept it unverified and say so in the PR. |
| 61 | `.pub-list-row` / `.pub-icon-empty` gain a card fill (`PublicationsManager.css:21`, `:115`, the same undefined `--paper`) | Admin only (`?view=publications`). |
| 62 | The Edit↔JSON round-trip in the **public quick-edit sheet** stops stripping image display URLs and stops showing a phantom `updatedAt` (§6.3 fixes 1 and 2) | **Public routes** — every record reachable through the pencil. Both are bug fixes, both change what the owner sees. Acceptance steps 48 and 49. |

`Admin.css:667` is **not** in this list, and must not be changed (§7.4).
---

# Appendix A — Rejected objections

Every review objection was re-verified against the working tree. **31 were accepted** and are folded
into the sections above, each marked `[RESOLVED, revision 2]`. **One was rejected**, and one was
accepted with a correction to the reviewer's own reasoning.

### R1 — REJECTED: "resetting `deleting` in a `finally` changes the button state during the sheet's 0.34s exit animation"

*Objection (guardian-of-the-public-site, serious, part (b)): §6.3's `finally { setDeleting(false) }`
is a public-path behaviour change, because `EditSheet` keeps `RecordEditor` mounted through the exit
(`EditSheet.jsx:116-124`), so the owner would see a flash of a re-enabled Delete button. Proposed
acceptance step: "delete a record from the public sheet and confirm the sheet closes cleanly with no
flash of a re-enabled Delete button."*

**The mechanism is right; the consequence is not. There is no Delete button in that subtree to
flash, and the one that exists has already unmounted.**

1. **`RecordEditor`'s own Delete button is not rendered in the sheet.** The entire Save/Delete row —
   including the `{deleting ? 'Deleting…' : 'Delete'}` label at `RecordEditor.jsx:430` — sits inside
   `{!hideActions && (…)}` at `RecordEditor.jsx:413`, and `EditSheet.jsx:154-155` passes
   `compact hideActions`. So inside the sheet, `deleting` has **no visual expression at all**.
2. **The visible Delete button belongs to `EditModeBar`, and it is gone before `finally` runs.**
   That button is driven by `sheetEditor.deleting`, published by `EditSheet`'s effect at `:87-94`.
   The effect's first branch is `if (!editSheet || !editable) { setSheetEditor(null); return; }`
   (`:83-86`), and `EditModeBar` renders the editor cluster only when
   `editing = onSheet = !!editSheet` (`:96-97`). `onDeleted` calls `closeEditSheet()`
   (`EditSheet.jsx:167`), which sets `editSheet = null` — so by the time any `deleting` value could
   propagate, `editing` is false and the cluster is unmounted.
3. **The two state writes are batched anyway.** `onDeleted?.()` and the new `finally` run in the
   same synchronous tick of `handleDelete` (`RecordEditor.jsx:292-302`), so React 18 batches
   `setEditSheet(null)` and `setDeleting(false)` into one render pass. There is no intermediate
   frame in which `editSheet` is non-null and `deleting` is false.

The fix is therefore **admin-visible only** — which is exactly why it is needed: in the persistent
detail pane the button stays mounted and would stick on "Deleting…". §6.3 now labels fix (3) as not
publicly observable, and §10.7 does not list it as a visible change.

The reviewer's *broader* point in the same objection — that §10.7's closing sentence was false and
that fix (1) and fix (2) **are** reachable from the public quick-edit sheet through the unguarded
mode toolbar at `RecordEditor.jsx:345-364` — is **accepted in full**. §10.7 is rewritten, and
acceptance steps 48, 49 and 50 were added. Step 50 (delete from the public sheet) is kept anyway:
it costs nothing and it exercises the changed code path.

### R2 — ACCEPTED, with one clause corrected: "§10.7 item 43's acceptance step cannot be run"

*Objection (guardian-of-the-public-site, minor): `type: 'category'` exists on exactly one field in
the whole registry (`lexicons.js:72`, `COLLECTIONS.creating`), and `is.dame.creating.work` is absent
from the repo, so `CategoryField` never mounts on a public route and the `.category-field-chip.is-active`
step is unrunnable as written.*

**Accepted** — verified: `grep "type: 'category'"` returns exactly one hit, and `describeRepo`
confirms `is.dame.creating.work` is absent from the 147 collections. §10.7 row 60 is rewritten.

**One clause of the fix is not adopted.** The objection concludes the change is "admin-and-/exploring-only
in reach, **not public-route reach**". `/exploring` **is** a public route — this spec's own §10.6/#53
treats it as one, `Exploring.css:6` `@import`s `Admin.css` into it, and `Exploring.jsx:919` renders
`RecordEditor` there for any repo. So the change *is* publicly reachable; it is only the *quick-edit
sheet* framing that was wrong. §10.7 row 60 says so, and points the verification at
`/exploring/<foreign-repo>/is.dame.creating.work/<rkey>`.

---

# Appendix B — What changed in revision 2

Grouped by what forced the change, so a reader of revision 1 can diff quickly.

## Corrections to facts revision 1 asserted

| # | Revision 1 said | Truth | Where |
|---|---|---|---|
| B1 | "`--paper` and `--surface-3` are genuinely undefined" (both treated as bugs) | Only `--paper` is a bug — it has **no fallback**. `--surface-3` behind a literal fallback is an established idiom (`blocks.css:295`, `:339`, `:391`) | Baseline, §7.4 |
| B2 | "`no-await-in-loop` is enforced… every new loop needs a disable comment" | The rule is **not enabled**. All eight in-tree directives are *unused-directive warnings* and part of the 67. Adding one **breaks** the gate | Baseline, §9 |
| B3 | `:root[data-admin-shell] .main` is "(0,2,1)" | It is **(0,3,0)**. Conclusion unchanged | §3.3 |
| B4 | `--edit-bar-h` "returns to `0px` on `/admin` automatically" | Only when `active` is also false, which no route change clears (`useEditMode.jsx:108-118`, `EditModeBar.jsx:110-114`) | §3.3, §6.1 |
| B5 | `beginRefresh`/`endRefresh` make "the ChromeBar mark pulse like every other fetch" | `subscribeRefresh`/`isRefreshing` have **zero importers**; the mark is an avatar (`ChromeBar.jsx:257-268`); `beginRefresh` has one caller (`Home.jsx:300`) | §5.1 |
| B6 | `invalidate()` "clears the entry" in `feedCache` | `feedCache.js` exports no clear, and it is read-only | §5.1 |
| B7 | `hiddenCount` is "**Exact.**" | Exact as a *list length*; approximate upward as hidden signatures, per the comment two lines above it (`guestbook.js:163-167`) | §5.3 |
| B8 | "One `fetchGuestbookEntries({limit:25})`" | ~23–100 requests across three hosts, with two unbounded `Promise.all`s (`guestbook.js:86-151`, `:194-202`, `:182-188`) | §5.3 |
| B9 | `updatedAt` is "the `autoOnEdit` field shared by most `is.dame.*` lexicons", making `touchedAt` a real touch signal | True for most, **false for `site.standard.document`**, which spreads no `COMMON_TIMESTAMPS` (`lexicons.js:93-127`). Live: 0 of 27 docs carry it | §5.5 |
| B10 | `EditSheet` "stores the whole `onStatus` object in state, so extra keys are inert" | Semantically true, **false for render cost** — the widened payload re-publishes `EditModeContext` per keystroke on public routes | §2.4, §6.2 |

## Blocking defects fixed

| # | Defect | Fix |
|---|---|---|
| B11 | Widened `onStatus` fires app-wide `EditModeContext` churn on public routes, per keystroke | `onStatus` unchanged; a separate optional `onDirtyChange` prop that only `RecordDetail` passes (§6.2) + acceptance 46 |
| B12 | §3.3's render tree contained **no `.wb-shell`**, and put `AdminStatusStrip` as a grid sibling of the panes — so the workbench had no layout, and the strip could not stick to a pane it was not in | Explicit tree with `.wb-shell`; strip is the **first child of `.wb-pane-detail`** (§3.3, §3.7, §8.4) |
| B13 | `.wb-pane-detail` rendered unconditionally, so the stacked drill-down showed **both** columns | `showDetail` derived alongside `showList` (§3.3, §8.1) |
| B14 | PublicationsManager selection at `?c=site.standard.publication&r=` resolves to a records-list and unmounts the studio | Moved to `?view=publications&r=` / `&mode=new`; `r`/`mode` declared legal on `view=` surfaces (§3.1, §3.6, acceptance 36) |
| B15 | Guestbook surface pointed at `is.dame.guestbook.entry`, which by design does not exist on this repo → silent `0` on the one surface with real work | `nsid: 'is.dame.guestbook'` + new `offRepo` flag exempting it from counting and dimming (§1, §3.1, §5.1) |
| B16 | "Published" tile throws on ~7 Tier-A NSIDs (`visibilityModelFor` → `null`) and, guarded, is a cross-collection sum the spec forbids | Replaced by a document-scoped "Documents published"; every visibility read is `?.isHidden(v) ?? false` (§5.2) |
| B17 | "Pick back up" has no edit signal for documents; the first document ranked 11th | Renamed "Latest records" with an honest caption; `latestInstant` accessor (§5.5) |
| B18 | `tidToTimestamp(rkey)` dates ratioed pieces by their **subject post's** rkey (`lexicons.js:336-340`) — 5 of the top 8 rows | TID fallback gated on `lexiconFor(nsid)?.rkeyMode === 'tid'`; `LAST_RESORT` map supplies `measuredAt` (§5.5) |

## Contract gaps closed

| # | Gap | Fix |
|---|---|---|
| B19 | `fullWidth` was dead (`showList` was already false for every studio) | Redefined as the pane **measure clamp**, not the column count (§3.1, §3.3) |
| B20 | `ownsTitle` left the tab title stale when `RatioedStudio` has no live piece | Deleted; the shell always passes `headTitle` and the studio's own effect composes on top (§3.1) |
| B21 | `key` jsdoc said `?view=` values are the non-records-list surfaces — but `blogging`/`creating` are both | New `urlByView` boolean; `href`, `rowHref` and the registry test defined in terms of it (§3.1) |
| B22 | `resolveSurface`'s `?c=` branch was ambiguous — could have mapped `?c=` onto a studio | Written out in full: **a `?c=` URL never resolves to a studio** (§3.1, acceptance 37) |
| B23 | `go(patch)` is merge-only, so no rail click could clear a stale `c`/`r` | Exact patches with explicit nulls for every rail click and row click (§3.4, §3.5); the second "programmatic correction" pass deleted (§4.3) |
| B24 | `setColumn` was dead API that could desync the pane from the URL | Removed from `AdminShellCtx` (§3.2, §8.1) |
| B25 | "`StudioPane` calls `useResumeBundle` once" had no mechanism and conflicted with the RatioedStudio unmount requirement | `useResumeBundle(isResume ? agent : null, …)` + `key={surface.key}` on the **child** element; `useResumeBundle.js` becomes UNCHANGED (§3.6, acceptance 33/34) |
| B26 | `featured` was to be routed through `VersionsSection.setActive` — an unexported closure that writes immediately, into a staged-draft component, with no file named to hold the shared helper | `src/lib/resumeAdmin.js` gains an owner and exports `setActiveResume`; the workbench checkbox stays staged and the sibling clear happens inside `save()` (§2.2, §3.6, acceptance 35) |
| B27 | §3.6 item 4's `@media` list omitted `resumeStudio.css:228`, and §8.5 asserted the workbench needed only `:554` | Audit **rule** plus the complete seven-block table (§3.6, §8.5, acceptance 40) |
| B28 | Presence probe was specified as both non-blocking and count-skipping, and was redundant | Deleted; `count === 0` is the dimming rule, `offRepo` is exempt (§5.1, acceptance 8) |
| B29 | Drafts and Hidden counted the same three records twice | "Hidden elsewhere" excludes documents (§5.2, acceptance 3) |
| B30 | `previewFor` labels ratioed rows with an `at://` URI and arena rows with the rkey | `rowLabel` with a per-NSID override map in `recordFields.js`; `previewFor` kept verbatim (§5.5, acceptance 6) |
| B31 | §5.4 specified no empty state, and three of six items are permanently zero | Empty state written verbatim; list split into **Work** and **Consistency checks**; the flagged-signature item moved to the guestbook surface (§5.4) |
| B32 | `WorkbenchSkeleton` + `.skeleton-wb-*` were slated for `Skeleton.jsx`/`Skeleton.css`, which are in the **eager public bundle** | Moved to `src/admin/WorkbenchSkeleton.jsx` + `adminShell.css`; `Skeleton.jsx` becomes UNCHANGED and OWNER-CSS keeps only the one-line `Skeleton.css` re-sync (§2.1, §2.4, §7.6, Stage 5) |
| B33 | `Admin.css:667` `--surface-3` → `--highlight` was an unflagged visible change on frozen public API | Row withdrawn; §7.4 now has **one** fix, not two (§7.4, acceptance 59) |
| B34 | §10.7's "only intentional pixel changes outside `/admin`" was false — two `RecordEditor` fixes are publicly observable | §10.7 rewritten as a three-row table; acceptance 48/49 added (§6.3, §10.7) |
| B35 | §10.7 item 43's acceptance step was unrunnable (no `category` field reachable from the public sheet) | Rewritten and re-pointed at `/exploring` (§10.7 row 60, Appendix A/R2) |

## Consistency pass (no objection; found while reconciling)

- **`container-type: inline-size` on `.wb-pane-detail` makes it a containing block for
  `position: fixed` descendants.** Verified safe: the only `position: fixed` rule reachable from a
  non-portalled admin subtree is `SkyThemeStudio.css:47`, which styles a bar portalled to
  `document.body` (`SkyThemeStudio.jsx:456-487`), and `Modal`, `Lightbox`, `BottomSheet` and
  `ActionDock` all `createPortal` to body as well. Recorded in §2.4 and §3.6.
- **`--mono-ui` is the serif** (`theme.css:65` → `var(--font-crimson)`), and the frozen
  `.admin-record-rkey` uses it deliberately. §7.3's "use `--code` for rkeys" now says explicitly that
  it applies to **new `.wb-`/`.fd-` rules only**, so nobody "fixes" a frozen rule.
- **FILE PLAN re-audited: exactly one owner per file.** Two files left MODIFY (`Skeleton.jsx`,
  `useResumeBundle.js` → §2.4 read-only) and two joined it (`src/lib/resumeAdmin.js` → OWNER-STUDIOS,
  `src/admin/WorkbenchSkeleton.jsx` → OWNER-SHELL CREATE). No file appears twice.
- **Shell contract re-audited against its consumers.** `setColumn` removed from §3.2 *and* from
  §8.1; `invalidate` gained its `scope` argument in §3.2 *and* in §3.5, §5.1; `ownsTitle` removed
  from §3.1 *and* from §3.3's `PageShell` line *and* from §3.6's RatioedStudio row; `fullWidth`
  redefined in §3.1 *and* rewired in §3.3's grid *and* restated in §8.5.
- **BUILD ORDER re-audited as satisfiable.** Stage 5 shrank to one line and now depends on 0 rather
  than 2 (it touches no new code). Stage 3d grew by `src/lib/resumeAdmin.js`, which no other stage
  reads. Stage 2 grew by `WorkbenchSkeleton.jsx`, which only OWNER-SHELL consumes. Stage 8 is still
  reachable: 3d removes the last `setPageEditor` producer, and nothing added in revision 2
  reintroduces one.
