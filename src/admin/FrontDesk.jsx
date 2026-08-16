// The Front Desk — what `/admin` is when nothing is open.
//
// Four bands, in this order: the counts row, "Needs you" beside "Latest
// records", and the surface grid. The grid is last on the page and first in
// importance, because it is STATIC: it needs no data, it is clickable before a
// single request has resolved, and nothing on this page may ever block it on a
// fetch. Every number here arrives afterwards and lands in place of its own
// skeleton. The whole dashboard is navigable with zero successful requests.
//
// ON THE PHONE THE ORDER INVERTS, and three of the four bands change shape
// (docs/admin-mobile-design.md §3.1). Stacked, the page reads: what needs you,
// what changed last, then the numbers, then one door to everything else.
//
//  · The 18-tile surface grid and the `Open any collection` form are NOT
//    RENDERED below 60rem. They were 758px of the 2161px the dashboard took on
//    a phone — 2.9 screens before anything actionable — and the Surfaces sheet
//    now draws the same directory better and reaches it from any screen in one
//    tap. Their replacement here is one 48px row at the foot.
//  · The four count tiles collapse to a SCANLINE: one wrapping line box of
//    number + label pairs. Four blocks in a grid cannot hold a shared baseline
//    when one label wraps and another does not (measured: a 19.2px step); one
//    line box cannot break a baseline at all, and it is 56px doing the work of
//    236.
//  · The pane blurb and `Refresh counts` leave the head. The blurb explains the
//    page to a first-time reader and the owner has read it; Refresh moves into
//    the action bar's right slot, where it is 44px in the thumb's arc instead of
//    29.2px in the hardest corner of the screen.
//
// Both renderings of the counts row read ONE array (`countItems` below), so the
// tiles and the scanline can never come to disagree about what a number means.
//
// FIVE HONESTY RULES SHAPE EVERY LINE BELOW. Each one is a thing a dashboard
// normally gets wrong, and each one was settled by measuring the live repo
// rather than by reasoning about it.
//
//  1. **Every number is exact, or it carries a `+`.** `listRecords` caps at 100
//     records per page and AT Protocol has no count API, so a full page means
//     "at least this many". useAdminData hands that distinction over as
//     `complete`; nothing here renders a bare number without consulting it.
//  2. **The three large collections show no number at all.** Logging, Posting
//     and Listening are thousands of records — 246 requests for the Bluesky
//     posts alone. They show a label and a way in. Not "many", not "1000+",
//     nothing. An invented number is worse than no number.
//  3. **No number is a sum across collections.** Blogging and Creating are one
//     collection split client-side, and a document may cross-post onto both, so
//     surface counts are not a partition and adding them up would double-count
//     exactly the records the owner cares most about.
//  4. **No invented state.** There is no "awaiting review" queue on this page,
//     because no reviewed / unread / triaged flag is persisted anywhere in this
//     codebase and inventing one would mean writing a field onto the record
//     that also drives the public /welcoming.
//  5. **Every "Needs you" row carries the action that resolves it.** A row that
//     states a problem and offers nowhere to go is a nag, not a task.
//
// ON COLOUR. The moss `--accent` is this site's INTERACTIVE tone — links,
// hover, the open rail chip. Attention is a separate semantic role and speaks
// with `--tan`, the palette's warm horizon tone, the same token `.admin-danger`
// and `.admin-field-required` already use. Under the live `sky` theme both are
// recomputed every hour, which is exactly why neither may ever be a literal.
//
// ON NAVIGATION. Every link here is a plain `<Link>` rather than the shell's
// `go()`. `go()` exists to merge a partial patch into the current query string
// and to run the unsaved-changes guard; neither applies on this page. The hrefs
// the registry and useAdminData produce are complete (`/admin?view=blogging`),
// so react-router replaces the whole search string and can leave nothing stale
// behind, and the Front Desk registers no dirty state, so there is nothing to
// guard. The one exception is the "open any collection" form at the foot, which
// has no href to hand and so uses `go()` with the rail's explicit nulls.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '../components/Skeleton.jsx';
import { relativeTime } from '../lib/time.js';
import { DASHBOARD_SURFACE, SURFACE_GROUPS, allSurfaces } from './surfaces.js';
import { LATEST_CAPTION, LATEST_LIMIT, NEEDS_YOU_EMPTY, useAdminData } from './useAdminData.js';
import { useAdminShell } from './useAdminShell.jsx';
import './frontDesk.css';

/**
 * The grid's groups, computed once at import. `allSurfaces()` is memoized and
 * frozen and `SURFACE_GROUPS` is a constant, so this can never vary between
 * renders — and computing it here rather than in a `useMemo` keeps the render
 * body about what is on screen.
 *
 * A `requiresRkey` surface is skipped for the same reason the rail skips it:
 * the resume tailor is meaningless without `&r=`, so a grid tile for it would
 * be a link to nowhere. The Resume studio is what hands out those links.
 */
const GRID_GROUPS = SURFACE_GROUPS.map((group) => ({
  key: group.key,
  heading: group.heading,
  note: group.note,
  items: allSurfaces().filter((surf) => surf.group === group.key && !surf.requiresRkey),
})).filter((group) => group.items.length > 0);

/**
 * How many surfaces the Surfaces sheet lists, so the phone's one door to
 * everything else can name its own size rather than carry a number someone has
 * to remember to update.
 *
 * The sheet draws the Front desk row plus every grouped surface, and it admits
 * a `requiresRkey` surface only while that surface is the one you are on —
 * which, on the dashboard, is never. So the sheet's tally from here is exactly
 * the grid's, plus the dashboard itself.
 */
const SHEET_SURFACE_COUNT = GRID_GROUPS.reduce((n, g) => n + g.items.length, 0) + 1;

/**
 * The verb that closes each "Needs you" row — the action that resolves it.
 *
 * Keyed on the item id here rather than baked into useAdminData because the
 * split is deliberate: the derivation owns the FACT ("3 drafts"), this file
 * owns what you are meant to do about it. The fallback is the point of the
 * lookup — an item added to the derivation later still renders a working row
 * instead of an empty affordance.
 */
const RESOLVE = {
  drafts: 'Finish or publish',
  'legacy-blogs': 'Run the migration',
  'resume-featured': 'Pick one version',
  'pages-unknown': 'Review the records',
  'publications-no-url': 'Add the missing URLs',
};

const RESOLVE_FALLBACK = 'Open';

/**
 * "Needs you" while its first request is in the air.
 *
 * It carries the section's own left rule and row geometry rather than three
 * flat bars, because a placeholder that is a different SHAPE from what replaces
 * it reads as a different section for as long as it is up — and because this
 * column and "Latest records" beside it share a grid row, so a placeholder that
 * is much shorter than its content lets the taller column decide where the
 * whole band ends.
 */
function NeedsSkeleton({ rows = 3 }) {
  return (
    <ul className="fd-needs fd-needs-skel" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li className="fd-need" key={i}>
          <span className="fd-need-link">
            <Skeleton width={i % 2 ? '55%' : '70%'} height="1em" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Latest records" while its first request is in the air — LATEST_LIMIT rows in
 * the real row's markup, not six flat bars.
 *
 * This is the fix for the worst thing this page did: the placeholder stood
 * 228.5px tall where the settled list stands 451px, so the surface grid below —
 * the part of the dashboard that is deliberately clickable before any request
 * resolves — jumped 225px DOWNWARD out from under the cursor when the counts
 * landed, one layout shift of 0.0556. Reusing the row's own markup is what
 * makes the reservation right rather than hand-tuned: the row is a fixed
 * four-track grid one line high (see frontDesk.css), so a placeholder row and a
 * real row are the same height by construction at every width.
 */
function LatestSkeleton() {
  return (
    <ul className="admin-record-list fd-latest-skel" aria-hidden="true">
      {Array.from({ length: LATEST_LIMIT }, (_, i) => (
        <li className="admin-record-row" key={i}>
          <span className="admin-record-link">
            <span className="admin-record-rkey">
              <Skeleton width="9ch" height="0.9em" />
            </span>
            <span className="admin-record-main">
              <Skeleton width={i % 2 ? '58%' : '78%'} height="1em" />
            </span>
            <span className="fd-row-surface">
              <Skeleton width="6ch" height="0.8em" />
            </span>
            <span className="admin-record-time">
              <Skeleton width="5ch" height="0.8em" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A number that is either exact or a floor. `complete: false` means a full page
 * of 100 came back and there may be more, so the only honest rendering is
 * `100+` — never a bare 100, which would read as "and that is all of them".
 */
function countText(value, complete) {
  if (value == null) return null;
  return complete ? String(value) : `${value}+`;
}

/**
 * The failure marker. A per-collection fetch failure costs exactly one number;
 * the rest of the dashboard is unaffected, so this is a small glyph with the
 * message on hover rather than an error state for the whole page.
 */
function Warn({ message }) {
  return (
    <span className="fd-warn" title={message} role="img" aria-label={`Count unavailable: ${message}`}>
      ⚠
    </span>
  );
}

/**
 * One of the four status tiles. The body is passed as children because the
 * guestbook tile is genuinely a different shape — two numbers from two
 * third-party hosts, either of which may be missing — and branching inside one
 * component would be harder to read than handing it its own body.
 *
 * `attention` draws a rust rule rather than a badge, and draws it as a thick
 * LEFT edge: see the note on `.fd-tile[data-attention]` in frontDesk.css for
 * why hue alone stopped being enough to separate "needs you" from "is
 * interactive" under the live sky palette.
 */
function CountTile({ label, note = null, attention = false, children }) {
  return (
    <li className="fd-tile" data-attention={attention ? '' : undefined}>
      <span className="fd-tile-label">{label}</span>
      {children}
      {note && <span className="fd-tile-notes">{note}</span>}
    </li>
  );
}

/**
 * The placeholder a number lands in. `Skeleton` writes `width` and `height` as
 * INLINE styles, so a class cannot size it — but `ch` resolves against the
 * element's OWN font, so `.fd-tile-skel` lends it the value's type and `3ch`
 * becomes three of the digits it stands in for rather than three of the body
 * text's. Before this the bar was 24 × 36px where the number is ~65 × 38, so
 * every tile changed shape as its request settled.
 */
function ValueSkeleton() {
  return <Skeleton className="fd-tile-skel" width="3ch" height="var(--fd-value-size)" />;
}

/** The numeric body of a status tile: skeleton, then ⚠ or the number. */
function TileValue({ tile }) {
  if (tile.loading) return <ValueSkeleton />;
  if (tile.error) return <Warn message={tile.error} />;
  const text = countText(tile.value, tile.complete);
  if (text == null) return <span className="fd-tile-flat">unavailable</span>;
  return <span className="fd-tile-value">{text}</span>;
}

/**
 * The three repo-derived counts, described once for both renderings of the row.
 *
 * `short` is the scanline's label. At 390 the scanline is one wrapping line box
 * about 358px wide, and "DOCUMENTS PUBLISHED" would spend a third of it saying
 * what "PUBLISHED" says beside a number; the long form and the caption both
 * survive as the item's `title`. The guestbook is deliberately not in this
 * array — it is two numbers from two third-party hosts and has its own body in
 * both renderings, exactly as it did before.
 */
function countItems({ documentsPublished, drafts, hiddenElsewhere }) {
  return [
    {
      id: 'published',
      label: 'Documents published',
      short: 'published',
      note: 'blog and portfolio, excluding drafts',
      tile: documentsPublished,
      // The attention rule, stated once: a tile is marked when its number has a
      // task attached — which today means exactly the tiles a "Needs you" item
      // is derived from — or when its request failed.
      attention: !!documentsPublished.error,
    },
    {
      id: 'drafts',
      label: 'Drafts',
      short: 'drafts',
      note: 'written but not published',
      tile: drafts,
      attention: (drafts.value ?? 0) > 0 || !!drafts.error,
    },
    {
      // Named for the job, not the mechanism. "Hidden elsewhere" described the
      // derivation — everything with a visibility model EXCEPT documents, whose
      // visibility model IS the draft predicate and would otherwise report the
      // same records twice under two headings. What the owner needs from the
      // label is which records are not on the site.
      id: 'hidden',
      label: 'Hidden from the site',
      short: 'hidden',
      note: 'galleries, phrases and resumes',
      tile: hiddenElsewhere,
      // Deliberately never marked: a resume kept private and an are.na channel
      // switched off are curatorial decisions rather than a backlog, and a rule
      // that lights every non-zero number stops carrying information.
      attention: !!hiddenElsewhere.error,
    },
  ];
}

/**
 * The guestbook's caption, in every state. It is the one tile of four whose
 * number comes from off-repo, so it is the one that can settle into prose — and
 * a tile that loses its caption when it does is a tile that changes shape twice
 * on one page load and then sits with 63.5px of nothing under one grey
 * sentence. Same three-part shape as its siblings, number or no number.
 */
function guestbookNote(guestbook) {
  if (!guestbook.available && !guestbook.loading) {
    return <span>signatures are indexed by Constellation</span>;
  }
  return (
    <>
      <span title="Counted as backlinks on Constellation. Some backlinks never hydrate into a readable signature, so this is a ceiling on what you can act on.">
        signatures indexed
      </span>
      {guestbook.hiddenList != null && (
        <span title="Exact as a list length. A hidden record whose signer has since deleted it leaves its at-uri on the list, so this can run ahead of the number of signatures actually hidden today.">
          {guestbook.hiddenList} on the hidden list
        </span>
      )}
    </>
  );
}

/**
 * The counts as ONE LINE BOX, which is what the row becomes below 60rem.
 *
 * Four tiles at 174 × 122 in an auto-fill grid was the wrong shape twice over
 * on a phone: the grid minted empty tracks for a fixed set of four items (up to
 * 285px of dead track at 960, and at 430–500 three tracks for four items, so
 * Guestbook dropped alone onto a second row), and a tile whose label wrapped
 * pushed its number 19.2px off the baseline its siblings sat on. A wrapping
 * line box has neither failure mode: no tracks to leave empty, and one baseline
 * per line whatever wraps.
 *
 * Separated by space rather than by the `·` the design draws, deliberately: a
 * glyph separator between wrapping items either orphans onto the head of the
 * next line or hangs off the end of the previous one, and neither is worth the
 * texture.
 */
function CountsScanline({ items, guestbook }) {
  return (
    <ul className="fd-scan" aria-label="Status">
      {items.map((item) => (
        <li className="fd-scan-item" key={item.id} title={`${item.label} — ${item.note}`}>
          {item.tile.loading ? (
            <Skeleton className="fd-scan-skel" width="2ch" height="var(--fd-value-size)" />
          ) : item.tile.error ? (
            <Warn message={item.tile.error} />
          ) : (
            <span className="fd-scan-value">{countText(item.tile.value, item.tile.complete)}</span>
          )}
          <span className="fd-scan-label">{item.short}</span>
        </li>
      ))}
      <li
        className="fd-scan-item"
        title={
          guestbook.available
            ? 'Counted as backlinks on Constellation. Some backlinks never hydrate into a readable signature, so this is a ceiling on what you can act on.'
            : 'The guestbook index (Constellation) did not answer. Signatures live on other people’s repos, so this number is the one thing on this page that is not read from your own.'
        }
      >
        {guestbook.loading ? (
          <Skeleton className="fd-scan-skel" width="2ch" height="var(--fd-value-size)" />
        ) : (
          // Never a 0. Neither number reaching us means we do not know, and a
          // zero would be a claim about a guestbook we could not read.
          <span className="fd-scan-value">{guestbook.signatures ?? '—'}</span>
        )}
        <span className="fd-scan-label">signatures</span>
      </li>
    </ul>
  );
}

/**
 * The count drawn on one surface tile.
 *
 * `countFor` answers per NSID, but a surface is not always a whole collection:
 * Blogging and Creating split ONE collection client-side on `value.site`, so
 * handing both of them the raw document count would print the same wrong number
 * twice. Applying the surface's own `recordFilter` — the same predicate the
 * list column applies after fetching — is what makes this tile agree with the
 * list you land on when you click it.
 *
 * `complete` still governs the `+`: a filtered slice of a full page is a floor
 * as well.
 *
 * @returns {{value:number, complete:boolean}|{error:string}|null} null ⇒ still in flight.
 */
function surfaceCount(surf, entry) {
  if (!entry) return null;
  if (entry.error) return { error: entry.error };
  const value = surf.recordFilter
    ? entry.records.filter((rec) => surf.recordFilter(rec.value)).length
    : entry.count;
  return { value, complete: entry.complete };
}

/**
 * One grid tile. Uncountable surfaces — the three large collections, the
 * off-repo guestbook, and the migration tool that owns no collection — get a
 * way in and no number, deliberately.
 *
 * A surface whose own number is zero renders dimmed with "no records yet",
 * matching the rail. An absent collection and an empty one are indistinguishable
 * at the API — `listRecords` answers 200 `{"records":[]}` either way — and they
 * are indistinguishable to the owner too, so one presentation serves both. It is
 * dimmed and never disabled, because either way you may want to write the first
 * record.
 */
function SurfaceTile({ surf, entry }) {
  const count = surf.countable ? surfaceCount(surf, entry) : null;
  const absent = count?.value === 0;

  // ONE trailing slot, one voice. It used to hold either a mono number or a
  // small-caps serif "Open →" or a small-caps "no records yet" — a fact and an
  // action in the same position, in two families, two sizes and two colours, so
  // sibling tiles in one row read as differently interactive when they are not:
  // the whole tile is the link in every case. Now every tile ends in the same
  // mono slot, and what it cannot count it says with an em dash rather than
  // with a verb the tile has already earned.
  let mark;
  if (!surf.countable) {
    mark = (
      <span
        className="fd-surface-mark"
        title="Thousands of records — counting this collection would take hundreds of requests, so it is not counted."
      >
        —
      </span>
    );
  } else if (!count) {
    mark = <Skeleton className="fd-surface-skel" height="0.8em" width="2.5ch" />;
  } else if (count.error) {
    mark = <Warn message={count.error} />;
  } else {
    mark = (
      <span
        className="fd-surface-mark"
        title={absent ? 'No records in this collection yet.' : undefined}
      >
        {countText(count.value, count.complete)}
      </span>
    );
  }

  return (
    <li className="fd-surface" data-absent={absent ? '' : undefined}>
      <Link className="fd-surface-link" to={surf.href}>
        <span className="fd-surface-head">
          <span className="fd-surface-label">{surf.label}</span>
          {mark}
        </span>
        {surf.blurb && <span className="fd-surface-blurb">{surf.blurb}</span>}
      </Link>
    </li>
  );
}

/**
 * One "Needs you" row. The rust left rule is uniform across work items and
 * consistency checks: everything in this section is present precisely because
 * it is not zero, so ranking them against each other would be inventing a
 * severity the data does not carry. The sub-heading is what separates "things
 * to do" from "things that should always read zero".
 */
function NeedsRow({ item }) {
  return (
    <li className="fd-need">
      <Link className="fd-need-link" to={item.href}>
        <span className="fd-need-label">{item.label}</span>
        <span className="fd-need-action">{RESOLVE[item.id] || RESOLVE_FALLBACK} →</span>
      </Link>
      {item.rows && item.rows.length > 0 && (
        <ul className="fd-need-rows">
          {item.rows.map((row) => (
            <li className="fd-need-row" key={row.key}>
              <Link className="admin-link-subtle" to={row.href}>
                {row.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * The escape hatch: browse a collection the registry has never heard of. The
 * rail offers the same thing through `window.prompt` because it is 3.25rem wide
 * and has nowhere to put a form; the Front Desk has the room, so it gets the
 * proper input.
 *
 * `go()` rather than a `<Link>`, because the NSID is not known until submit —
 * and with the rail's explicit nulls, since `go` is merge-only and a stale `r`
 * or `mode` would otherwise ride along into a collection it does not belong to.
 */
function OpenAnyCollection({ go }) {
  const [nsid, setNsid] = useState('');
  const trimmed = nsid.trim();
  return (
    <form
      className="fd-any"
      onSubmit={(event) => {
        event.preventDefault();
        if (!trimmed) return;
        go({ view: null, c: trimmed, r: null, mode: null, for: null });
      }}
    >
      {/* Label ABOVE the field, like `.admin-field-label` on every other
          labelled control in the admin. Beside it, this was the one field in
          the tree whose label was neither above its control nor aligned on its
          first baseline — it sat to the left and 9px down. The input and its
          submit share a row of their own so they also share both edges; before,
          `align-items: center` centred a 29.2px button inside a 37.2px field. */}
      <label className="fd-any-label" htmlFor="fd-any-nsid">
        Open any collection
      </label>
      <span className="fd-any-row">
        <input
          id="fd-any-nsid"
          className="admin-input"
          type="text"
          value={nsid}
          onChange={(event) => setNsid(event.target.value)}
          placeholder="app.bsky.graph.follow"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
        />
        <button type="submit" className="fd-action" disabled={!trimmed}>
          Browse
        </button>
      </span>
    </form>
  );
}

/** The dashboard. No props — everything comes from the shell context. */
export default function FrontDesk() {
  const { agent, did, dataRev, invalidate, go, stacked, sheet, setSheet, registerBar } =
    useAdminShell();
  // `onInvalidate` is the shell's own invalidate, so the refresh button reaches
  // the rail's dimming as well as these numbers rather than only this subtree.
  const { countFor, tiles, needsYou, latest, refresh, loading } = useAdminData({
    agent,
    did,
    dataRev,
    onInvalidate: invalidate,
  });

  const { guestbook } = tiles;
  const counts = countItems(tiles);

  // Counting is automatic on mount behind a 60-second in-memory cache, so
  // Refresh is the only way to re-read a number that has gone stale under you
  // without reloading the page — and on a phone it belongs in the bar, where
  // every control the owner uses more than twice in a sitting lives.
  //
  // Registered from an effect at EVERY width, per the bar's contract: the bar
  // is only rendered below 60rem, so branching on `stacked` here would be one
  // more place for this file's idea of the breakpoint to drift from the
  // shell's. `busy` is what gives the action its 'Counting…' state, aria-busy
  // and disabled — the same contract Save publishes.
  useEffect(() => {
    registerBar({
      actions: [
        {
          id: 'refresh',
          // `Refresh`, not the head button's `Refresh counts` — §2.1's bar table
          // says `↻ Refresh`, and it is right: the glyph and the word are the
          // whole message on a 320px row, where "counts" cost 60px and pushed
          // slot 1's label into an ellipsis. The head button keeps the longer
          // label, because up there it is the only thing naming what it acts on.
          label: 'Refresh',
          // The bar's other actions all carry a glyph; this one had none, so it
          // was the only unglyphed control on the bar.
          icon: 'RefreshCw',
          busy: loading,
          busyLabel: 'Refreshing…',
          onPress: () => refresh(),
        },
      ],
    });
    return () => registerBar(null);
  }, [registerBar, refresh, loading]);

  return (
    <div className="fd">
      <header className="wb-pane-head fd-head">
        <h1 className="wb-pane-title">{DASHBOARD_SURFACE.label}</h1>
        {/* The blurb explains the page to a first-time reader. On a phone the
            owner has read it, and it costs 44px above the first thing they came
            for. */}
        {!stacked && <p className="wb-pane-blurb">{DASHBOARD_SURFACE.blurb}</p>}
        {/* Arrow-wrapped on purpose: `refresh(scope)` would otherwise be handed
            the click event as its scope and invalidate nothing. `aria-busy` so
            the state is announced and not only painted. */}
        {!stacked && (
          <button
            type="button"
            className="fd-action"
            onClick={() => refresh()}
            disabled={loading}
            aria-busy={loading ? 'true' : undefined}
          >
            {loading ? 'Counting…' : 'Refresh counts'}
          </button>
        )}
      </header>

      {stacked ? (
        <CountsScanline items={counts} guestbook={guestbook} />
      ) : (
        <ul className="fd-counts" aria-label="Status">
          {counts.map((item) => (
            <CountTile
              key={item.id}
              label={item.label}
              note={<span>{item.note}</span>}
              attention={item.attention}
            >
              <TileValue tile={item.tile} />
            </CountTile>
          ))}

          {/* Two numbers, two requests — a Constellation backlink count and one
              read of the book record. NOT `fetchGuestbookEntries`, which is a
              ~23-request walk across three third-party hosts. Both numbers are
              labelled as the thing they exactly are: a backlink count is a
              ceiling on the signatures you can act on (some never hydrate), and
              the hidden array is exact as a LIST LENGTH but not as a count of
              hidden signatures, because a hidden record whose signer has since
              deleted it leaves its at-uri behind. */}
          <CountTile label="Guestbook" note={guestbookNote(guestbook)}>
            {guestbook.loading ? (
              <ValueSkeleton />
            ) : !guestbook.available ? (
              // Never a 0. Neither number reaching us means we do not know, and
              // a zero would be a claim about a guestbook we could not read.
              // The label above already says "Guestbook", so this does not.
              <span className="fd-tile-flat">Index unavailable</span>
            ) : guestbook.signatures == null ? (
              <span
                className="fd-tile-value"
                title="Constellation did not answer. The hidden-list count below came from the book record and is unaffected."
              >
                —
              </span>
            ) : (
              <span className="fd-tile-value">{guestbook.signatures}</span>
            )}
          </CountTile>
        </ul>
      )}

      <div className="fd-columns">
        <section className="fd-panel" aria-labelledby="fd-needs-heading">
          <div className="admin-collection-group-head">
            {/* `.fd-section-heading`, not the frozen `.admin-collection-group-heading
                small-caps` pairing this used to carry: `.small-caps` sets
                0.05em and is emitted later, so it won the cascade and the six
                section heads on this page were the only labels on screen off
                the house 0.18em — with the sub-head nested under this one
                carrying 3.6× its parent's tracking. */}
            <h2 id="fd-needs-heading" className="fd-section-heading">
              Needs you
            </h2>
            {/* "Derived from the counts above" was true only at one width:
                stacked, the counts follow this section rather than precede it.
                The claim that matters — that nothing here costs a request — does
                not need a direction to be true. */}
            <p className="admin-collection-group-note">
              Derived from the counts this page already has, so nothing here costs a request. Every
              row links to where you resolve it.
            </p>
          </div>

          <div className="fd-panel-body">
            {needsYou.loading ? (
              <NeedsSkeleton />
            ) : needsYou.empty ? (
              <p className="fd-empty">{NEEDS_YOU_EMPTY}</p>
            ) : (
              <>
                {needsYou.work.length > 0 && (
                  <ul className="fd-needs">
                    {needsYou.work.map((item) => (
                      <NeedsRow key={item.id} item={item} />
                    ))}
                  </ul>
                )}
                {/* Under its own sub-heading so that a check which is empty for
                    years does not read as a broken feature when it finally
                    fires. All three should always be zero. */}
                {needsYou.checks.length > 0 && (
                  <>
                    <h3 className="fd-subhead">Consistency checks</h3>
                    <ul className="fd-needs">
                      {needsYou.checks.map((item) => (
                        <NeedsRow key={item.id} item={item} />
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </section>

        <section className="fd-panel" aria-labelledby="fd-latest-heading">
          <div className="admin-collection-group-head">
            <h2 id="fd-latest-heading" className="fd-section-heading">
              Latest records
            </h2>
            {/* Verbatim from useAdminData, where it is a constant, because it
                explains a real limitation rather than decorating the section:
                site.standard.document carries no edit timestamp at all, so
                editing a 2024 post today does not move it up this list. */}
            <p className="admin-collection-group-note">{LATEST_CAPTION}</p>
          </div>

          <div className="fd-panel-body">
            {latest.length === 0 ? (
              loading ? (
                <LatestSkeleton />
              ) : (
                <p className="fd-empty">No dated records in these collections yet.</p>
              )
            ) : (
              <ul className="admin-record-list">
                {latest.map((row) => (
                  <li className="admin-record-row" key={row.key}>
                    <Link className="admin-record-link" to={row.href}>
                      {/* A <span>, not a <code>: the global `code` rule would
                          put real monospace on a `--rule-soft` chip, and this
                          row wants the list column's plain mono rkey. */}
                      <span className="admin-record-rkey">{row.rkey}</span>
                      <span className="admin-record-main">
                        <span className="admin-record-preview">{row.label}</span>
                      </span>
                      {/* A DIRECT child of the link, not of `.admin-record-main`:
                          that box is `flex-wrap: wrap`, so this span floated
                          immediately after a title of variable length (measured:
                          a 358px spread across eight rows) and dropped onto a
                          line of its own whenever the title was long. It is a
                          grid track now. */}
                      <span className="fd-row-surface">{row.surfaceLabel}</span>
                      <time className="admin-record-time" dateTime={row.instant}>
                        {relativeTime(row.instant)}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Static, and last in the DOM but first in importance: this is the way
          in to everything, and it is clickable before any request resolves.
          NOT RENDERED on a phone — 758px of tiles the Surfaces sheet draws
          better and reaches from every screen, replaced by the one row below.
          Unrendered rather than hidden: eighteen tiles that read counts and a
          form that holds state are not free to keep mounted off-screen. */}
      {!stacked ? (
        <div className="fd-surfaces">
          {GRID_GROUPS.map((group) => (
            <section className="fd-group" key={group.key} aria-labelledby={`fd-group-${group.key}`}>
              <div className="admin-collection-group-head">
                <h2 id={`fd-group-${group.key}`} className="fd-section-heading">
                  {group.heading}
                </h2>
                <p className="admin-collection-group-note">{group.note}</p>
              </div>
              <ul className="fd-tiles">
                {group.items.map((surf) => (
                  <SurfaceTile key={surf.key} surf={surf} entry={countFor(surf)} />
                ))}
              </ul>
            </section>
          ))}
          <OpenAnyCollection go={go} />
        </div>
      ) : (
        // The phone's one door to everything else, and the same door the bar's
        // left slot opens — the sheet is the directory, so this is a shortcut to
        // it rather than a second, smaller copy of it.
        <button
          type="button"
          className="fd-all"
          aria-expanded={sheet === 'surfaces'}
          aria-controls="wb-surfaces-sheet"
          onClick={() => setSheet(sheet === 'surfaces' ? null : 'surfaces')}
        >
          <span className="fd-all-label">All {SHEET_SURFACE_COUNT} surfaces</span>
          <span className="fd-all-mark" aria-hidden="true">
            →
          </span>
        </button>
      )}
    </div>
  );
}
