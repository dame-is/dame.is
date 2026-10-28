import { useId } from 'react';
import { parseAtUri, shortenCid } from '../lib/xray.js';

/**
 * A ledger row's x-ray marginalia. The row keeps its content (one step
 * quieter) and its two label columns take the protocol: the verb column
 * becomes the collection, broken after its authority so it fits
 * ("app.bsky.feed. / post"), and the time column becomes the address, the
 * rkey over a short CID. Hidden until the data-xray root attribute is set
 * (see Xray.css). Not aria-hidden: under x-ray these cells are the row's
 * description. Shared by the home feed (FeedLedgerRow), the single-type
 * pages (FlatLedger), and the bespoke ledger rows (mothing).
 */
export default function LedgerXrayLine({ atUri, cid, id: idProp }) {
  const ownId = useId();
  // The row passes its own id when it points aria-describedby at these cells.
  const id = idProp || ownId;
  const { collection, rkey } = parseAtUri(atUri);
  if (!collection) return null;
  const dot = collection.lastIndexOf('.');
  const authority = dot > 0 ? collection.slice(0, dot + 1) : '';
  const name = dot > 0 ? collection.slice(dot + 1) : collection;
  return (
    <>
      <span className="ledger-xray-nsid" id={`${id}-nsid`}>
        {authority}
        <wbr />
        <span className="ledger-xray-name">{name}</span>
      </span>
      <span className="ledger-xray-key" id={`${id}-key`}>
        <span className="ledger-xray-key-nsid">{collection}</span>
        <span className="ledger-xray-rkey">{rkey}</span>
        {cid && <span className="ledger-xray-cid">{shortenCid(cid)}</span>}
      </span>
    </>
  );
}
