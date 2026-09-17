# mod-consumer

The moderation analyst, answering in seconds instead of in ten minutes.

Runs on the DigitalOcean droplet alongside the anisota, tracker and turtle
consumers. It is a **trigger**, not a second implementation: every answer comes
out of `src/lib/moderation/agent.js`, and the DM pass is the same module
`api/mod-agent.js` runs.

## The three loops

| Loop   | Source                            | Latency    | Answers in              |
| ------ | --------------------------------- | ---------- | ----------------------- |
| Public | Jetstream, `app.bsky.feed.post`   | sub-second | the public thread       |
| DM     | `chat.bsky.convo.getLog`, 2s poll | ~2s        | the DM convo            |
| Drift  | a timer, `DRIFT_EVERY_HOURS`      | weekly     | a DM, if anything moved |

All three go through one work queue, so a drift run scoring 8,500 accounts
cannot arrive in the middle of answering a DM.

### Why drift runs here and not on a cron

Re-scoring the whole list is ~600 AppView requests. A serverless time budget is
what turned the precompute into a resumable state machine with three bugs in it,
and this is a long-lived process with the reference data already in hand.

It DMs only what changed, and `renderBrief` returns `null` when nothing did — so
most weeks it says nothing at all. A brief restating 8,543 unchanged rows is one
that stops being read, which is the same failure as a batch nobody reviews.

Results are written as an ordinary `mod.audit` row, so a drift run and the
portal's Audit tab share one record rather than keeping parallel histories. When
picking a baseline to diff against it **skips audits that scored nothing**: an
empty audit shadowing a real one is how a stale review queue survives a week
looking healthy.

### Why the Jetstream subscription is filtered to the roster

Jetstream filters by `wantedCollections` and `wantedDids` only, and `wantedDids`
matches the record's **author**, not its subject. Usually that is the awkward
half of the API. Here it is exactly right: the only posts this consumer may act
on are written by accounts on the roster, so the filter that cannot express
"posts about the bot" can express the rule that actually matters.

**Every answered DID has to be in that subscription** or its mentions never
arrive at all — the transport drops them before `classify()` is ever asked, and
an allowlist that widens the rule without widening the subscription looks
exactly like one that does not work.

The alternative was the whole post firehose — ~62 events/s, ~3.3 GB/day measured
— matched in process. That is three gigabytes a day to find a handful of posts
we can ask for by name.

The author is checked **again** in `classify()`, because the subscription filter
is a bandwidth decision made by the transport and the author check is a rule. A
dropped query parameter or a widened subscription during debugging would
otherwise turn the rule off with nothing to notice it.

### Why DMs can never come over Jetstream

Settled; do not re-investigate. `chat.bsky.*` conversations are not repository
records. They live in the chat service (`did:web:api.bsky.chat`) with separate
storage, so they never enter a repo, never hit the firehose, and never reach
Jetstream. The three protocol subscriptions are `subscribeRepos`,
`subscribeLabels`, and `chat.bsky.moderation.subscribeModEvents` — the last of
which is private and Ozone-only. Polling `getLog` is the only option there is.

**Do not tune the poll down.** 2s is 0.5 req/s against a documented 10/s per-IP
ceiling, and `getLog` with a stored cursor returns almost nothing when idle. The
model call is 5–20s, so 2s → 500ms moves felt latency by under 10%. The lever
for speed is the model or a streamed reply, not the transport.

### Replay is ~36 hours, measured

`jetstream2.us-west` answered a 30-day cursor with events from 36.0h ago, so
that is the window a stored cursor can actually resume into. An outage longer
than that leaves a gap the consumer cannot see — ask again rather than waiting.

It also means a restart replays up to 36 hours of dame's posts, which is the
other half of why the answered set is written to disk rather than kept in
memory.

## What it will and will not do

- **Only the roster is answered.** Checked at the transport and again in
  `classify()`. A stranger mentioning the bot gets nothing back — not even an
  error, which would itself be a reply. The roster is dame plus whatever
  `MOD_ALLOWED_DIDS` names, and it is read-only unless a DID is also in
  `MOD_WRITER_DIDS` — see [senders.js](../../src/lib/moderation/senders.js),
  which is the only place that decides.
- **The analyst decides nothing.** Bands come from the graph in `score.js`. No
  model output moves an account between them, which is what keeps the decision
  log replayable.
- **Tools are read-only.** A test asserts no tool name starts with a write verb.
  The only network writes this service makes are the reply itself.
- **No mention facets, ever.** A rich-text pass would turn any handle in the
  answer into a mention, and a mention notifies. The people in a moderation
  analysis are precisely the people who must not get a notification saying they
  are in one. Handles go out as plain text; links go out unlinked.
- **Public replies are capped at four posts** and say when they were cut. Nine
  public posts of analysis under someone else's thread is louder than the thing
  being analysed.

### The public surface is public

This is the part to be deliberate about. A public reply is readable by the
accounts being described and by everyone in that thread, so the `post` system
prompt asks for counts by band rather than rosters of handles, and says to move
a roster to a DM. That is a prompt, not a guarantee. `PUBLIC_REPLIES=false`
leaves the DM loop running alone if you want the guarantee.

## At most once, deliberately

Both paths drop a trigger rather than risk answering it twice:

- the DM cursor advances **before** any reply is sent, so a message that crashes
  a turn is dropped instead of replayed into an infinite loop of DMs;
- a public trigger is written to the answered set **before** the model is
  called, because Jetstream replays from a cursor and this consumer recycles its
  connection on a timer, so the same post arrives again as a matter of course.

One duplicate public reply under someone else's thread is worse than one missed
answer that dame can see is missing and simply ask again.

## Running it

Node 22 is required — `ai@7` declares `node >=22`, and this box ships Node 18,
which is also past end of life. `/opt/node22` exists for this service alone so
the other three consumers keep the runtime they were tested on.

```bash
# Dependencies install at the REPO ROOT, not in this directory. The shared
# modules resolve `ai`, `zod` and `@atproto/api` from there.
npm ci --omit=dev

cp services/mod-consumer/.env.template services/mod-consumer/.env
$EDITOR services/mod-consumer/.env

install -m644 services/mod-consumer/mod-consumer.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now mod-consumer
journalctl -u mod-consumer -f
```

This service has **no dependencies of its own**, on purpose. WebSocket is built
into Node 22 so `ws` is unnecessary; systemd's `EnvironmentFile` reads `.env` so
`dotenv` is too.

Try it dry first — classifies and logs, never posts or DMs:

```bash
cd /root/dame.is/services/mod-consumer && DRY_RUN=true LOG_LEVEL=debug /opt/node22/bin/node src/index.js
```

## Gotchas already paid for

- **`SUPABASE_SERVICE_ROLE_KEY`, not `SUPABASE_KEY`.** The other three consumers
  on this box use the latter name. `api/_lib/modDb.js` reads
  `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY` and nothing else, so
  `SUPABASE_KEY` here is silently ignored.
- **The app password needs DM access ticked.** A plain one is excluded from
  `chat.bsky.*` and the DM loop finds nothing, silently and forever. The
  consumer probes this at boot and says so in the log.
- **`MOD_IDENTIFIER` is a DID.** `botAgent` verifies the session DID against it,
  which catches an identifier and an app password from two different accounts
  before anything is written to the wrong repo.
- **Sessions are resumed, not re-established.** `createSession` is capped at
  300/day. A long-lived process makes this easy — one login at boot, refreshes
  thereafter — but only because it goes through `botAgent`.
- **The reference is held, then released.** 73k vouch rows on a 512 MB box with
  three other services is not something to hold forever to answer a question
  every few days. It is reused for 15 minutes and dropped 10 minutes after the
  last question. A reload is ~74 paged requests and about five seconds.
- **Vouch reads must be paged.** PostgREST caps a select at the project's Max
  rows (1,000 here) with no error, and `mod.vouch` is 73,215 rows. See
  `selectAll` in `api/_lib/modDb.js` — this was live for a while and it makes
  the gate look like it is working while it waves everyone through.
