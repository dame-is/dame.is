# unblock-consumer

Watches Bluesky for blocks being taken away.

Plenty of tools show who blocks you. This one records the opposite: when
somebody who had blocked an account stops. It feeds
[`/experimenting/unblocking`](../../src/pages/Unblocking.jsx), which shows who
has been unblocked by the most people and, for any account, who unblocked it
and when.

Runs on the DigitalOcean droplet alongside the anisota, tracker, turtle and mod
consumers.

```
Jetstream ──▶ events.js ──▶ fold.js ──▶ store.js   (SQLite, on this box)
 every block                 the rules      │ outbox
 record made,                               ▼
 rewritten or                          publish.js ──▶ Supabase ──▶ api/unblocked.js ──▶ the page
 deleted                                              (unblock schema)
```

## Why it has to keep every block

A deleted record arrives as a repo and a record key and nothing else. It does
not say what the record was, so a deleted block does not say who it blocked.
The only way to know who was just unblocked is to have been holding the block
since it was made.

So the consumer keeps an index of every block it has seen created and not seen
undone: `(blocker, record key) → who was blocked, and when`. A delete is looked
up in it. If the block is there, that is an unblock with a name on it. If it
is not (the block was made before the index began, or has since been dropped
from it), the delete is counted and nothing more can be said about it.

That has two consequences worth knowing before you read the page.

**It starts out nearly blind.** On its first day the index holds a day and a
half of blocks, so the only unblocks it can name are of blocks made in that
day and a half. The share it can name climbs for as long as it runs. The page
states the share outright (`deletesPlaced` of `deletesSeen`), because a count
of "people who unblocked you" means little without it.

**How far back it can see is a question of disk.** See below.

## What counts as an unblock

All of this is [`src/fold.js`](src/fold.js), and
[`src/store.test.js`](src/store.test.js) holds each rule.

- A block record is deleted, the index knows who it blocked, and the same
  account holds **no other block record on the same person**. A second record
  means nothing was undone. (The check reads at most 5,000 of an account's
  blocks, so that an account undoing a hundred thousand of them does not read
  all hundred thousand for each. Past that bound a second record can be
  missed.)
- A block record **rewritten in place** to name somebody else, or to name
  nobody (something that isn't an account, or its own author), ends the block
  on whoever it named before.
- An unblock **stands until the same account blocks the same person again**,
  and is then withdrawn. What is published is the set of unblocks that still
  hold, one row per pair of accounts, so somebody who blocks and unblocks ten
  times is one row and not ten.
- An account **deleting itself** does not unblock anybody. Its blocks leave
  the index quietly, and anything published about it, on either side of a
  pair, is removed. It is then remembered as deleted for as long as the index
  reaches back that far, so that other people's blocks on it being tidied away
  later are not published as unblocks of an account that no longer exists.
- Events are timed by Jetstream's clock. A record's own `createdAt` is its
  author's claim, and one seen while this was being built was an hour ahead of
  its own arrival.

Not watched: `app.bsky.graph.listblock`. Blocking a list is a different
record, and an account coming off a blocked list is a change to the list, not
a record of its own.

**One way it can be wrong.** If an account holds two block records on the same
person and the older one is outside the index (made before tracking began, or
since dropped), deleting the newer one is published as an unblock while the
older record still blocks. The index cannot see what it never held. It needs
a duplicate to happen at all, and those are rare: of the 5,928 accounts
blocking one well-blocked account when this was written, 4 held two records
on it. Checking the network before publishing (Constellation can say whether
an account still has a block record on someone) would close it, and was not
built.

## Quick ones

A block undone within five minutes is marked as quick. Blocking and then
unblocking straight away removes someone as a follower without leaving them
blocked (a soft block), which is an unblock in the record and close to the
opposite in meaning. The ranking leaves quick ones out; one account's list
shows them, labelled.

Nothing here decides that: the consumer records how long each block stood and
the reading side draws the line (`QUICK_SECONDS` in
[`src/lib/unblocking.js`](../../src/lib/unblocking.js)). **Five minutes is a
guess**, made before there was data to check it against. Once this has run for
a few weeks, look at how long the short ones really last:

```sql
select width_bucket(extract(epoch from unblocked_at - blocked_at), 0, 3600, 60) as minute,
       count(*)
from unblock.event
where unblocked_at - blocked_at < interval '1 hour'
group by 1 order by 1;
```

## Disk, which is the setting that matters

The index is one SQLite file. Measured with 1.5 million synthetic blocks shaped
like real ones: **62 bytes a block**. The network made about 324,000 blocks a
day in the week of 2026-11-03 (and deleted about 8,400), so the index grows by
roughly **20 MB a day**.

`MAX_DB_MB` is a ceiling on it. When the index reaches the ceiling the oldest
blocks are dropped to make room, and the date it reaches back to (the horizon)
moves forward. An unblock of a block older than the horizon can no longer be
named. So the ceiling is how old a block can be and still have its unblock
noticed:

| `MAX_DB_MB` | reaches back about |
| ----------- | ------------------ |
| 1024        | 7 weeks            |
| 2048        | 14 weeks (default) |
| 4096        | 7 months           |
| 8192        | 13 months          |

These are arithmetic from one week's rate and one synthetic measurement. The
`Stats` line in the journal has the real numbers (`held`, `usedMb`, `horizon`)
once it has run.

**Expect the file to settle a little over the number you give it.** Dropping
old blocks empties very few pages (an old block shares its page with newer
ones from other accounts), so the size barely moves when blocks are dropped.
A ceiling steered by bytes drops, sees no change, and drops again: measured,
it threw away 18% of the index to get 2% under. So the ceiling is held as a
count of blocks instead. The first time the size reaches `MAX_DB_MB` the
number of blocks that fit is worked out once, and that number is what is kept
to from then on, nudged by 3% at the end of a sweep if the size has drifted
more than 10% either way. In a 150-day simulation that kept a constant reach
back, with one sweep a day, and the file sat between 4% and 10% over the
ceiling. Leave that much room, plus a few MB for SQLite's write-ahead log.

The default is deliberately modest, because this box has gone down to a full
disk before. Check `df -h` and raise it as far as you are comfortable: disk is
the only thing standing between this and a longer memory.

Dropping is done a slice at a time (257 slices of the key space, one every few
seconds), so it never holds the process for long, and it picks up where it
left off after a restart. Changing the ceiling later works in both
directions: raised, the index simply grows into it; lowered, the excess is
dropped and the file is shrunk in place, without a `VACUUM`.

Memory, measured in test runs and not on this box: 123 MB at the peak of
swallowing a 500,000-block replay, 70 to 90 MB while following. The unit file
caps it at 200 MB.

## Setting it up

1. **The schema.** Run [`docs/sql/unblock.sql`](../../docs/sql/unblock.sql) in
   the Supabase SQL editor (the atpota.to project), then add `unblock` under
   Settings → API → Exposed schemas. The file's header says what to check if
   the toggle does not take.

2. **The service.**

   ```bash
   cd /root/dame.is && git pull
   cp services/unblock-consumer/.env.template services/unblock-consumer/.env
   $EDITOR services/unblock-consumer/.env     # the Supabase key, and MAX_DB_MB
   ```

   There is nothing to `npm install`. WebSocket and SQLite are both built into
   Node 22, and the one module shared with the site has no dependencies.

3. **Try it first without publishing.** It keeps the index and holds what it
   would have sent:

   ```bash
   cd /root/dame.is/services/unblock-consumer
   PUBLISH=false LOG_LEVEL=debug STATS_INTERVAL_MS=30000 \
     /opt/node22/bin/node --experimental-sqlite src/index.js
   ```

   The first run starts 35 hours back, so `held` in the `Stats` line should
   climb into the hundreds of thousands as it catches up, with a few `placed`
   along the way. How long catching up takes on this box is not known yet.
   Ctrl-C stops it cleanly. What it held in its outbox is sent when it next
   runs with publishing on, so nothing from the trial is wasted.

4. **Run it for real.**

   ```bash
   install -m644 services/unblock-consumer/unblock-consumer.service /etc/systemd/system/
   systemctl daemon-reload
   systemctl enable --now unblock-consumer
   journalctl -u unblock-consumer -f
   ```

5. **Put it on the bench.** The page exists as soon as the site is deployed.
   What lists it at `/experimenting` is an `is.dame.experiment` record whose
   `url` is `https://dame.is/experimenting/unblocking` (Content → Experimenting
   → New in the admin).

The site needs nothing new: `api/unblocked.js` reads with the
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` the Vercel project already has
for the moderation tools.

## Reading the log

One line every half hour:

```
[INFO] Stats { frames=…, events=…, held=…, unblocks=…, deletes=…, placed=…,
               unplaced=…, duplicate=…, moot=…, reblocked=…, waiting=…,
               usedMb=…, fileMb=…, horizon=…, rssMb=… }
```

- `held`: blocks in the index. `unblocks`: unblocks that stand.
- `deletes` = `placed` + `unplaced` + `duplicate` + `moot`. `placed` became
  unblocks; `duplicate` undid nothing (a second record still blocks); `moot`
  were blocks on an account that has since been deleted. `unplaced / deletes`
  is the share it could not name, and should fall week over week.
- `waiting`: the outbox. It should be 0, or briefly small. If it grows,
  Supabase is refusing; the reason is in a `Could not publish` warning.
- `horizon`: how far back the index reaches.

To look inside while it runs, if the `sqlite3` command is installed (SQLite
allows a second reader):

```bash
sqlite3 unblock-index.db "select value from meta where key = 'state'"
```

## What happens when things go wrong

- **Supabase is down, or the schema is not there yet.** Nothing is lost. The
  outbox holds every conclusion in order and is sent when Supabase answers.
- **Jetstream goes away.** A refused connection, a closed one, or 90 seconds
  of silence (this stream is never quiet) all end the same way: the socket is
  given up on and another is tried, a second later at first and up to every
  30 seconds, from the saved cursor. It does not wait for the old socket to
  finish closing, because a peer that has stopped answering never lets it.
- **The process dies or the box reboots.** It resumes from its cursor, which
  is saved in the same transaction as the events themselves, so the index and
  the cursor cannot disagree.
- **It is down for more than about 36 hours.** Jetstream keeps roughly that
  much, so blocks made during a longer outage are never seen, and their later
  unblocks cannot be named. The index is otherwise unharmed.
- **A write fails** (a full disk). It exits instead of skipping the batch, and
  systemd restarts it. If the disk is full it will keep exiting, loudly, which
  is the right behaviour for a hole that would otherwise be silent.
- **Starting over.** Stop the service, delete `unblock-index.db*`, and empty
  the two tables (`truncate unblock.event, unblock.status;`). It will begin
  again from 35 hours back.

A restart leaves one small mark: a cursor resumes inclusively, so the last
event before a stop is delivered again. If that event was a delete it is
counted twice in `deletes`, the second time as `unplaced`. The index and what
is published are unaffected.

## What was and was not verified

Built in a sandbox that cannot open a WebSocket to the internet, so:

- **Verified:** the rules, the store, the pruning, the transport's reconnect
  logic and the publisher, by the tests here. The SQL, by running it in a real
  Postgres engine (PGlite), including that only the service role can use it.
  The whole path from a stream of v1 frames to what the page's endpoint
  returns, by running this process against a local stand-in for Jetstream and
  for Supabase, including a restart and a Supabase outage in the middle. And
  the two ways a real socket fails, with this process and Node's own
  WebSocket: a peer that shakes hands and then goes mute, and a host that
  refuses the connection and later comes back.
- **Not verified:** a connection to the real Jetstream. The v1 frame shape and
  the default host are the ones the mod-consumer already runs against, so that
  is the low-risk part, but the first real run is the first real test. Watch
  the dry run.
- **Not verified:** `JETSTREAM_API=v2`. It is written from
  [the documentation](https://bsky.network/docs/jetstream) and its published
  example. Left off by default.

## Not built

Two ways to see further back than the day the index began, neither attempted:

- **Jetstream v2 can replay history**
  ([Network Replay](https://bsky.network/docs/jetstream-replay)) with an API
  key, metered by bytes. Replaying `app.bsky.graph.block` from the start of
  its archive would fill the index with blocks made before this began. How
  far back that archive goes, and what it would cost, were not looked into.
- **Asking for one account's blockers.** Constellation indexes which records
  point at an account, block records included (checked: `getBacklinks` with
  the source `app.bsky.graph.block:subject` returns each block's repo and
  record key, which is exactly the index's key). For an account someone looks
  up, the blocks currently on it could be fetched and added to the index, so
  any later unblock of that account could be named however old the block. It
  would make one account's page complete from the day it was first looked up.
  It would also make the ranking uneven, since looked-up accounts would be
  seen better than everyone else, and those rows would need keeping out of
  the way of the sweep that drops the oldest. It wants thinking about before
  building.
