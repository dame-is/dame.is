# Portfolio export → PDS

Tools for migrating the creative works from the old Adobe Portfolio site
(<https://dame.work>) into **`site.standard.document`** records on your
PDS — the portable standard.site type the `/creating` page and the in-app
block editor now use. Alongside the art/photography gallery, this covers the
old site's case-study and writing-sample pages (design, marketing, and writing
works). Each work belongs to a dedicated **portfolio publication**; that's what
makes it render on `/creating` (not `/blogging`).

Steps:

0. **`create-publication.mjs`** creates the portfolio `site.standard.publication`
   once, and prints an `at://` URI to paste into `PORTFOLIO_PUBLICATION` in
   `src/config.js`.
1. **`extract.mjs`** scrapes the old site into `works.json` — a clean,
   human-editable file you review and tweak.
2. **`upload.mjs`** reads `works.json` and publishes each work as a standard
   document, re-hosting every image as a PDS blob so nothing stays tied to Adobe.

Already have `is.dame.creating.work` records from before? **`migrate-creating.mjs`**
converts them to standard documents (reusing their existing image blobs).

`works.json` is already generated and committed, so you can skip straight to
step 2 (or open the file and edit first).

## 0. Create the portfolio publication (once)

```sh
DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx \
  node scripts/portfolio/create-publication.mjs --name "Creative Works"
```

Paste the printed `at://…` URI into `src/config.js`:

```js
export const PORTFOLIO_PUBLICATION = 'at://did:plc:…/site.standard.publication/…';
```

Until this is set the site keeps its prior behavior (legacy `is.dame.creating.work`
on `/creating`, every standard doc treated as a blog post), so it's safe to
deploy the code change before creating the publication.

## What was captured

13 works, newest → oldest, 154 images total:

| Slug | Title | Year | Category | Images | Notes |
|---|---|---|---|---|---|
| `the-encyclopedia-of-nfts` | The Encyclopedia of NFTs | 2023 | writing | 22 | long-form guide, 28 external links |
| `the-definitive-guide-to-security-for-nft-creators` | The Definitive Guide to Security for NFT Creators | 2023 | writing | 1 | long-form guide, 14 external links |
| `photographs-era-2-part-ii` | Photographs: Era 2 (Part II) | 2023 | photography | 19 | |
| `rainbow` | Rainbow | 2022 | marketing | 4 | case study, New York Magazine link |
| `photography` | Photographs: Era 2 (Part I) | 2022 | photography | 14 | |
| `proof-of-no-work` | Proof of (No) Work | 2022 | art | 15 | 6-paragraph writeup, YouTube + Etherscan links |
| `gpt-3-dao-essay` | Wannabe DAOs | 2021 | writing | 1 | essay co-written with GPT-3 |
| `assisted-billing` | Assisted Billing | 2019 | design | 19 | case study, 7 external links |
| `red-blue-yellow` | Red, Blue, Yellow | 2019 | art | 18 | per-painting titles + dimensions in alt text |
| `fusion-branding` | Fusion Web Clinic | 2018 | design | 9 | case study; Adobe reel embed (see note) |
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
- **`brickfilms` / `fusion-branding` embeds** — each ends with an
  Adobe/Behance player embed, not a public link. Replace the block's `url`
  with a real YouTube/Vimeo URL if you have one, or drop the block.
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

To re-extract only some works and leave the rest of `works.json` untouched
(so hand-curated summaries / alt text on the others survive), pass `--only`:

```sh
node scripts/portfolio/extract.mjs --only=rainbow,assisted-billing
```

A curated one-line `summary` set in `WORKS_META` is used as-is (and survives
re-extraction); works without one fall back to their first paragraph.

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
`site.standard.document` record in the portfolio publication (server-assigned
TID rkey; the public URL is `/creating/<slug>`, stored as the doc's `path`).
The work's `category` becomes the first entry of the native `tags` array.

### Options

| Flag | Effect |
|---|---|
| `--dry-run` | Build and report, write nothing (works without a publication set). |
| `--print` | With `--dry-run`, print the full record JSON. |
| `--only=slug[,slug]` | Publish a subset. |
| `--keep-cdn-urls` | Reference Adobe CDN URLs instead of uploading blobs (fast, but breaks when the old site goes down — not recommended). |
| `--force` | Publish even if a record with that slug already exists. |
| `--legacy` | Publish as `is.dame.creating.work` instead of a standard doc (not recommended). |
| `--publication=at://…` | Portfolio publication URI (otherwise read from config / `DAME_PORTFOLIO_PUBLICATION`). |
| `--handle=dame.is` | Account handle (default `dame.is`). |
| `--pds=https://…` | Use this PDS directly instead of resolving it. |

## 3. Migrate existing legacy records (optional)

If you already published any `is.dame.creating.work` records, convert them to
standard documents (their image blobs are reused — nothing is re-uploaded):

```sh
node scripts/portfolio/migrate-creating.mjs --dry-run --print
DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx node scripts/portfolio/migrate-creating.mjs
# add --delete to remove each legacy record after its standard doc is created
```

By default it keeps both records (`/creating` reads either); `--delete` removes
the legacy one once migrated. Re-runnable — skips works already migrated.

## 4. Markdown-sourced guides (`import-guide.mjs`)

Some works aren't Adobe pages — the long-form guide at
<https://atpota.to/guides/bluesky-for-brands> is markdown (with nested lists,
inline formatting, and link facets) that the flat `works.json` block format
can't represent. `import-guide.mjs` handles those: it fetches the markdown from
the atpota.to repo, runs the site's own markdown→`pub.leaflet.content`
converter (`src/lib/legacyBlogMarkdown.js` — the one the legacy-blog admin
migration uses), re-hosts every referenced image as a PDS blob, and writes one
`site.standard.document` to the portfolio publication.

```sh
node scripts/portfolio/import-guide.mjs --dry-run --print     # build + report, no auth
DAME_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx node scripts/portfolio/import-guide.mjs
```

This guide was once migrated **by accident** as a *blog* post — a
`site.standard.document` (rkey `how-to-use-bluesky-to-grow-your-brand`) on the
blog publication with a truncated title. By default the script **replaces that
record in place** (`putRecord`, same rkey): it moves to the portfolio
publication and its title / description / tags / content are corrected, so there
is one clean record and no leftover broken blog post.

| Flag | Effect |
|---|---|
| `--dry-run` / `--print` | Build + report (and print the record); writes nothing, no auth. |
| `--new` | Create a fresh record (server TID) instead of replacing by rkey. |
| `--blog` | Home it on the blog publication instead of the portfolio. |
| `--publication=at://…` | Explicit publication URI. |
| `--rkey=…` | Record key to write (default `how-to-use-bluesky-to-grow-your-brand`). |
| `--markdown=URL` | Override the source markdown URL. |
| `--no-cover` | Don't attach a cover image. |
| `--handle=` / `--pds=` | Override the account handle / PDS. |

### Notes

- **Re-runnable.** By default it skips works whose `slug` is already
  published, so you can stop and resume. `--force` overrides.
- **Auth** reads `DAME_APP_PASSWORD` (or `APP_PASSWORD`). The handle resolves
  to your DID and PDS automatically (`dame.is` → `pds.atpota.to`).
- **Build snapshot.** New records appear on the site after the next build /
  the 6-hour rebuild cron refreshes the `public/data` snapshot.
- **No dependencies beyond the repo's** — uses the already-installed
  `@atproto/api`.
