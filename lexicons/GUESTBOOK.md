# Guestbook lexicons

A decentralized guestbook on the AT Protocol. The book lives on the host's
PDS; every signature lives on the **signer's** PDS. No central database holds
the messages — the guestbook is assembled at read time from backlinks.

```
is.dame.guestbook (self)          ← on MY repo: the book itself (title, description)
        ▲
        │ subject (at-uri)
        │
is.dame.guestbook.entry           ← on EACH VISITOR's repo: their signature
  { subject, text?, signature?, mark?, location?, createdAt }
```

## The two records

### `is.dame.guestbook` — the book

A singleton (`rkey = self`) on the host's repo. It exists mainly to be a
stable **backlink target**: entries point their `subject` at
`at://<host-did>/is.dame.guestbook/self`. It also carries the book's display
title and a description of what signing means. Create it once with
[`scripts/create-guestbook.mjs`](../scripts/create-guestbook.mjs).

### `is.dame.guestbook.entry` — a signature

One record per signature, written to the **visitor's own repo** when they sign
in with atproto OAuth on `/guestbook`. Everything except `subject` and
`createdAt` is optional, so a signature can be:

- a **message** (`text`, ≤300 graphemes),
- just a **mark** (`mark`, one glyph — "I was here"),
- or both, plus an optional `signature` (a name to sign as, when the profile
  displayName isn't how they want to be remembered) and `location`
  (free-text "signing from…" — never structured geo data).

## How the book is read

1. **Backlinks — [Constellation](https://constellation.microcosm.blue).**
   `blue.microcosm.links.getBacklinks` with
   `subject = at://…/is.dame.guestbook/self` and
   `source = is.dame.guestbook.entry:subject` returns
   `{ total, records: [{did, collection, rkey}], cursor }` — the list of
   everyone who signed, newest first, paginated.
2. **Hydration — [Slingshot](https://slingshot.microcosm.blue).** Each
   `(did, collection, rkey)` triple is fetched through Slingshot's cached
   `com.atproto.repo.getRecord`, which resolves the signer's PDS itself.
   If Slingshot is down, we fall back to resolving the DID document and
   hitting the signer's PDS directly.
3. **Identity.** Signer profiles (avatar, displayName, handle) come from the
   public Bluesky AppView in batches of 25 (`app.bsky.actor.getProfiles`).

Because reading is pure backlink-assembly, a future **AppView** for guestbooks
only needs to index `is.dame.guestbook.entry` records from the firehose — the
site would swap step 1–3 for one call without any schema change. And any other
site can host its own book with the same two lexicons.

## The original lofi guestbook (legacy signatures)

Before `is.dame.guestbook`, this PDS hosted a "lofi" guestbook built on the same
backlink idea but a different pair of ad-hoc collections. That book is **closed**
— new signatures use `is.dame.guestbook.entry` — but its signatures are real
history, so the read path folds them in as older entries (see
[`src/lib/guestbook.js`](../src/lib/guestbook.js) and `LEGACY_GUESTBOOK_*` in
[`src/config.js`](../src/config.js)). Announced in
[a-guestbook-and-welcome-message-for-my-pds](https://dame.is/blog/a-guestbook-and-welcome-message-for-my-pds/).

```
a.guestbook.for.my.pds (rkey 'guestbook')   ← the old book on MY repo
        ▲
        │ guestbook (at-uri)
        │
a.guestbook.i.signed                          ← each signer's repo: their signature
  { $type, guestbook, message?, createdAt? }
```

Two shape differences from the modern records, handled at hydration:

- The signature links the book through a **`guestbook`** field (not `subject`),
  so the Constellation source is `a.guestbook.i.signed:guestbook`.
- The note lives in **`message`** (surfaced as `text`), and `createdAt` is
  usually absent. When it is, the timestamp is recovered from the signature's
  **TID rkey** (`tidToTimestamp`); a couple of human-chosen rkeys have no
  decodable time and simply render undated.

Everything downstream is shared: legacy entries are hydrated (Slingshot →
direct PDS), profiled, and moderated (the book's `hidden` list can name legacy
at-uris too) exactly like modern ones, and each row carries a small "from the
old guestbook" tag linking the retired book record. Merging is a plain tail:
every legacy signature predates the modern book, so once the modern pages are
exhausted the legacy set — small and closed — is loaded in one shot and
appended, already in chronological order.

## Moderation & ownership

- A visitor can **delete their signature** (it's their record; the site offers
  the button, `com.atproto.repo.deleteRecord` does the rest) — the backlink
  disappears from Constellation and the book on the next read.
- The host can't delete a visitor's record, only decline to render it. That's
  the book's **`hidden`** list: an array of entry at-uris the host has tucked
  out of public display. Hiding/unhiding is a `putRecord` on the book (with a
  CID swap so concurrent edits can't clobber each other); the public page
  filters entries against the list at read time and subtracts them from the
  signature count. Because the list lives on the book record, moderation
  state is itself portable — any other renderer of the same book can honor
  (or inspect) it. The site offers it in two places: **edit mode** on
  `/guestbook` (the owner's pencil button — each signature grows hide/unhide)
  and the **Guestbook panel** in `/admin` (`?view=guestbook`).
- Nothing sensitive is collected: no email, no IP, no structured location —
  `location` is a free-text field the signer types (or leaves empty). The
  form's optional **"Use my region"** button asks the browser for location
  (an explicit click behind the browser's own permission prompt), blurs the
  coordinates to ~11 km before they leave the device, and fills the field
  with only *state/region + country* — never a town, city, or coordinates.
  The label is editable before signing; nothing auto-submits.
