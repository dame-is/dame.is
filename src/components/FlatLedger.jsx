import { Link } from 'react-router-dom';

/**
 * A flat, day-group-less ledger table for single-type feed pages (blogging,
 * creating, …). Reuses the home feed's ledger type + rules (the `.feed-ledger`
 * / `.ledger-*` styles in Feed.css) but drops the redundant verb column —
 * every row on these pages is the same kind — and reads as one continuous
 * compact table of "title · when" instead of the day-grouped activity ledger.
 *
 * Each row is `{ key, href, title, kind?, time?, nsid? }`:
 *   - href   destination for the whole row (title + time both link to it)
 *   - kind   optional small-caps tag ahead of the title (e.g. a work category)
 *   - time   optional short/relative timestamp, flush right
 *   - nsid   optional collection, stamped as data-nsid so the chrome strip can
 *            read the record type at the top of the scroll (like FeedItem does)
 */
export default function FlatLedger({ rows }) {
  return (
    <ol className="feed-list feed-ledger feed-ledger-flat reveal-stagger">
      {rows.map((row, i) => (
        <li
          key={row.key || i}
          className="feed-item feed-item-ledger"
          data-nsid={row.nsid || undefined}
        >
          <div className="ledger-body">
            <p className="ledger-text">
              {row.kind && <span className="ledger-kind small-caps">{row.kind}</span>}
              <Link to={row.href}>{row.title}</Link>
            </p>
          </div>
          {row.time ? (
            <Link className="ledger-time" to={row.href}>
              {row.time}
            </Link>
          ) : (
            <span className="ledger-time" />
          )}
        </li>
      ))}
    </ol>
  );
}
