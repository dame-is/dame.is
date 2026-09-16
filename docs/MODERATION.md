# Moderation gate

A circuit breaker on bulk moderation actions, plus a DM analyst.

It does not decide who is bad. It answers **what am I about to do, and who will
notice** — the one question the previous workflow had no way to ask.

## Why it exists

The old tool took a post URI, walked the engagement graph around it, and bulk-
added everyone to a modlist. That works, and it is blind: it knows the graph
around one post at one moment and nothing about how those accounts relate to
you.

In September 2026 a sweep added 8,473 accounts in a day. The worst collateral
case was an account followed by 24 of your 234, with tens of thousands of
followers, posting hundreds of times a day. Two more were followed by 8 and 10
of your circle respectively, both with five-figure audiences. None of them were
looked at, because a batch of 8,473 is not a list anyone reads.

275 accounts in that batch were followed by at least one person you follow. The
gate exists so that list gets named before the action, not discovered after.

## What the score means, and what it does not

**It measures social proximity.** Proximity is a proxy for blast radius. It says
nothing about whether anyone deserves anything. Someone close to you can be
awful; a stranger can be harmless.

This is a measured conclusion, not a preference. Scoring a sample of the
existing block list against the 234 accounts you follow showed the features that
separate them best are `default .bsky.social handle` (98% vs 36%), `non-bsky
lexicons ≥5` (0% vs 55%), and `verified` (0% vs 32%). Those look like a great
classifier and are not one: they are measuring _"is this person an atproto
builder in dame's circle"_. Against the population the tool actually runs on —
strangers who engaged with one post — they fire on nearly everyone.

Two results that ran against intuition:

- **Inbound blocks are inverted.** Your follows have a median of 236 inbound
  blocks; the accounts on your block list have 55. Blocks accumulate with
  visibility, not with badness. The blocks-per-follower _ratio_ does separate
  (0.145 vs 0.042) but the spreads overlap heavily.
- **PDS host is almost empty as a signal.** 45 of 45 sampled blocked accounts
  and 39 of 44 follows are on `host.bsky.network`. You are on `pds.atpota.to`,
  so a rule treating non-default hosts as suspicious would flag you.

**One signal held up.** How many of the accounts you follow also follow this
person. 97% of the sweep scored zero; 44% of the accounts you blocked by hand
scored one or more. Read it in one direction only: a vouch is good evidence to
**leave someone alone**, and the absence of one is evidence of nothing, because
most harmless strangers have none either.

So the gate is excellent at preventing collateral damage and useless as a threat
detector. Those are different jobs and it only does one.

## Bands

Computed in `src/lib/moderation/score.js`. Vetoes win over everything.

| Band         | Rule                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `PROTECTED`  | You follow them, you are mutuals, or they are on a curation list. No automated path may ever act on these. |
| `CONNECTED`  | ≥3 of your follows follow them, or ≥1 does and they have ≥5k followers.                                    |
| `PERIPHERAL` | 1–2 of your follows follow them.                                                                           |
| `NOTABLE`    | No connection, but ≥10k followers or very high activity with real reach.                                   |
| `UNKNOWN`    | No connection, nothing notable. Most of any stranger sweep.                                                |

Against the September sweep these produce 1.0% / 2.2% / 1.5% / 95.3%. Against
the accounts you picked by hand, 54% need a look. Nearly frictionless on
strangers, hard to get past for people near you — that asymmetry is the design.

The `trust` number (0–99, `PROTECTED` is 100) is for **sorting a review list**,
not for gating. A single score would imply precision this data does not support.

## Pieces

| File                                  | Does                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| `src/lib/moderation/target.js`        | Post link (any client) or `at://` URI → resolved target |
| `src/lib/moderation/harvest.js`       | Everyone who touched a post, by engagement kind         |
| `src/lib/moderation/score.js`         | Trust, distance, bands, summary                         |
| `src/lib/moderation/precompute.js`    | Circle + vouch set construction                         |
| `src/lib/moderation/agent.js`         | The DM analyst: prompt, read-only tools, chunking       |
| `src/lib/moderation/client.js`        | Browser calls, service-auth minting, list removal       |
| `api/_lib/modDb.js`                   | PostgREST client for the `mod` schema (server only)     |
| `api/_lib/serviceAuth.js`             | Verifies browser tokens against your DID document       |
| `api/_lib/botAgent.js`                | Moderator session, resumed rather than re-established   |
| `api/mod-precompute.js`               | Builds the vouch set (hourly cron, resumable)           |
| `api/mod-preflight.js`                | Scores a post's engagement graph                        |
| `api/mod-audit.js`                    | Scores an existing list; records keep/remove            |
| `api/mod-migrate.js`                  | Carries the list to the moderator account (10-min cron) |
| `api/mod-agent.js`                    | DM loop (10-min cron)                                   |
| `src/components/ModerationStudio.jsx` | `/admin?view=moderation`                                |

### Why Constellation, not the AppView

`harvest.js` reads Constellation rather than `getLikes`/`getRepostedBy`. The
AppView answers **as a viewer**: it filters by the blocks and mutes already in
place, so using it to decide who to block hides the people you already acted on
and changes its answer as you work through a list. Constellation indexes the
firehose and answers the same for everyone.

Sources are also **discovered**, not declared — a counts call returns every
`(collection, path)` pointing at the record, so engagement from lexicons outside
`app.bsky` is found the same way a like is.

### Why removals happen in the browser

The server scores; the browser removes. Deletes go through your own OAuth
session against your own repo, so the credential that changes who is blocked is
the one that owns the list. No service-role key can alter the graph.

## Setup

### 1. Moderator account

Create or pick an account. Settings → Privacy and Security → App Passwords → add
one, **with "Allow access to your direct messages" turned on**. A plain app
password is excluded from `chat.bsky.*` and the DM loop will silently find
nothing.

From the moderator account, **follow `dame.is`** — chat defaults restrict
incoming DMs to accounts you follow.

### 2. Expose the schema

Supabase → atpota.to → Settings → API → Data API → **Exposed schemas** → add
`mod`. PostgREST only serves listed schemas; without this every call returns
`The schema must be one of the following`. RLS still governs access afterwards:
every `mod` table has RLS on with zero policies and anon revoked.

Copy the `service_role` key while you are there.

### 3. Environment

```
SUPABASE_URL=https://zdzjtziydmwkxbzlkwxv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
MOD_IDENTIFIER=<moderator handle>
MOD_APP_PASSWORD=...
AI_GATEWAY_API_KEY=...
MOD_AGENT_MODEL=anthropic/claude-opus-5   # optional
```

`CRON_SECRET` must be set. All moderation endpoints **fail closed** — an unset
secret breaks the crons rather than opening the endpoints.

### 4. Build the reference data

```bash
curl -sS -X POST https://dame.is/api/mod-precompute \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Repeat until `{"state":"finalised"}`. Two or three calls; the hourly cron would
get there alone but watch the first one. Verify:

```sql
select taken_at, count(*) from mod.vouch group by taken_at;
select count(*) from mod.protected;
```

Expect ~73k vouch rows and a protected set of your follows plus curation-list
members.

## Operating it

### Preflight

`/admin?view=moderation` → **Preflight**. Paste a link, read the bands. Runs dry
from the portal, so browsing does not litter the decision log.

### Audit and remediation

**Audit** tab. Point it at a list and hit _Score list_; it loops until complete.
The queue is everyone who no longer scores `UNKNOWN`, sorted by trust so the
most embedded accounts are read first — if attention runs out halfway down, it
ran out in the right place.

Mark keep or remove, hit Apply. Decisions are recorded server-side; the removals
execute in your browser via `applyWrites`.

### Migration

**Migrate** tab. Tick the bands to carry, hit _Start migration_. Only ticked
bands are copied, which is why **migration and remediation are the same
operation** — an account scoring `CONNECTED` today is fixed by never being
copied, not by a second cleanup nobody gets to.

~8,000 creates at 3 points each against 5,000 points/hour is about six hours at
250 per ten-minute firing. The cron no-ops on one select once finished.

Afterwards: subscribe to the new list, drop the old one. Your repo then holds
one `listblock` record instead of 8,697 `listitem`s, which is what makes _"I
subscribe to an automated list I don't curate by hand"_ accurate rather than a
story you tell.

### The analyst

DM the moderator account a post link. Reply within ten minutes, or force it:

```bash
curl -sS -X POST https://dame.is/api/mod-agent \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

`{"answered":0,"scanned":N}` means the message was seen but not from your DID,
or the DM-access toggle is off.

**The analyst decides nothing.** Bands are computed before it sees them and no
model output can move an account between them. That is what keeps the decision
log replayable — an LLM verdict in it would be unreproducible by the time anyone
asked.

Its tools are all reads, and attacker-controlled strings (handles, display
names, bios) are fenced in `<untrusted>` tags with backticks stripped. Nothing
out there is aimed at this system today — it is private and unknown. The guards
are cheap insurance against two duller things: injection strings already exist
in the wild aimed at scrapers and other people's bots, and one will land here by
accident eventually; and privacy is a state that ends, with no warning and no
time to retrofit.

## Known limits

- **Distance 3 means "not found", not three hops.** Establishing real distance
  beyond the one-hop neighbourhood would mean walking ~73k follow graphs.
- **Follow lists are read to 1,500 accounts** per circle member. Someone who
  follows more contributes a truncated set, understating vouches for accounts
  deep in their list. That is the right way to be wrong: understating sends
  someone to review, overstating waves them through.
- **Harvests cap at 60 pages per source.** Replies and quotes on a viral post
  are complete; the like tail is cut. The result reports `truncated`.
- **Bluesky post search is not used.** It rate-limits aggressively and refused
  outright during development. Mention monitoring, if built, should use Jetstream.
- **No auto-mute.** Deliberately deferred. Everything here is decision support;
  nothing acts without you.
