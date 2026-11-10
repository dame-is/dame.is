# Sunfarming results

[Sunfarming](../experiments/sunfarming/) is a small game at
`/experimenting/sunfarming`. A player who gets an island off its diesel
generator can post how many days it took, and each island has a board of
everyone's results. Like the [guestbook](GUESTBOOK.md) and the
[reactions](EXPERIMENTING.md), no central database holds them: a result lives
on the **player's** PDS, and a board is assembled at read time from backlinks.

```
at://<me>/is.dame.sunfarming.island/<key>     ← a NAME for a board; nothing is stored here
        ▲
        │ subject (at-uri)
        │
is.dame.sunfarming.result                     ← on EACH PLAYER's repo, record key = <key>
  { subject, island, date?, days, createdAt }
```

## The record

### `is.dame.sunfarming.result`

| field       | what it is                                                                 |
| ----------- | -------------------------------------------------------------------------- |
| `subject`   | The board's at-uri: `at://<host did>/is.dame.sunfarming.island/<key>`.     |
| `island`    | The island's id: `tern`, `pines`, `windward`, … or `today`.                |
| `date`      | For the daily island only, the UTC day it was the island of: `YYYY-MM-DD`. |
| `days`      | How many island days it took. Fewer is better.                             |
| `createdAt` | When it was posted.                                                        |

`<key>` is the island's id, or `today-YYYY-MM-DD` for the daily island, which
is a different island (and so a different board) every day.

**The board's address is a name, not a record.** Nothing is ever written at
`is.dame.sunfarming.island/<key>`. It exists so that results have something to
point at that a backlink index can gather them by; an index records links to
at-uris whether or not anything is stored at them.

**One result per person per board.** The record's key is the board's key, so
a player's repo can hold at most one result for a board, and posting again
(after a quicker run) replaces it. A reader ranks by `days`, then by who
posted first, and shows one line per account even if it finds more
(`rankResults` in [`src/lib/sunfarmingResults.js`](../src/lib/sunfarmingResults.js)).

**Nothing verifies a result.** It is what the player's own game said, written
by the player's own account. A record can be written by hand with any number
in it. The board is a guest list more than a leaderboard, and says so.

## How a board is read

The same three hops as reactions, in
[`src/lib/sunfarmingResults.js`](../src/lib/sunfarmingResults.js):

1. **Backlinks — [Constellation](https://constellation.microcosm.blue).**
   `blue.microcosm.links.getBacklinks` with the board's at-uri as `subject`
   and `source = is.dame.sunfarming.result:subject`.
2. **Hydration — [Slingshot](https://slingshot.microcosm.blue)**, falling back
   to the player's own PDS.
3. **Identity** from the public Bluesky AppView.

There is no build-time snapshot: a board is read when it is opened. The index
can trail a write by a few seconds, so a result just posted is shown from what
the page itself wrote until the index catches up.

## Signing in to post

Posting uses the site's atproto OAuth client. A visitor who signs in from the
game is asked for
`repo:is.dame.guestbook.entry repo:is.dame.experiment.reaction repo:is.dame.sunfarming.result`:
write access to their results, and to the reactions and guestbook signature
they may already have here, and nothing else. (All three, because an account
holds one session on this site; asking for results alone would take the other
two away.) `PLAY_SCOPE` in [`src/lib/oauthClient.js`](../src/lib/oauthClient.js)
is that grant, and it is in the union the client declares there and in
`api/client-metadata.js`.

- **Signed out.** The board asks for a handle. The result waits in
  `sessionStorage` across the hop to the player's PDS and is posted on the way
  back, and the board opens to show it. A result left waiting longer than
  fifteen minutes is dropped.
- **Signed in.** One press posts it.
- **Signed in from before results existed** (a reactor, a guestbook signer).
  Their session can't write a result, so the page checks its scope first and
  sends them to approve the one new permission, once.

## Where the game ends and the site begins

The game is a package of its own and knows none of this. It takes one optional
prop, `social`: who is signed in, a way to post, and a way to read a board.
Given one, it shows "Post result" and the boards. Without one (the standalone
build) it offers a line of text to copy and a link that opens Bluesky's
composer with it. [`src/hooks/useSunfarmingSocial.js`](../src/hooks/useSunfarmingSocial.js)
is what the site hands it; the prop's shape is in the game's
[README](../experiments/sunfarming/README.md#posting-results).
