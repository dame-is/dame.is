# Admin harness

The admin is behind an OAuth gate scoped to a single DID, so there is no way to
open `/admin` locally — or in CI, or from a screenshot tool — without a real
sign-in. That makes the one part of the site with the most UI in it the one part
nobody can look at while working on it.

This harness fixes that. It runs the **real** app — real router, real providers,
real admin components, real stylesheets — with exactly one module swapped out:

| real                                | harness                |
| ----------------------------------- | ---------------------- |
| `src/hooks/useAtprotoSession.jsx`    | `harness/fakeSession.jsx` |

The fake presents a signed-in owner session whose `agent` is an in-memory
stand-in for the PDS, covering the six `com.atproto.repo.*` methods the app
actually calls. Writes mutate the fixture repo, so saving, deleting and bulk
actions all behave — for the lifetime of the page.

## Running it

```
npm run harness          # http://localhost:5174/admin
```

Any admin URL works, because the router is real:

```
/admin                                   front desk
/admin?c=site.standard.document          a record list
/admin?c=is.dame.now&r=<rkey>            an editor
/admin?view=sky                          a studio
```

## Query flags

| flag         | effect                                                        |
| ------------ | ------------------------------------------------------------- |
| `?hour=19`   | pin the sky palette to that hour, so screenshots don't drift   |
| `?latency=0` | drop the simulated 120ms XRPC latency (default is `120`)       |

## Fixtures

`harness/fixtures.js` builds a deterministic repo — seeded PRNG, fixed clock at
`2026-04-02T16:04Z` — so two runs render identically and screenshots can be
diffed. It covers every collection the admin touches, sized so lists, paging,
filters and counts all have something real to work on: 28 documents (3 drafts,
8 portfolio), 42 statuses, 60 posts, 240 plays, 6 channels, 8 pages, 7
guestbook signatures, 7 hero phrases, 2 publications, 3 resume versions with
jobs and education, 8 ratioed pieces, and the nav and sky singletons.

## What it is not

Not a test suite and not a mock of the protocol — it is a viewing window. It
does not validate records against lexicons, enforce CIDs, or model swap/compare
semantics. If a bug only reproduces against a real PDS, this will not show it.

Nothing here ships. `npm run build` uses the root `index.html` and never reads
this directory; `vite.harness.config.js` is dev-only.
