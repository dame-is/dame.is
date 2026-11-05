# Graph lists

Bluesky lists that keep themselves current: who you engage with, who engages
with you, and who sits close to you in the follow graph. Managed from the
**Graph** tab of `/admin?view=analytics`, synced every six hours by a cron.

## What a list can be

| Kind          | Picks                                                                     | Ranked by                |
| ------------- | ------------------------------------------------------------------------- | ------------------------ |
| `engaged-out` | People you liked, reposted, replied to or quoted, at least N times        | how often, in the window |
| `engaged-in`  | People who liked, reposted, replied to, quoted or mentioned you, N+ times | how often, in the window |
| `proximity`   | People you follow and/or accounts at least N of your follows follow       | degree, then that count  |

Every kind can be limited to people you don't follow yet, and every list has a
size cap (at most 1,000). The window is a rolling 30 days.

## Degrees, and how this ties to moderation

The proximity numbers are the moderation gate's, read the other way round
(see [MODERATION.md](MODERATION.md)):

- **1st degree**: you follow them. In the gate this is distance 0 and the
  `PROTECTED` band.
- **2nd degree**: at least one of your follows follows them. The count of how
  many is the gate's "vouch", read from the same weekly snapshot in Supabase
  (`mod.vouch`). 3 or more is where the gate draws `CONNECTED`, so the Graph
  tab splits 2nd degree into "close" (3+) and "loose" (1–2) at the same line.
- **Further**: none of your follows follow them, as of the snapshot. This is
  "not found", not "3 hops". The snapshot only enumerates accounts your follows
  follow; measuring a real 3rd degree means reading the follow lists of the
  ~82,000 accounts in it, which is the same cost the moderation doc already
  declined.

For scale, the snapshot taken 2026-11-05 had 259 follows and 82,321 accounts
at 2nd degree: 14,671 followed by 3+ of your follows, 3,009 by 10+, 1,130 by
20+. That is why proximity lists take a floor and a cap rather than "everyone
within 2 degrees".

Two links run the other way:

- **Accounts on the moderation list are never added** to a managed list. If the
  list can't be read, the sync says so in its coverage note.
- **Managed lists don't grant protection.** The gate treats members of dame's
  curation lists as `PROTECTED`. A managed list is a curation list in form, but
  nobody chose its members (an "engages with me" list fills with whoever
  replied most, pile-ons included), so `readCurationMembers` skips it unless
  its definition has `protects: true`. The change takes effect at the next
  weekly snapshot.

## Where things live

| Thing                   | Where                                                       |
| ----------------------- | ----------------------------------------------------------- |
| Rule + last sync counts | `is.dame.graph.list/<key>` in dame's repo (public record)   |
| The list                | `app.bsky.graph.list`, purpose `curatelist`, in dame's repo |
| Members                 | `app.bsky.graph.listitem` records                           |
| Who to pick (pure)      | `src/lib/graphLists.js`                                     |
| Gather + write          | `api/_lib/graphLists.js`                                    |
| Endpoint and cron       | `api/graph-lists.js`, `vercel.json` (02:25, 08:25, …)       |
| UI                      | `src/components/AnalyticsGraph.jsx`                         |

The definition records hold counts only. Who joined or left a list is returned
to the admin after a manual sync and is not written anywhere.

## How a sync works

1. Log in as dame with `BSKY_APP_PASSWORD` (the same one the iNaturalist mirror
   uses). The admin panel never writes these records itself, so the preview
   comes from the same code the cron runs.
2. Gather the window: notifications (inbound), your like/repost/post records
   (outbound), your follow records, the vouch snapshot, the moderation list.
   These are the Analytics studio's own sweeps (`src/lib/analyticsSync.js`)
   pointed at a server-side agent.
3. For each enabled list, read what is on it now, pick who should be, and diff.
4. Write the diff with `applyWrites`, removals first, at most 600 writes per
   run across all lists. Whatever is left is picked up next run.

The diff is recomputed from the list every time, so nothing has to remember a
half-finished run. Two overlapping runs can add someone twice; the next run
deletes the duplicate listitem.

**Stickiness.** A capped list would otherwise rewrite its boundary every run as
the 50th and 51st people trade places on a single like. Current members ranked
within 10% of the cap are treated as 10% higher, which stops the flapping
without keeping anyone who has drifted well away.

## Known limits

- Inbound reads up to 80 pages of notifications (8,000). If a busy month
  exceeds that, inbound counts start later than 30 days back and the tab says
  how far they reach.
- Proximity is only as fresh as the weekly snapshot.
- "Follows you" is only checked for people you follow (to find mutuals); the
  orbit doesn't mark followers you don't follow back.
- The Graph tab sits behind the Analytics studio's first-run screen like the
  other tabs, though it doesn't use the browser archive.
- A list deleted in another Bluesky client leaves its definition behind; the
  next sync reports the error. Use "Stop syncing" to clear it.
- Writes cost relay events on a shared PDS (see "What writes cost" in
  MODERATION.md). The first fill of a 1,000-member list is 1,000 events, spread
  over two runs.
