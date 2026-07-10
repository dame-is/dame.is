import { Link } from 'react-router-dom';

/**
 * A flat, day-group-less ledger table for single-type feed pages (blogging,
 * creating, curating, mothing, …). Reuses the home feed's ledger type + rules
 * (the `.feed-ledger` / `.ledger-*` styles in Feed.css) but drops the
 * redundant verb column — every row on these pages is the same kind — and
 * reads as one continuous compact table of "title · meta".
 *
 * Each row is `{ key, href, title, kind?, secondary?, time?, external?, nsid? }`:
 *   - href       destination for the whole row (title + right cell both link)
 *   - kind       optional small-caps tag ahead of the title (e.g. a category)
 *   - secondary  optional muted suffix after the title (e.g. a scientific name)
 *   - time       optional right-column string (a relative time, a count, …)
 *   - external   render an external <a target=_blank> instead of a router Link
 *   - nsid       optional collection, stamped as data-nsid so the chrome strip
 *                can read the record type at the top of the scroll
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
              <RowLink row={row}>
                {row.title}
                {row.secondary && <span className="ledger-count"> ({row.secondary})</span>}
              </RowLink>
            </p>
          </div>
          {row.time ? (
            <RowLink row={row} className="ledger-time">
              {row.time}
            </RowLink>
          ) : (
            <span className="ledger-time" />
          )}
        </li>
      ))}
    </ol>
  );
}

/** A row's link — an external <a> (iNaturalist, are.na, …) or a router Link. */
function RowLink({ row, className, children }) {
  if (row.external) {
    return (
      <a className={className} href={row.href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    );
  }
  return (
    <Link className={className} to={row.href}>
      {children}
    </Link>
  );
}
