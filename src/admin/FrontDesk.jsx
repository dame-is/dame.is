// The Front Desk — what `/admin` is when nothing is open.
//
// Four bands, in this order: the counts row, "Needs you" beside "Latest
// records", and the surface grid. The grid is last on the page and first in
// importance, because it is STATIC: it needs no data, it is clickable before a
// single request has resolved, and nothing on this page may ever block it on a
// fetch. Every number here arrives afterwards and lands in place of its own
// skeleton. The whole dashboard is navigable with zero successful requests.
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

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from '../components/Skeleton.jsx';
import { relativeTime } from '../lib/time.js';
import { DASHBOARD_SURFACE, SURFACE_GROUPS, allSurfaces } from './surfaces.js';
import { LATEST_CAPTION, NEEDS_YOU_EMPTY, useAdminData } from './useAdminData.js';
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
  'publications-no-url': 'Add the missing urls',
};

const RESOLVE_FALLBACK = 'Open';

/** Rows of placeholder while a section's first request is still in the air. */
function SkeletonRows({ rows, width = '70%' }) {
  return (
    <div className="fd-skel" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} width={i % 2 ? '55%' : width} height="0.9em" />
      ))}
    </div>
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
 * `attention` draws a doubled rust rule rather than a badge. It is drawn with
 * an inset box-shadow on top of the 1px border so the tile thickens without
 * reflowing its neighbours.
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
 * The placeholder a number lands in. `Skeleton` writes `height` as an INLINE
 * style, so a class cannot size it — hence the shared `--fd-value-size` token,
 * which the stylesheet steps down at the stacked breakpoint alongside the real
 * number. Sizing it to the digits it replaces is what keeps the counts row from
 * jumping as the four requests settle.
 */
function ValueSkeleton() {
  return <Skeleton width="3ch" height="var(--fd-value-size)" />;
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

  let mark;
  if (!surf.countable) mark = <span className="fd-surface-open">Open →</span>;
  else if (!count) mark = <Skeleton className="fd-surface-skel" height="0.8em" width="2.5ch" />;
  else if (count.error) mark = <Warn message={count.error} />;
  else if (absent) mark = <span className="fd-surface-none">no records yet</span>;
  else mark = <span className="fd-surface-count">{countText(count.value, count.complete)}</span>;

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
      <label className="fd-any-label" htmlFor="fd-any-nsid">
        Open any collection
      </label>
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
    </form>
  );
}

/** The dashboard. No props — everything comes from the shell context. */
export default function FrontDesk() {
  const { agent, did, dataRev, invalidate, go } = useAdminShell();
  // `onInvalidate` is the shell's own invalidate, so the refresh button reaches
  // the rail's dimming as well as these numbers rather than only this subtree.
  const { countFor, tiles, needsYou, latest, refresh, loading } = useAdminData({
    agent,
    did,
    dataRev,
    onInvalidate: invalidate,
  });

  const { documentsPublished, drafts, hiddenElsewhere, guestbook } = tiles;

  // The attention rule, stated once: a tile is marked when its number has a
  // task attached — which today means exactly the tiles a "Needs you" item is
  // derived from — or when its request failed. Hidden-elsewhere is deliberately
  // NOT marked: a resume kept private and an are.na channel switched off are
  // curatorial decisions rather than a backlog, and a rule that lights every
  // non-zero number stops carrying information.
  const draftsNeedYou = (drafts.value ?? 0) > 0;

  return (
    <div className="fd">
      <header className="wb-pane-head fd-head">
        <h1 className="wb-pane-title">{DASHBOARD_SURFACE.label}</h1>
        <p className="wb-pane-blurb">{DASHBOARD_SURFACE.blurb}</p>
        {/* Counting is automatic on mount behind a 60-second in-memory cache,
            so this is the only way to re-read a number that has gone stale
            under you without reloading the page. Arrow-wrapped on purpose:
            `refresh(scope)` would otherwise be handed the click event as its
            scope and invalidate nothing. */}
        <button type="button" className="fd-action" onClick={() => refresh()} disabled={loading}>
          {loading ? 'Counting…' : 'Refresh counts'}
        </button>
      </header>

      <ul className="fd-counts" aria-label="Status">
        <CountTile
          label="Documents published"
          note={<span>blog and portfolio, excluding drafts</span>}
          attention={!!documentsPublished.error}
        >
          <TileValue tile={documentsPublished} />
        </CountTile>

        <CountTile
          label="Drafts"
          note={<span>written but not published</span>}
          attention={draftsNeedYou || !!drafts.error}
        >
          <TileValue tile={drafts} />
        </CountTile>

        {/* "Elsewhere" is load-bearing. `site.standard.document`'s visibility
            model IS the draft predicate, so folding documents in here would
            report the same records twice under two headings whose sum is twice
            the number of affected records. This tile counts the three OTHER
            visibility collections and says so. */}
        <CountTile
          label="Hidden elsewhere"
          note={<span>galleries, phrases, resumes</span>}
          attention={!!hiddenElsewhere.error}
        >
          <TileValue tile={hiddenElsewhere} />
        </CountTile>

        {/* Two numbers, two requests — a Constellation backlink count and one
            read of the book record. NOT `fetchGuestbookEntries`, which is a
            ~23-request walk across three third-party hosts. Both numbers are
            labelled as the thing they exactly are: a backlink count is a
            ceiling on the signatures you can act on (some never hydrate), and
            the hidden array is exact as a LIST LENGTH but not as a count of
            hidden signatures, because a hidden record whose signer has since
            deleted it leaves its at-uri behind. */}
        <CountTile
          label="Guestbook"
          note={
            guestbook.available ? (
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
            ) : null
          }
        >
          {guestbook.loading ? (
            <ValueSkeleton />
          ) : !guestbook.available ? (
            // Never a 0. Neither number reaching us means we do not know, and a
            // zero would be a claim about a guestbook we could not read.
            <span className="fd-tile-flat">Guestbook index unavailable</span>
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

      <div className="fd-columns">
        <section className="fd-panel" aria-labelledby="fd-needs-heading">
          <div className="admin-collection-group-head">
            <h2 id="fd-needs-heading" className="admin-collection-group-heading small-caps">
              Needs you
            </h2>
            <p className="admin-collection-group-note">
              Derived from the counts above, so nothing here costs a request. Every row links to
              where you resolve it.
            </p>
          </div>

          {needsYou.loading ? (
            <SkeletonRows rows={3} />
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
        </section>

        <section className="fd-panel" aria-labelledby="fd-latest-heading">
          <div className="admin-collection-group-head">
            <h2 id="fd-latest-heading" className="admin-collection-group-heading small-caps">
              Latest records
            </h2>
            {/* Verbatim from useAdminData, where it is a constant, because it
                explains a real limitation rather than decorating the section:
                site.standard.document carries no edit timestamp at all, so
                editing a 2024 post today does not move it up this list. */}
            <p className="admin-collection-group-note">{LATEST_CAPTION}</p>
          </div>

          {latest.length === 0 ? (
            loading ? (
              <SkeletonRows rows={6} width="80%" />
            ) : (
              <p className="fd-empty">No dated records in these collections yet.</p>
            )
          ) : (
            <ul className="admin-record-list">
              {latest.map((row) => (
                <li className="admin-record-row" key={row.key}>
                  <Link className="admin-record-link" to={row.href}>
                    {/* A <span>, not a <code>: `.admin-record-rkey` is
                        deliberately `--mono-ui` (the serif voice) at a fixed
                        14ch, and the global `code` rule would override both
                        with real monospace on a `--rule-soft` chip. */}
                    <span className="admin-record-rkey">{row.rkey}</span>
                    <span className="admin-record-main">
                      <span className="admin-record-preview">{row.label}</span>
                      <span className="fd-row-surface">{row.surfaceLabel}</span>
                    </span>
                    <time className="admin-record-time" dateTime={row.instant}>
                      {relativeTime(row.instant)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Static, and last in the DOM but first in importance: this is the way
          in to everything, and it is clickable before any request resolves. */}
      <div className="fd-surfaces">
        {GRID_GROUPS.map((group) => (
          <section className="fd-group" key={group.key} aria-labelledby={`fd-group-${group.key}`}>
            <div className="admin-collection-group-head">
              <h2 id={`fd-group-${group.key}`} className="admin-collection-group-heading small-caps">
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
    </div>
  );
}
