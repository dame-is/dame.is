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
| `src/lib/moderation/agent.js`         | The analyst: prompts, read-only tools, chunking         |
| `src/lib/moderation/trigger.js`       | Does this firehose event mean "look at this"?           |
| `src/lib/moderation/client.js`        | Browser calls, service-auth minting, list removal       |
| `api/_lib/modDb.js`                   | PostgREST client for the `mod` schema (server only)     |
| `api/_lib/reference.js`               | The scoring snapshot, loaded once and shared            |
| `api/_lib/dmLoop.js`                  | One DM intake pass, shared by droplet and fallback      |
| `api/_lib/serviceAuth.js`             | Verifies browser tokens against your DID document       |
| `api/_lib/botAgent.js`                | Moderator session, resumed rather than re-established   |
| `api/mod-precompute.js`               | Builds the vouch set (hourly cron, resumable)           |
| `api/mod-preflight.js`                | Scores a post's engagement graph                        |
| `api/mod-audit.js`                    | Scores an existing list; records keep/remove            |
| `api/mod-migrate.js`                  | Carries the list to the moderator account (10-min cron) |
| `api/mod-agent.js`                    | DM loop, on demand — the fallback, no longer scheduled  |
| `services/mod-consumer/`              | The droplet: Jetstream mentions + a 2s DM poll          |
| `api/mod-remove.js`                   | Removes from a list the moderator account owns          |
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

### Which credential removes someone

Removals route on who owns the list, because the answer changes when the
migration succeeds.

- **A list in your own repo** can only be written by your own session, so those
  deletes run in the browser. The server does not hold your personal
  credentials and should not.
- **A list on the moderator account** cannot be written from the browser at all,
  so those go to `api/mod-remove.js`, which uses `MOD_APP_PASSWORD`.

The boundary is narrower than "the server must not write to the graph", which
was never true anyway: `mod-migrate.js` adds thousands of accounts to a list
with that same credential. Withholding the safer capability while granting the
more dangerous one bought nothing, and removal is the direction that undoes
harm. What holds is that **the server never holds your personal account's
credentials** — the moderator account is a bot and automating it is the point of
it existing.

A removal request naming a list you own is refused by the server with
`useBrowser: true` rather than quietly failing.

## Setup

### 1. Moderator account

Create or pick an account. Settings → Privacy and Security → App Passwords → add
one, **with "Allow access to your direct messages" turned on**. A plain app
password is excluded from `chat.bsky.*` and the DM loop will silently find
nothing.

From the moderator account, **follow `dame.is`** — chat defaults restrict
incoming DMs to accounts you follow.

`MOD_IDENTIFIER` accepts a handle or a DID. Use the **DID**: a handle is rented,
so renaming the account would break authentication from inside a cron nobody is
watching, and a DID can be verified against the session that comes back —
`botAgent` refuses one that does not match, which catches an identifier and an
app password belonging to two different accounts before anything is written to
the wrong repo.

### 2. Expose the schema

Supabase → atpota.to → Settings → API → Data API → **Exposed schemas** → add
`mod`. PostgREST only serves listed schemas; without this every call returns
`The schema must be one of the following`. RLS still governs access afterwards:
every `mod` table has RLS on with zero policies and anon revoked.

Copy the `service_role` key while you are there.

**Verify the toggle actually took.** It has silently not taken at least once:
the dialog reported `7 of 9 schemas exposed` while the value PostgREST reads
still listed six, and every call came back `PGRST106 — Invalid schema: mod`.

```sql
select unnest(s.setconfig) from pg_db_role_setting s
join pg_roles r on r.oid = s.setrole where r.rolname = 'authenticator';
```

`mod` must appear in `pgrst.db_schemas`. If it does not, set it from SQL — the
fix is at the top of [`docs/sql/mod-grants.sql`](sql/mod-grants.sql).

**Max rows caps every read, silently.** Supabase → Settings → API → Max rows is
1,000 on this project, and PostgREST applies it to any select without a limit —
status 200, no warning, 1,000 of 73,215 vouch rows. Scoring against that page
puts 72,215 accounts at zero vouches, which reads as UNKNOWN, which is the band
that gets waved through: about 12,700 of them score CONNECTED when the table is
read in full. The tool reports "95% UNKNOWN, nothing to review", which is also
what a correct run against a stranger sweep looks like.

The fix is in code, not in that setting: `selectAll` in `api/_lib/modDb.js` pages
with `Range` headers and refuses to read a table that can outgrow one page any
other way. Raising the dashboard value would fix this one symptom for every app
on the project and leave the next table to grow into the same trap.

Then run [`docs/sql/mod-grants.sql`](sql/mod-grants.sql) in the SQL editor.
**Exposing the schema is not enough on its own.** Exposure controls which
schemas PostgREST will serve; it says nothing about who may read them, and
Supabase's default privileges only cover `public`, so a hand-created schema
starts with `service_role` holding no `USAGE` and no table privileges at all.
Without the grants every endpoint fails with `permission denied for schema mod`,
which points at the schema rather than at the grant that was never made.

**Leave every `mod.*` table unticked** under _Exposed tables_. Those toggles
manage the Data API roles (`anon`, `authenticated`), and those two should have
neither a grant nor a row-level policy — two independent reasons they see
nothing. The grants file re-asserts that after granting, and sets it as the
default for tables added later, so it holds whether or not _Automatically
expose new tables_ is on.

### 3. Environment

```
SUPABASE_URL=https://zdzjtziydmwkxbzlkwxv.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
MOD_IDENTIFIER=did:plc:...   # handle works too; the DID is better
MOD_APP_PASSWORD=...
AI_GATEWAY_API_KEY=...
MOD_AGENT_MODEL=anthropic/claude-opus-5   # optional
```

`CRON_SECRET` must be set. All moderation endpoints **fail closed** — an unset
secret breaks the crons rather than opening the endpoints.

### 4. Build the reference data

**From the portal.** Open `/admin?view=moderation` and click **Check / build
reference data**. It loops until the snapshot is complete — two or three
batches, under a minute — and the footer reports `ready` when it is done.

No `CRON_SECRET` needed, which matters because Vercel does not show that value
back to you once it is set. The browser holds an OAuth session and mints its own
short-lived token; the secret exists for Vercel's own cron invocations.

The hourly cron would get there by itself, but watch the first build rather than
assuming it.

If you would rather drive it from a terminal, `vercel env pull .env.local` will
write the decrypted values into a local file, and then:

```bash
curl -sS -X POST https://dame.is/api/mod-precompute \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

Repeat until `{"state":"finalised"}`. Verify either way:

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

Two ways in, both answered in seconds by the droplet consumer
(`services/mod-consumer/`, which has its own README):

- **DM the moderator account** a post link. A 2s `chat.bsky.convo.getLog` poll
  picks it up; the answer comes back in the same conversation.
- **Mention the bot in a post**, or reply to or quote one of its posts. The
  subject is the link you pasted, or failing that the post you are replying to
  or quoting. **The answer is a public reply in that thread.**

That second one is public, and worth being deliberate about: the reply is
readable by the accounts being described and by everyone else in the thread. The
public prompt asks for counts by band rather than rosters of handles and says to
move a roster to a DM — a prompt, not a guarantee. Replies carry no mention
facets, so nobody named in one is notified. `PUBLIC_REPLIES=false` on the droplet
turns the whole public path off and leaves the DM loop alone.

**The Vercel cron is retired.** `api/mod-agent.js` still exists and runs the same
pass over the same cursor, as the escape hatch for when the droplet is down:

```bash
curl -sS -X POST https://dame.is/api/mod-agent \
  -H "Authorization: Bearer $CRON_SECRET" | jq
```

There is no lease on `mod.dm_cursor`, so running that **while the consumer is up**
can answer a message twice — both sides can read the same cursor during the
5-20s model call. Stop the service first. That is the whole reason it is not
scheduled any more.

`{"answered":0,"scanned":N}` means the message was seen but not from your DID,
or the DM-access toggle is off.

It reads the conversation back before answering, so follow-ups work: "what
about the third one", "why is that one connected", "show me the rest". History
is per conversation and comes from Bluesky itself, so there is no state to keep
and two threads cannot bleed into each other. Replies longer than a DM are sent
as several messages and folded back into one turn when read.

It is live now, which it was not: the ten-minute cron made it correspondence.
The floor is the model call — 5-20s for a harvest, a score and a reply — so the
transport is no longer what you are waiting for.

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
