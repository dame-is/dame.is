# Owner decisions on the spec's open questions

These override the spec wherever they disagree. Read this file **after** the spec.

## 1. Counting budget — automatic on mount, as specced

Keep automatic-on-mount with the 60s in-memory cache. This is a single-user admin used a
handful of times a day; ~12 parallel `listRecords` calls behind a 6-way concurrency limit is a
polite budget. **No "Refresh counts" button gate.** Do add a manual refresh control that busts
the cache, so a stale number can be re-fetched without a reload.

## 2. Guestbook "Needs you" — drop the derived item

Do **not** show a derived "awaiting review" item. `flagged` is recomputed per render and never
persisted (`guestbook.js:213`), so an item built on it is not a real queue and would nag
forever. The guestbook tile shows the **exact hidden count only**. If `flagged && !hidden`
entries exist on the first page, they may appear as a single neutral line reading
"N auto-hidden by the language filter" with no action attached — a fact, not a task.

## 3. Mobile breakpoint — 60rem (960px), as specced

Tablets get the drill-down stack. A blocks editor in under 20rem is not worth defending.

## 4. Public-site CSS — do NOT change the public quick-edit sheet

The user's constraint is explicit: the public site stays the same. So:

- `.category-field-chip.is-active` (`Admin.css:672`, undefined `var(--paper)`) — **fix it scoped
  to the admin shell only.** Define the correct colour under `.wb` (or on the admin-scoped
  selector), leaving the rule that the portalled public quick-edit sheet resolves **byte-identical
  to today**. Do not touch the global rule.
- `.pub-list-row` / `.pub-icon-empty` (`PublicationsManager.css:21,:115`) — admin-only component,
  **fix it outright**.

Any other undefined-variable fix follows the same test: if the selector can render outside
`.wb`, scope the fix; if it cannot, fix it globally.

## 5. Sky + Ratioed full-width — as specced

Both keep the `fullWidth` flag (rail, no list column).

## 6. Record selection pushes history — as specced

Push, matching today's `<Link>` behaviour and every list/detail app the owner already uses.
The shell's "back to list" affordance covers the escape case.

## 7. NEW — fix the editor's blocking load (found by direct measurement)

`RecordEditor`'s load path awaits `resolvePds(did)` (`RecordEditor.jsx:160`) before it will
render **any** field. `resolvePds` → `getPlcDocument` → `fetchJson` (`src/lib/atproto.js:35`,
`:58`) has **no timeout**, so a slow `plc.directory` holds the entire form on its skeleton with
no error shown. Measured in the harness: **28.6 seconds** to first field render.

The PDS lookup is display-only — it exists solely to bake preview URLs onto blob refs, and the
code already says so ("best-effort; the record still loads and saves fine", `:163`).

Required fix (OWNER-EDITOR):

- The form must render as soon as `getRecord` resolves. Move the `resolvePds` +
  `annotateRecordBlobs` step **off** the blocking path: set the value first, then resolve the
  PDS and re-annotate when it arrives (guarded by the existing `cancelled` flag).
- Bound the lookup regardless — an `AbortSignal.timeout(...)` of a few seconds, or a
  `Promise.race`. A hung fetch must degrade to "images show no preview", never to "the editor
  never appears".
- This is a real production latency bug, not a harness artefact. Verify the fix in the harness:
  the first field must paint in well under a second.
