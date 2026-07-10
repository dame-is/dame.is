# arena-pds-mirror

Mirror an [are.na](https://www.are.na) account — channels, blocks, connections,
media — into [atproto](https://atproto.com) records on the account owner's PDS.

The immediate point is data ownership: a complete, incrementally-synced copy of
your are.na graph living in your own repo, portable via CAR export, queryable
over public XRPC, and still there if are.na isn't. The longer arc is a bridge:
the record shapes are designed so that an "atmosphere are.na" — an AppView
indexing these collections across many repos, with cross-repo connections —
can grow out of the same data. See [Roadmap](#roadmap).

This folder is self-contained on purpose. Its only runtime dependency is
`@atproto/api`, it imports nothing from the host project, and it can be lifted
into a standalone repo unchanged. Host projects wire it up with thin wrappers
(a CLI, a cron endpoint) that pass options in.

## How are.na maps to atproto

are.na's data model is nearly an atproto repo already: blocks are records,
channels are list-like records, and a *connection* (this block appears in that
channel, at this position, connected at this time) is a small join record —
exactly how likes and list items work in Bluesky.

Four collections, derived from a configurable `nsidBase`
(default `is.dame.arena.mirror` — see [Namespace](#namespace)):

| Collection | rkey | Contents |
|---|---|---|
| `<base>.channel` | are.na channel id | title, description, slug, visibility, owner, counts |
| `<base>.block` | are.na block id | kind (image/text/link/attachment/embed), text/source/image/attachment/embed payloads, creator |
| `<base>.connection` | are.na connection id | channel at-uri, target (at-uri and/or are.na id+url), position, connectedAt |
| `<base>.sync` | `self` | per-channel freshness markers + settings fingerprint |

Using are.na ids as rkeys makes every sync idempotent and doubles as the
two-way id map that write-back will need. A block connected into five channels
gets one block record and five connection records. Every mirrored record
carries `origin: { arenaId, url, syncedAt }` — provenance, and the echo
suppressor for future bidirectional sync. Full field docs live in
[`lexicons/`](./lexicons).

## Modes

**Media — `mediaMode`**
- `references` (default): records store are.na's file URLs plus metadata
  (dimensions, content type, size, blurhash). Cheap, no PDS storage cost, but
  the files themselves still live on are.na's CDN.
- `blobs`: image originals and attachment files are additionally uploaded to
  the PDS as blobs, up to `maxBlobBytes` (default 5 MB, the reference PDS's
  upload limit). Oversized or failed downloads fall back to reference-only —
  the record shape is identical either way, `blob` is just absent. Preview
  imagery on link/embed/attachment blocks (screenshots, oEmbed thumbnails) is
  always reference-only; blobs are spent on primary artifacts.
- Switching modes never destroys blobs: a `references` run carries existing
  blobs forward and simply stops acquiring new ones. A blob is only dropped
  when the upstream file itself changed.

**Scope — `blockScope`**
- `connected` (default): every block in your channels is mirrored, including
  blocks other people created that you connected — the full backup, matching
  what are.na's own export would give you.
- `created`: only blocks you authored get block records. Your *connections* to
  other people's blocks are still mirrored (the graph edge is yours), but the
  target stays an are.na reference (`target.arenaId` + `target.url`, no local
  `target.uri`) — your curation is preserved without copying anyone else's
  content into your repo.

**Privacy — `includePrivate`**
- Off by default, and this one matters: **PDS records are public.** Private
  are.na channels are skipped unless you explicitly opt in, and the run log
  tells you how many were skipped. (are.na "closed" channels are publicly
  visible, so they're mirrored.) If you stop mirroring private channels after
  having opted in, the next complete run deletes their records from the PDS.

Changing any of these (or the namespace) changes the settings fingerprint on
the sync record, which forces a full re-walk so the mirror converges on the
new settings instead of serving a mix.

## Sync behavior

- **Incremental.** Each run enumerates your channels (a couple of requests)
  and compares `updated_at` + contents count against the sync record. Nothing
  changed → no-op. Otherwise only changed channels are walked, and only
  records that actually differ are written.
- **Resumable.** Give the engine a `timeBudgetMs` and it stops cleanly between
  channels when time runs out, persists progress, and resumes next run —
  which is how a first backfill of a large account survives serverless
  execution limits. (Better: run the first backfill from a laptop with the
  CLI, no budget.)
- **Deletion-safe.** Records deleted on are.na are deleted from the PDS, but
  only on complete runs (never on partial/subset runs, where the mirror can't
  see the whole picture), never for records without `origin.arenaId` (those
  belong to future write-back, not to the mirror), and never when are.na
  suddenly reports zero channels for the account.
- **Polite.** are.na has no webhooks, so this is polling: requests are spaced
  out, 429s honour `Retry-After`, transient errors retry with backoff. An
  [are.na personal access token](https://www.are.na/developers) raises the
  rate ceiling and lets the mirror see your private channels.

Known staleness window: editing a block (say, its title) without touching any
channel may not bump the containing channel's `updated_at`, so the edit rides
along with the next change to any channel containing it — or a `--full` run.

## Usage

```js
import { AtpAgent } from '@atproto/api';
import { syncArenaMirror } from 'arena-pds-mirror';

const agent = new AtpAgent({ service: 'https://your-pds.example' });
await agent.login({ identifier: 'you.example', password: appPassword });

const report = await syncArenaMirror({
  agent,
  did: 'did:plc:…',
  user: 'your-arena-slug',
  token: process.env.ARENA_ACCESS_TOKEN, // recommended
  blockScope: 'connected',               // or 'created'
  mediaMode: 'references',               // or 'blobs'
  // includePrivate: true,
  // maxBlobBytes: 5 * 1024 * 1024,
  // nsidBase: 'is.dame.arena.mirror',
  // channels: ['some-slug'],            // subset, for testing
  // timeBudgetMs: 50_000,
  // full: true,
  // dryRun: true,
  log: console.log,
});
```

`dryRun` plans a run and reports what it would write/delete/upload without
writing anything — it works with an unauthenticated agent, since it only needs
public reads.

In this repo the wrappers are:

- `scripts/mirror-arena.mjs` — CLI (`--dry-run`, `--full`, `--scope`,
  `--media`, `--include-private`, `--max-blob-mb`, `--channels`, `--budget-s`,
  `--pds`). First backfills and blob captures should run here.
- `api/mirror-arena.js` — daily Vercel cron, configured through
  `ARENA_MIRROR_*` env vars, with a time budget under the function limit.
  **Keep the cron's scope/media env vars in agreement with how you run the
  CLI** — a settings mismatch just causes rewrites (blobs are never stripped),
  but the fingerprint churn wastes runs.

## Namespace

Collections default to `is.dame.arena.mirror.*`. That's a personal namespace;
it works anywhere (NSIDs are just names), but if this graduates into a shared
tool or an AppView standardizes on lexicons, everyone should write the *same*
collections under a project-owned domain. `nsidBase` exists so that migration
is a config change plus one `--full` resync (write under the new base, delete
the old collections). Until then, deployments that just want a private backup
can use any base they like.

## Roadmap

The mirror is phase 1 of the bridge sketched below; the record design already
carries what the later phases need.

1. **Pull mirror (this).** are.na → PDS, incremental, one-way.
2. **Read path.** Render your site's galleries from the PDS records instead of
   the are.na API — are.na becomes *a* client of your data, not its home.
3. **Write-back.** A record created in the mirror collections *without*
   `origin.arenaId` is atmosphere-born: push it to are.na (v3 supports
   authenticated block/connection writes + OAuth), then stamp the returned id
   into `origin`. That stamp is also the echo suppressor — the next pull
   recognizes the record instead of re-importing it. Conflict policy stays
   simple while sync is single-user: last-writer-wins by `updatedAt`, with the
   side that authored a thing authoritative for it. `ArenaClient` is the
   intended home for the write methods.
4. **The atmosphere are.na.** An AppView consuming the firehose for these
   collections across all repos: channels, blocks, and — the native trick
   are.na's model was always secretly shaped like — connections in *my* repo
   pointing at blocks in *yours* (`connection.target.uri` is already an
   at-uri). Identity mapping (are.na user ↔ DID) can bootstrap from the
   `owner`/`creator` slugs mirrored here plus profile-link attestations.
   Multi-user bridging raises the Bridgy-Fed-style consent questions
   (bridging people who didn't opt in), which is exactly why `blockScope:
   'created'` exists.

## Caveats

- atproto records can't hold floats, so are.na's `aspect_ratio` is dropped —
  derive it from `width`/`height`.
- Blobs count against your PDS storage. A large account in `blobs` mode is
  real gigabytes; `maxBlobBytes` and `blockScope: 'created'` are the dials.
- Mirroring content others created (default `connected` scope) is fine as a
  personal backup — it's your channels' contents, same as are.na's export —
  but think before building public surfaces on other people's blocks.
- are.na's v3 API is young; if response shapes shift, `src/records.js` is the
  only file that reads them.
- v3's channel `/contents` currently yields blocks only — nested channels are
  counted in `counts.contents` but not returned, so channel-in-channel
  connections aren't mirrored yet. The engine already handles `Channel` items
  (local `target.uri` when the nested channel is itself mirrored) the moment
  the API starts serving them.
