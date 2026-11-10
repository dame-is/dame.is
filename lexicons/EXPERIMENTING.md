# Experimenting lexicons

`/experimenting` is where quick prototypes and half-formed concepts go up
before they are finished, to find out what people make of them. An experiment
lives on the host's PDS; every reaction to it lives on the **reactor's** PDS.
No central database holds the reactions: they are assembled at read time from
backlinks, the same way the [guestbook](GUESTBOOK.md) assembles its signatures.

```
is.dame.experiment                ← on MY repo: one record per experiment
        ▲
        │ subject (at-uri)
        │
is.dame.experiment.reaction       ← on EACH VISITOR's repo: their reaction
  { subject, reaction, text?, createdAt }
```

## The two records

### `is.dame.experiment` — an experiment

One record per experiment, keyed by TID, on the host's repo. It renders on the
bench at `/experimenting` and on a page of its own at `/experimenting/{rkey}`.

| field       | what it is                                                                                |
| ----------- | ----------------------------------------------------------------------------------------- |
| `title`     | Required.                                                                                 |
| `pitch`     | The idea in a sentence or two (≤600 graphemes). The loudest prose on the entry.           |
| `kind`      | `concept`, `prototype` or `sketch` (open set): how far along it is.                       |
| `url`       | Where it can be tried. Becomes the "Try it" button; only `http(s)` is ever linked.        |
| `image`     | One picture, a blob (`imageAlt` is its alt text).                                         |
| `content`   | An optional longer write-up, a `pub.leaflet.content` body like a blog post's.             |
| `ask`       | The question set above the reaction buttons. Default: "What do you make of it?"           |
| `status`    | `open` (taking reactions, the default), `pursuing` (being built) or `shelved`.            |
| `draft`     | Hidden from everyone but the owner while true; takes no reactions.                        |
| `hidden`    | At-uris of reactions the host has tucked out of display. See [Moderation](#moderation).   |

Write one in the admin: **Content → Experimenting → New**
(`/admin?c=is.dame.experiment&mode=new`), or from the "Post an experiment"
button the owner sees on `/experimenting`.

### `is.dame.experiment.reaction` — a reaction

One record per reaction, written to the **visitor's own repo** when they react.
`subject` is the experiment's at-uri; `reaction` is the verdict:

| `reaction` | the button    | what it says                       |
| ---------- | ------------- | ---------------------------------- |
| `more`     | More of this  | Build it. I'd want this.           |
| `curious`  | Curious       | Interested, not sold yet.          |
| `pass`     | Not for me    | Doesn't land for me.               |

`text` is an optional note (≤300 graphemes). `reaction` is an open string in
the lexicon, so a record carrying some other word is still a reaction: it is
counted as "other" and shown in its own word, never dropped.

**One reaction per person per experiment.** Nothing in the protocol enforces
that, so the reader does: for each account only the newest record pointing at
an experiment counts (`latestPerPerson` in
[`src/lib/experiments.js`](../src/lib/experiments.js)). The page keeps it tidy
on the way in, too: changing a reaction writes the new record and then deletes
the one it replaces, and "Take it back" deletes it.

## Experiments built into the site

An experiment's `url` can point anywhere. When the thing to try is a page of
this site, the page lives under the bench, in the place an experiment's record
key would be. There are two: `/experimenting/culturing`, a bench of simulated
petri dishes ([`src/culturing/`](../src/culturing/)), and
`/experimenting/sunfarming`, a small game about a solar farm
([`experiments/sunfarming/`](../experiments/sunfarming/)).

- The path is listed in `EXPERIMENT_PAGE_PATHS` in
  [`src/lib/experiments.js`](../src/lib/experiments.js). The router gives it
  its own route, and the edge asks `isExperimentPagePath` before treating a
  path under `/experimenting` as a record, so it is served as a page (with its
  own entry in `og/pages.js`) instead of 404ing as a key that names nothing.
- The page is not a record. What puts it on the bench is an ordinary
  `is.dame.experiment` record whose `url` is the page's full address, for
  example `https://dame.is/experimenting/culturing`, so "Try it" opens it.
- The page finds that record by the address (`experimentForPage`) and links
  to its reactions. Until one is posted it only links back to the bench. That
  much is the same for every built-in experiment, so it is one component,
  [`src/components/ExperimentPage.jsx`](../src/components/ExperimentPage.jsx),
  which each one's page wraps itself in.

The experiment itself is a package of its own under
[`experiments/`](../experiments/), which the site imports and nothing more;
[`experiments/README.md`](../experiments/README.md) is that arrangement. What
the site has to be told about a new one's address is this, and the test
"is a page to the router, the crumbs and the edge" in
[`src/lib/experiments.test.js`](../src/lib/experiments.test.js) fails until
the first four are done:

| where                                          | what                                            |
| ---------------------------------------------- | ----------------------------------------------- |
| `src/lib/experiments.js`                       | the path, in `EXPERIMENT_PAGE_PATHS`            |
| `src/App.jsx`                                  | a lazy route, above `/experimenting/:rkey`      |
| `src/lib/breadcrumbs.js`, `og/routes.js`       | the same route, for the crumbs and the edge     |
| `og/pages.js`                                  | its title and description, for the head and card |
| `og/llms.js`, `scripts/prefetch.mjs`           | the path, for `llms.txt` and the sitemap        |

## How the reactions are read

The same three hops as the guestbook, in
[`src/lib/experimentReactions.js`](../src/lib/experimentReactions.js):

1. **Backlinks — [Constellation](https://constellation.microcosm.blue).**
   `blue.microcosm.links.getBacklinks` with `subject = at://…/is.dame.experiment/{rkey}`
   and `source = is.dame.experiment.reaction:subject`.
2. **Hydration — [Slingshot](https://slingshot.microcosm.blue)**, falling back
   to the reactor's own PDS.
3. **Identity** from the public Bluesky AppView (`app.bsky.actor.getProfiles`).

`scripts/prefetch.mjs` runs that walk at build time and writes the experiments
and their reactions to `public/data/experimenting.json`, so the bench paints
its tallies at once. On a visit the browser asks the index again, and because a
reaction record is replaced rather than edited, any reaction whose at-uri it
already holds is taken as read: a visit costs one backlinks request per
experiment, plus one record fetch for each reaction left since the build.

The signed-in visitor's **own** reactions are read straight from their repo
instead (`fetchMyReactions`). The backlink index can trail a write or a delete
by a few seconds, which on a page whose buttons say "you chose this" is long
enough to be wrong; their repo answers at once and is the truth about what
they said.

## Signing in to react

Reacting uses the site's atproto OAuth client. A visitor who signs in from
`/experimenting` is asked for a granular scope,
`repo:is.dame.guestbook.entry repo:is.dame.experiment.reaction`: write access to
their reactions here and their guestbook signature, and nothing else. (Both,
because an account holds one session on this site; granting reactions alone
would take the guestbook permission away from someone who had already signed
the book.) The union of every scope the client may request is declared in
`src/lib/oauthClient.js` and served by `api/client-metadata.js`; the two must
stay in step, and a test holds them to it.

- **Signed out.** Picking a verdict opens a line for a handle. The reaction
  waits in `sessionStorage` across the hop to the visitor's PDS and is written
  on the way back, with no second tap. A sign-in that fails clears it; one left
  waiting longer than fifteen minutes is dropped.
- **Signed in.** A tap is the whole act: the reaction is written at once.
- **Signed in from before `/experimenting` existed** (a guestbook signer). Their
  session can only write guestbook entries, so the page checks the session's
  scope first and sends them to approve the one new permission, once, instead
  of letting the write be refused.

## Moderation

- A visitor can **take their reaction back** at any time; it is their record.
- The host can't delete a visitor's record, only decline to show it. That is
  the experiment's **`hidden`** list: reactions named there are left out of the
  tally and the list. The owner, signed in, gets a hide / unhide control beside
  each reaction on the experiment's own page; it is a `putRecord` on the
  experiment with a CID swap, so two edits can't silently undo each other.
- A **note** the language filter flags ([`src/lib/profanity.js`](../src/lib/profanity.js))
  isn't shown publicly. The verdict it came with still counts.
- Nothing is collected beyond what the reactor writes: a verdict and, if they
  choose, a note.
