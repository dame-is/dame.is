import { Link } from 'react-router-dom';
import { useXray } from '../hooks/useXray.jsx';
import LedgerXrayLine from './LedgerXrayLine.jsx';
import { XraySubstratePanel } from './XraySubstrate.jsx';

/**
 * A flat, day-group-less ledger table for single-type feed pages (blogging,
 * creating, curating, mothing, …). Reuses the home feed's ledger type + rules
 * (the `.feed-ledger` / `.ledger-*` styles in Feed.css) but drops the
 * redundant verb column — every row on these pages is the same kind — and
 * reads as one continuous compact table of "title · meta".
 *
 * Each row is `{ key, href, title, kind?, secondary?, time?, external?, nsid?, atUri?, cid? }`:
 *   - href       destination for the whole row (title + right cell both link)
 *   - kind       optional small-caps tag ahead of the title (e.g. a category)
 *   - secondary  optional muted suffix after the title (e.g. a scientific name)
 *   - time       optional right-column string (a relative time, a count, …)
 *   - external   render an external <a target=_blank> instead of a router Link
 *   - nsid       optional collection, stamped as data-nsid so the chrome strip
 *                can read the record type at the top of the scroll
 *   - atUri/cid  the backing record — when present, the row joins x-ray: it
 *                reveals its manifest line, locks the reticule, and a tap
 *                inspects it (instead of navigating).
 */
export default function FlatLedger({ rows }) {
  // When any row carries a category, give it its own fixed left column — the
  // way the home feed ledger columns its gerund — so every title lines up.
  const kinded = rows.some((row) => row.kind);
  const xray = useXray();
  return (
    <ol
      className={`feed-list feed-ledger feed-ledger-flat${kinded ? ' feed-ledger-flat-kinded' : ''} reveal-stagger`}
    >
      {rows.map((row, i) => {
        const inspectable = xray.active && !!row.atUri;
        const focused = inspectable && xray.focusUri === row.atUri;
        return (
          <li
            key={row.key || i}
            className={`feed-item feed-item-ledger${focused ? ' is-xray-focus' : ''}`}
            data-nsid={row.nsid || undefined}
            data-atproto={row.atUri ? '' : undefined}
            data-at-uri={row.atUri || undefined}
            data-cid={row.cid || undefined}
            onClickCapture={
              inspectable
                ? (e) => {
                    // In x-ray a tap inspects the record instead of navigating —
                    // but let clicks inside the open substrate panel (its explorer
                    // links) through.
                    if (e.target.closest('.xray-substrate')) return;
                    e.preventDefault();
                    e.stopPropagation();
                    xray.toggleFocus(row.atUri);
                  }
                : undefined
            }
          >
            {kinded &&
              (row.kind ? (
                <span className="ledger-verb ledger-kind-col">{row.kind}</span>
              ) : (
                <span className="ledger-verb" aria-hidden="true" />
              ))}
            <div className="ledger-body">
              <p className="ledger-text">
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
            {row.atUri && <LedgerXrayLine atUri={row.atUri} cid={row.cid} />}
            {focused && <XraySubstratePanel atUri={row.atUri} cid={row.cid} />}
          </li>
        );
      })}
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
