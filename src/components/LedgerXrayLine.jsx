import { atUriParts, shortenCid } from '../lib/xray.js';

/**
 * The x-ray manifest line for any ledger row: `at://…/<nsid>/<rkey>` (the
 * collection highlighted inside the address) on the left, the short content
 * hash on the right — absolutely overlaid on the row's own grid so it stays a
 * single aligned line. Hidden until the data-xray root attribute is set (see
 * Xray.css). Shared by the home feed (FeedLedgerRow), the single-type pages
 * (FlatLedger), and the bespoke ledger rows (mothing).
 */
export default function LedgerXrayLine({ atUri, cid }) {
  const parts = atUriParts(atUri);
  if (!parts) return null;
  return (
    <div className="ledger-xray" aria-hidden="true">
      <span className="bp-uri ledger-xray-uri">
        <span className="did">{parts.prefix}</span>
        <span className="nsid">{parts.nsid}</span>
        <span className="rkey">{parts.rkey}</span>
      </span>
      {cid && <span className="ledger-xray-cid">{shortenCid(cid)}</span>}
    </div>
  );
}
