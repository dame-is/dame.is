import { Fragment, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ME_DID, ME_HANDLE } from '../config.js';
import { resolvePds, explorerPathFromAtUri } from '../lib/atproto.js';
import { useXray } from '../hooks/useXray.jsx';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { atUriParts, parseAtUri, shortenCid, shortenDid, subjectOfRecord } from '../lib/xray.js';

/**
 * The one-line "there's a record under here" tag a card wears while x-ray is
 * armed: the record's address (collection highlighted) plus an inspect
 * affordance that drills into the full substrate.
 */
export function XrayTag({ atUri, onOpen }) {
  const parts = atUriParts(atUri);
  if (!parts) return null;
  // Only the address is decorative. The inspect button is a real control, and
  // inside aria-hidden it took keyboard focus while saying nothing, so a
  // screen reader could Tab onto every card's drill-in and never learn what
  // it was.
  return (
    <div className="xray-tag">
      <span className="bp-uri" aria-hidden="true">
        <span className="did">{parts.prefix}</span>
        <span className="nsid">{parts.nsid}</span>
        <span className="rkey">{parts.rkey}</span>
      </span>
      {onOpen && (
        <button
          type="button"
          className="xray-tag-open"
          onClick={onOpen}
          aria-label={`Inspect this ${parts.nsid} record`}
        >
          inspect ↓
        </button>
      )}
    </div>
  );
}

/**
 * Marginalia for a reading document (a blog post, a work) — the page is one
 * record, so this floats that record's atmosphere panel beside the prose like
 * a gloss in a book. The whole document IS the one record, so there's nothing
 * to disambiguate: under inspect it shows the full Atmosphere Record locus
 * (pds → repo → collection → record → cid) directly, with no intermediate
 * "tap to inspect" step. On narrow screens (no true margin) it stacks at the
 * top of the document; the document text itself is never dimmed.
 */
export function InspectMargin({ atUri, cid }) {
  const xray = useXray();
  const parts = atUriParts(atUri);
  if (!parts) return null;
  const nsid = parts.nsid || nsidFromAtUri(atUri);
  return (
    <aside
      className="doc-inspect-margin"
      data-atproto=""
      data-at-uri={atUri}
      data-nsid={nsid || undefined}
      aria-label="record"
    >
      {/* The panel resolves the PDS, so only mount it once inspect is armed
          (the aside is display:none until then). */}
      {xray.active && <XraySubstratePanel atUri={atUri} cid={cid} />}
    </aside>
  );
}

/** Highlighted at-uri fragment reused by the tag + panel. */
export function AtUriMono({ atUri }) {
  const parts = atUriParts(atUri);
  if (!parts) return <span className="bp-uri">{atUri}</span>;
  return (
    <span className="bp-uri">
      <span className="did">{parts.prefix}</span>
      <span className="nsid">{parts.nsid}</span>
      <span className="rkey">{parts.rkey}</span>
    </span>
  );
}

/** The full at:// address, with a break opportunity after each "/". */
function BrokenAtUri({ atUri }) {
  const { did, collection, rkey } = parseAtUri(atUri);
  if (!collection) return null;
  const segs = [`at://${shortenDid(did)}/`, `${collection}/`, rkey];
  return (
    <p className="xray-substrate-uri bp-uri">
      {segs.map((seg, i) => (
        <Fragment key={i}>
          <span className={i === 1 ? 'nsid' : i === 2 ? 'rkey' : 'did'}>{seg}</span>
          {i < segs.length - 1 && <wbr />}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * The substrate readout for a focused record. Rather than dumping the record's
 * values (you can open it for those), it answers the more evocative question:
 * where does this thing sit in the atmosphere? A you-are-here descent through
 * the repo — PDS → repo → collection → this record — plus jump-offs into the
 * explorer and the record's own page. A reference record (a repost, a like)
 * also names its subject: the post it points at, with that post's own CID,
 * so the two versions can't be mistaken for each other. Owns a lazy PDS
 * resolve for our own records so the top of the descent is real.
 */
export function XraySubstratePanel({ atUri, cid, value }) {
  const [pds, setPds] = useState(null);
  const { pathname } = useLocation();
  const { did, collection, rkey } = parseAtUri(atUri);
  const isMe = did === ME_DID;
  const subject = subjectOfRecord(value);
  const subjectParts = subject ? parseAtUri(subject.uri) : null;
  const recordPath = recordPathFromAtUri(atUri);

  useEffect(() => {
    let cancelled = false;
    // Only our own records get a live PDS resolve here; a foreign repo (e.g. a
    // guestbook signature on a visitor's PDS) would need its own identity
    // lookup, which the explorer page already does.
    if (!isMe) return undefined;
    resolvePds(ME_DID)
      .then((endpoint) => {
        if (!cancelled) setPds(endpoint);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isMe]);

  const pdsHost = pds ? String(pds).replace(/^https?:\/\//, '') : isMe ? 'resolving…' : 'unknown host';
  const repoLabel = isMe ? `@${ME_HANDLE}` : shortenDid(did) || did;
  const explorerPath = explorerPathFromAtUri(atUri);

  return (
    <div className="xray-substrate" role="group" aria-label="record location">
      <p className="xray-substrate-h">Atmosphere Record</p>
      <BrokenAtUri atUri={atUri} />
      <div className="xray-locus">
        <span className="locus-lvl" style={{ '--d': 0 }}>
          <span className="k">pds</span>
          <span className="v">{pdsHost}</span>
        </span>
        <span className="locus-lvl" style={{ '--d': 1 }}>
          <span className="lead" aria-hidden="true">└</span>
          <span className="k">repo</span>
          <span className="v">{repoLabel}</span>
          {did && <span className="vdim">{shortenDid(did)}</span>}
        </span>
        <span className="locus-lvl" style={{ '--d': 2 }}>
          <span className="lead" aria-hidden="true">└</span>
          <span className="k">collection</span>
          <span className="v accent">{collection || '—'}</span>
        </span>
        <span className="locus-lvl is-here" style={{ '--d': 3 }}>
          <span className="lead" aria-hidden="true">└</span>
          <span className="k">record</span>
          <span className="v">{rkey || '—'}</span>
          <span className="here-mark">← you are here</span>
        </span>
        {cid && (
          <span className="locus-lvl locus-cid" style={{ '--d': 4 }}>
            <span className="kdim">cid</span>
            <span className="vdim">{shortenCid(cid)}</span>
            <span className="hint">this exact version</span>
          </span>
        )}
        {subject && subjectParts?.collection && (
          <span className="locus-lvl locus-subject" style={{ '--d': 4 }}>
            <span className="k">subject</span>
            <span className="v">
              →{' '}
              {subject.handle ? (
                `@${subject.handle}`
              ) : (
                <span className="vdim">{shortenDid(subjectParts.did)}</span>
              )}
            </span>
            <span className="locus-subject-ref">
              <span className="vdim">
                {subjectParts.collection}/<wbr />
                {subjectParts.rkey}
              </span>
              {subject.cid && <span className="vdim">{shortenCid(subject.cid)}</span>}
              <span className="hint">the post it points at</span>
            </span>
          </span>
        )}
      </div>

      <div className="xray-actions">
        {explorerPath && <Link to={explorerPath}>open in explorer</Link>}
        {recordPath && recordPath !== pathname && <Link to={recordPath}>open the record page</Link>}
      </div>
    </div>
  );
}
