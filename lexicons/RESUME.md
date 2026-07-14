# Resume lexicons

A small, normalized, backlinked schema for a professional profile / resume on
the AT Protocol. It lets you keep **one canonical set of jobs** and assemble
**many resume versions** on top of them — each version choosing which jobs,
which individual bullet points, and which skills to show, and whether to show
them on the site at all.

```
is.dame.resume            (a resume version — "primary", "product-design", …)
 ├─ entries[]   ──at://──▶ is.dame.resume.job        (canonical job; owns the bullets)
 │   └─ highlightIds[]      ─▶ picks job.highlights[].id — or "h3#v2" to pick a
 │                             forked phrasing from that highlight's variants[]
 ├─ education[] ──at://──▶ is.dame.resume.education   (canonical degree/program)
 ├─ skills[]                  (inline skill groups — the audience-specific part)
 └─ contact                   (inline, or fall back to the site profile)
```

## The three records

### `is.dame.resume.job` — the canonical job
One record per role you've held. It owns the facts (organization, title, dates)
and the **highlights** (achievement bullets). Each highlight has a stable `id`
so resumes can reference it. Edit a bullet here once and every resume that
selected it updates. Record key is a readable slug, e.g.
`at://…/is.dame.resume.job/ipfs-content-manager`.

A highlight can also carry **variants** — forked phrasings of the same
achievement (`variants: [{ id, text, label }]`). The canonical `text` is what a
bare selection shows; a resume opts into a fork with a `"<highlightId>#<variantId>"`
ref (e.g. `"h3#v2"`) in its `highlightIds`. Variants live on the job record, so
a fork is still edited in one place and every resume that picked it stays in
sync; the `label` ("design-focused", "one-pager") is admin-only naming.
Variants share the parent bullet's flags (visibility, featured, metric, tags) —
they are the *same point*, differently worded. If two phrasings diverge into
genuinely different claims, make a second highlight instead.

### `is.dame.resume.education` — the canonical education entry
Same idea for schooling. Reuses the job's `#highlight` shape for honors /
coursework so the renderer and selection logic are shared.

### `is.dame.resume` — a resume version
Owns no employment facts. It's an ordered, curated **view**:

- `entries[]` — backlinks (`at-uri`) to jobs. Per entry, `highlightIds[]`
  selects exactly which bullets to show and in what order. Omit it to show all
  non-private bullets. `titleOverride` / `summaryOverride` allow light
  per-resume tailoring without forking the job.
- `education[]` — backlinks to education records.
- `skills[]` — inline skill groups (kept inline because skill emphasis is the
  most audience-specific part of a resume).
- `contact` — inline contact block, or omit to fall back to the site profile.
- `visibility` + `featured` — control what the website renders (see below).

## Why backlink jobs but embed bullets?

Two relationships, modeled differently on purpose:

- **resume → job** is a true backlink (`at-uri`). Jobs are shared across many
  resume versions, so they must be addressable, editable in one place, and
  reusable. A bare AT URI (not a `com.atproto.repo.strongRef`) is used so an
  entry always tracks the job's *latest* version rather than pinning a CID.
- **job → highlight** is embedded (an array with stable `id`s) rather than a
  separate `is.dame.resume.highlight` collection. A bullet is never shared
  between jobs, and a personal work history is ~40 bullets — promoting each to
  its own record means ~40 records to hand-manage with no reuse benefit.
  Embedding keeps a job atomic while the stable `id`s still give resumes
  precise, per-bullet selection. (If you later want a bullet to be the *target*
  of a like/annotation from elsewhere in the Atmosphere, splitting highlights
  into their own collection is the natural upgrade — the resume's
  `highlightIds` would become `at-uri`s. Nothing else changes.)

## Visibility is display intent, not privacy

**Every record on a PDS is publicly fetchable.** `visibility` and the
`private` highlight flag only tell *this website* what to render:

| value      | resume                                  | highlight                                  |
|------------|-----------------------------------------|--------------------------------------------|
| `public`   | listed + rendered                       | always rendered when selected              |
| `unlisted` | reachable at its URL, not indexed       | rendered only when a resume explicitly selects it |
| `private`  | not rendered on the site                | never rendered on the site                 |

`featured: true` marks the resume shown at `/resume` when no slug is given (keep
it to one). Site render rule for a job's bullets: take `entry.highlightIds` in
order (or all of the job's highlights if omitted), then drop any whose
visibility is `private`.

## Relation to JSON Resume

Field names deliberately echo [JSON Resume](https://jsonresume.org)
(`organization`/`title`, `institution`/`area`/`studyType`, `summary`,
`highlights`, `startDate`/`endDate`) so exporting a flattened
`work[]`/`education[]`/`skills[]` document for any JSON-Resume themer is a
straightforward resolve-the-backlinks-and-rename pass.

## Importing / editing

- Bulk import the converted PDF data with
  [`scripts/import-resume.mjs`](../scripts/import-resume.mjs), which reads
  [`scripts/resume-data.json`](../scripts/resume-data.json) and writes every
  record (resolving the job/education backlinks for you). It uses `putRecord`
  with the slugs as record keys, so re-running it updates in place instead of
  duplicating.
- Day-to-day editing happens in the **Resume studio** (`/admin?view=resume`):
  an overview of every version, job, and education record, with per-version
  **Duplicate** (fork a whole resume) and the **tailoring workbench**
  (`/admin?view=resume-tailor&r=<rkey>`) — a resume-centric editor where you
  reorder jobs, toggle/reorder/fork individual bullets, pick variants, and edit
  bullet copy inline. Copy edits stage onto the owning job records and save
  together with the resume in one pass.
- The templated per-record forms (`src/lib/lexicons.js` +
  `src/components/resumeFields.jsx`) remain the escape hatch for anything the
  studio doesn't cover, with raw JSON below that.
