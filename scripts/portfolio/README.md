# Portfolio export → PDS

Tools for migrating the creative works from the old Adobe Portfolio site
(<https://dame.work/art>) into `is.dame.creating.work` records on your PDS —
the same collection the `/creating` page and the in-app block editor read.

Two steps:

1. **`extract.mjs`** scrapes the old site into `works.json` — a clean,
   human-editable file you review and tweak.
2. **`upload.mjs`** reads `works.json` and publishes each work to your PDS,
   re-hosting every image as a PDS blob so nothing stays tied to Adobe.

`works.json` is already generated and committed, so you can skip straight to
step 2 (or open the file and edit first).

## What was captured

7 works, newest → oldest, 98 images total:

| Slug | Title | Year | Category | Images | Notes |
|---|---|---|---|---|---|
| `photographs-era-2-part-ii` | Photographs: Era 2 (Part II) | 2023 | photography | 19 | |
| `photography` | Photographs: Era 2 (Part I) | 2022 | photography | 14 | |
| `proof-of-no-work` | Proof of (No) Work | 2022 | art | 15 | 6-paragraph writeup, YouTube + Etherscan links |
| `red-blue-yellow` | Red, Blue, Yellow | 2019 | art | 18 | per-painting titles + dimensions in alt text |
| `leather-notebooks` | Leather Notebooks | 2014 | craft | 15 | intro paragraph |
| `photographs-era-1-part-i` | Photographs: Era 1 (Part II) | 2011 | photography | 17 | intro paragraph |
| `brickfilms` | Brickfilms | 2011 | video | 0 | reel embed (see note) |

## `works.json` format

An array of works. Each has top-matter plus an ordered `blocks` array:

```jsonc
{
  "slug": "red-blue-yellow",
  "title": "Red, Blue, Yellow",
  "category": "art",                 // single value, site vocabulary
  "tags": ["painting", "water-based paint"],
  "year": 2019,
  "createdAt": "2019-01-01T00:00:00.000Z",
  "summary": "",                     // shown on the /creating card — fill these in
  "source": "https://dame.work/red-blue-yellow",
  "blocks": [
    { "type": "heading", "level": 2, "text": "Behind-the-Scenes" },
    { "type": "text", "text": "In 2022, I mounted a clock…",
      "links": [{ "text": "Etherscan", "uri": "https://etherscan.io/…" }] },
    { "type": "image", "url": "https://cdn.myportfolio.com/…_rw_1920.jpg",
      "alt": "\"Parallel Selves\" 24 x 18 in", "aspectRatio": { "width": 3840, "height": 2880 } },
    { "type": "embed", "provider": "youtube", "title": "Watch on YouTube",
      "url": "https://www.youtube.com/watch?v=…", "embedSrc": "…" }
  ]
}
```

**Worth editing before upload:**

- **Summaries** — the two photo series and `red-blue-yellow` have empty
  `summary`. Add a sentence so their `/creating` cards aren't blank.
- **Alt text** — painting captions are in `alt`; the photo series have empty
  `alt`. Fill in any you want described.
- **`brickfilms` embed** — its `url` is an Adobe/Behance player embed, not a
  public link. Replace it with a real YouTube/Vimeo URL if you have one.
- **`createdAt`** — defaults to Jan 1 of each work's year. Refine if you like.

Each `block.type` maps to a `pub.leaflet` block on upload: `heading` →
`header`, `text` → `text` (with link facets), `image` → `image`, `embed` →
`website` (link card). These are exactly the blocks the site renderer and
editor support.

## 1. Re-extract (optional)

```sh
node scripts/portfolio/extract.mjs
```

Re-fetches the live pages and rewrites `works.json`. Image width is capped at
2560px by default (retina-sharp, ~1–3 MB). For full-resolution archival:

```sh
MAX_IMG_WIDTH=3840 node scripts/portfolio/extract.mjs
```

## 2. Upload to your PDS

Create an **app password** (bsky.social → Settings → Privacy & security → App
passwords, or your PDS equivalent — never your main password), then:

```sh
# Preview without writing anything:
node scripts/portfolio/upload.mjs --dry-run
node scripts/portfolio/upload.mjs --dry-run --print --only=red-blue-yellow

# Publish for real:
DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx node scripts/portfolio/upload.mjs
```

For each work it builds the `pub.leaflet.content` body, downloads every image
from the old CDN, re-uploads it to your PDS as a blob, and creates one
`is.dame.creating.work` record (server-assigned TID rkey; the public URL is
keyed off `slug`).

### Options

| Flag | Effect |
|---|---|
| `--dry-run` | Build and report, write nothing. |
| `--print` | With `--dry-run`, print the full record JSON. |
| `--only=slug[,slug]` | Publish a subset. |
| `--keep-cdn-urls` | Reference Adobe CDN URLs instead of uploading blobs (fast, but breaks when the old site goes down — not recommended). |
| `--force` | Publish even if a record with that slug already exists. |
| `--handle=dame.is` | Account handle (default `dame.is`). |
| `--pds=https://…` | Use this PDS directly instead of resolving it. |

### Notes

- **Re-runnable.** By default it skips works whose `slug` is already
  published, so you can stop and resume. `--force` overrides.
- **Auth** reads `DAME_APP_PASSWORD` (or `APP_PASSWORD`). The handle resolves
  to your DID and PDS automatically (`dame.is` → `pds.atpota.to`).
- **Build snapshot.** New records appear on the site after the next build /
  the 6-hour rebuild cron refreshes the `public/data` snapshot.
- **No dependencies beyond the repo's** — uses the already-installed
  `@atproto/api`.
