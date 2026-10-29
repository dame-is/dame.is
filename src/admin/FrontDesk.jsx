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
//    RENDERED below 62rem. They were 758px of the 2161px the dashboard took on
//    a phone — 2.9 screens before anything actionable — and the Surfaces sheet
//    now draws the same directory better and reaches it from any screen in one
//    tap. Their replacement here is one 48px row at the foot.
//  · The counts are the site's Figures band (components/Figures.jsx), which
//    goes two-up on its own under 34rem of width and keeps every numeral on
//    one line whatever its label does. Their notes are left off on a phone.
//  · The pane blurb and `Refresh counts` leave the head — the blurb because it
//    explains the page to a first-time reader and the owner has read it, and
//    Refresh because on a phone it is not worth a control at all: counting is
//    automatic on mount behind a 60-second cache, so leaving the surface and
//    coming back is a refresh.
//
// The counts read ONE array (`countItems` below), so the band at either width
// can never disagree about what a number means.
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
// ON COLOUR AND ATTENTION. This page is set in the site's kit: Figures for the
// counts, SectionHead for the sections, Button for the actions, ledger rows for
// the records. `--accent` is kept for what you can follow (a figure that links
// takes it, as on /logging). Attention is said in words rather than in a rule
// down one edge: "Needs you" only lists what is not zero, and a failed count is
// a ⚠ in --danger.
//
// ON NAVIGATION. Every link here is a plain `<Link>` rather than the shell's
// `go()`. `go()` exists to merge a partial patch into the current query string
// and to run the unsaved-changes guard; neither applies on this page. The hrefs
// the registry and useAdminData produce are complete (`/admin?view=blogging`),
// so react-router replaces the whole search string and can leave nothing stale
// behind, and the Front Desk registers no dirty state, so there is nothing to
// guard. The one exception is the "open any collection" form at the foot, which
// has no href to hand and so uses `go()` with the rail's explicit nulls.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import Button from '../components/Button.jsx';
import Figures from '../components/Figures.jsx';
import SectionHead from '../components/SectionHead.jsx';
import { Skeleton } from '../components/Skeleton.jsx';
import Time from '../components/Time.jsx';
import { DASHBOARD_SURFACE, SURFACE_GROUPS, allSurfaces } from './surfaces.js';
import { LATEST_CAPTION, LATEST_LIMIT, NEEDS_YOU_EMPTY, surfaceCount, useAdminData } from './useAdminData.js';
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
          <span className="fd-need-label">
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
    <ul className="fd-led fd-latest-skel" aria-hidden="true">
      {Array.from({ length: LATEST_LIMIT }, (_, i) => (
        <li className="fd-led-row" key={i}>
          <span className="fd-led-note">
            <Skeleton width="7ch" height="0.8em" />
            <Skeleton width="5ch" height="0.8em" />
          </span>
          <span className="fd-led-title">
            <Skeleton width={i % 2 ? '58%' : '78%'} height="1em" />
          </span>
          <span className="fd-led-rkey">
            <Skeleton width="10ch" height="0.8em" />
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
 * What a figure shows in its numeral's place: a placeholder while its request
 * is in the air, ⚠ when it failed, then the number. The placeholder wears the
 * numeral's own type (`.fd-fig-skel`), so `2ch` is two of the digits it stands
 * in for and the band does not change shape when the number lands.
 */
function figureValue(tile) {
  if (tile.loading) return <Skeleton className="fd-fig-skel" width="2ch" height="1em" />;
  if (tile.error) return <Warn message={tile.error} />;
  return countText(tile.value, tile.complete) ?? '—';
}

/**
 * The three repo-derived counts, described once. The guestbook is deliberately
 * not in this array: it is two numbers from two third-party hosts and has its
 * own value and note (guestbookValue, guestbookNote).
 */
function countItems({ documentsPublished, drafts, hiddenElsewhere }) {
  return [
    {
      id: 'published',
      label: 'Documents published',
      note: 'blog and portfolio, excluding drafts',
      tile: documentsPublished,
    },
    {
      id: 'drafts',
      label: 'Drafts',
      note: 'written but not published',
      tile: drafts,
    },
    {
      // Named for the job, not the mechanism. "Hidden elsewhere" described the
      // derivation — everything with a visibility model EXCEPT documents, whose
      // visibility model IS the draft predicate and would otherwise report the
      // same records twice under two headings. What the owner needs from the
      // label is which records are not on the site.
      id: 'hidden',
      label: 'Hidden from the site',
      note: 'galleries, phrases and resumes',
      tile: hiddenElsewhere,
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
    return <span>the index (Constellation) did not answer</span>;
  }
  return (
    <>
      <span title="Counted as backlinks on Constellation. Some backlinks never hydrate into a readable signature, so this is a ceiling on what you can act on.">
        signatures indexed
      </span>
      {guestbook.hiddenList != null && (
        <>
          {' · '}
          <span title="Exact as a list length. A hidden record whose signer has since deleted it leaves its at-uri on the list, so this can run ahead of the number of signatures actually hidden today.">
            {guestbook.hiddenList} on the hidden list
          </span>
        </>
      )}
    </>
  );
}

/**
 * The guestbook's numeral. Never a 0: neither number reaching us means we do
 * not know, and a zero would be a claim about a guestbook we could not read.
 */
function guestbookValue(guestbook) {
  if (guestbook.loading) return <Skeleton className="fd-fig-skel" width="2ch" height="1em" />;
  if (!guestbook.available || guestbook.signatures == null) return '—';
  return guestbook.signatures;
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

  // The count sits where the rail prints it, in the same quiet figures, and an
  // uncounted surface prints nothing rather than a mark that has to be
  // explained. An empty collection says 0.
  let mark = null;
  if (surf.countable && !count) {
    mark = <Skeleton className="fd-surface-skel" height="0.8em" width="2.5ch" />;
  } else if (count?.error) {
    mark = <Warn message={count.error} />;
  } else if (count) {
    mark = <span className="fd-surface-mark">{countText(count.value, count.complete)}</span>;
  }

  return (
    <li className="fd-surface">
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
 * One "Needs you" row, ruled like a ledger row: the fact, then the action that
 * resolves it as a text Button. Everything in this section is present
 * precisely because it is not zero, so the rows are not ranked against each
 * other; the sub-heading is what separates "things to do" from "things that
 * should always read zero".
 */
function NeedsRow({ item }) {
  return (
    <li className="fd-need">
      <span className="fd-need-label">{item.label}</span>
      <Button as={Link} to={item.href} variant="text" size="sm" className="fd-need-action">
        {RESOLVE[item.id] || RESOLVE_FALLBACK} →
      </Button>
      {item.rows && item.rows.length > 0 && (
        <ul className="fd-need-rows">
          {item.rows.map((row) => (
            <li className="fd-need-row" key={row.key}>
              <Link to={row.href}>{row.label}</Link>
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
      <label className="fd-any-label eyebrow" htmlFor="fd-any-nsid">
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
        <Button type="submit" size="sm" disabled={!trimmed}>
          Browse
        </Button>
      </span>
    </form>
  );
}

/** The dashboard. No props — everything comes from the shell context. */
export default function FrontDesk() {
  const { agent, did, dataRev, invalidate, go, stacked, sheet, setSheet } = useAdminShell();
  // `onInvalidate` is the shell's own invalidate, so the refresh button reaches
  // the rail's counts as well as these numbers rather than only this subtree.
  const { countFor, tiles, needsYou, latest, refresh, loading } = useAdminData({
    agent,
    did,
    dataRev,
    onInvalidate: invalidate,
  });

  const { guestbook } = tiles;
  // Drafts is the one figure with somewhere to go: the drafts it counts are the
  // first thing "Needs you" lists, and that row knows where they live.
  const draftsHref = needsYou.work.find((item) => item.id === 'drafts')?.href || null;
  const figures = [
    ...countItems(tiles).map((item) => ({
      key: item.id,
      label: item.label,
      value: figureValue(item.tile),
      note: stacked ? null : item.note,
      to: item.id === 'drafts' && draftsHref && !item.tile.loading && !item.tile.error ? draftsHref : undefined,
    })),
    {
      // Two numbers, two requests — a Constellation backlink count and one read
      // of the book record. NOT `fetchGuestbookEntries`, which is a ~23-request
      // walk across three third-party hosts. Both are labelled as the thing they
      // exactly are (see guestbookNote).
      key: 'guestbook',
      label: 'Guestbook',
      value: guestbookValue(guestbook),
      note: stacked ? null : guestbookNote(guestbook),
    },
  ];
  const needsTotal = needsYou.loading ? null : needsYou.work.length + needsYou.checks.length;

  // THE FRONT DESK PUBLISHES NO PRIMARY ACTION, and that is a statement about
  // the surface rather than an omission. Refresh used to ride the phone bar's
  // right slot, which paints its control as THE thing the thumb is aiming for —
  // and re-reading four numbers is not what anyone opens the admin to do. It is
  // also nearly redundant on a phone: counting happens automatically on mount
  // behind a 60-second cache, so leaving the surface and coming back is a
  // refresh. The desk keeps the head button, where the longer label names what
  // it acts on.
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
          <Button
            size="sm"
            className="fd-refresh"
            onClick={() => refresh()}
            disabled={loading}
            aria-busy={loading ? 'true' : undefined}
          >
            <RefreshCw size={14} strokeWidth={1.5} aria-hidden="true" />
            {loading ? 'Counting…' : 'Refresh counts'}
          </Button>
        )}
      </header>

      <Figures className="fd-figures" label="Status" items={figures} columns={4} />

      <div className="fd-columns">
        <section className="fd-panel" aria-labelledby="fd-needs-heading">
          <SectionHead
            id="fd-needs-heading"
            title="Needs you"
            meta={
              needsTotal == null ? null : (
                <span title="Derived from the counts this page already has, so nothing here costs a request. Every row links to where you resolve it.">
                  {needsTotal}
                </span>
              )
            }
          />

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
                    <h3 className="fd-subhead eyebrow">Consistency checks</h3>
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
          {/* The caption explains a real limitation rather than decorating the
              section — site.standard.document carries no edit timestamp, so
              editing a 2024 post today does not move it up this list — and it
              rides on the meta as its title, where the owner can ask for it. */}
          <SectionHead
            id="fd-latest-heading"
            title="Latest records"
            meta={<span title={LATEST_CAPTION}>newest first</span>}
          />

          <div className="fd-panel-body">
            {latest.length === 0 ? (
              loading ? (
                <LatestSkeleton />
              ) : (
                <p className="fd-empty">No dated records in these collections yet.</p>
              )
            ) : (
              // Ledger rows, as the home page sets them: the surface and the
              // time as a margin note, the record's title, and its rkey as a
              // quiet folio. The surface goes to its list, the title to the
              // record, as a ledger's verb goes to its section.
              <ul className="fd-led">
                {latest.map((row) => (
                  <li className="fd-led-row" key={row.key}>
                    <span className="fd-led-note">
                      {row.surface ? (
                        <Link className="fd-led-verb" to={row.surface.href}>
                          {row.surfaceLabel.toLowerCase()}
                        </Link>
                      ) : (
                        <span className="fd-led-verb">{row.surfaceLabel}</span>
                      )}
                      <Time className="fd-led-time" value={row.instant} variant="relative" tabular />
                    </span>
                    <Link className="fd-led-title" to={row.href}>
                      {row.label}
                    </Link>
                    <span className="fd-led-rkey ident">{row.rkey}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {/* Static, and last in the DOM but first in importance: this is the way
          in to everything, and it is clickable before any request resolves.
          NOT RENDERED on a phone — the Surfaces sheet draws the same directory
          and reaches it from every screen, replaced by the one row below.
          Unrendered rather than hidden: eighteen tiles that read counts and a
          form that holds state are not free to keep mounted off-screen. */}
      {!stacked ? (
        <div className="fd-surfaces">
          {GRID_GROUPS.map((group) => (
            <section className="fd-group" key={group.key} aria-labelledby={`fd-group-${group.key}`}>
              <SectionHead id={`fd-group-${group.key}`} title={group.heading} meta={group.note} />
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
        <Button
          className="fd-all"
          aria-expanded={sheet === 'surfaces'}
          aria-controls="wb-surfaces-sheet"
          onClick={() => setSheet(sheet === 'surfaces' ? null : 'surfaces')}
        >
          <span className="fd-all-label">All {SHEET_SURFACE_COUNT} surfaces</span>
          <span className="fd-all-mark" aria-hidden="true">
            →
          </span>
        </Button>
      )}
    </div>
  );
}
