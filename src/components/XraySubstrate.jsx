import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ME_DID, ME_HANDLE } from '../config.js';
import { resolvePds, explorerPathFromAtUri } from '../lib/atproto.js';
import { useXray } from '../hooks/useXray.jsx';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import { atUriParts, parseAtUri, shortenCid, shortenDid } from '../lib/xray.js';

/**
 * The one-line "there's a record under here" tag a card wears while x-ray is
 * armed: the record's address (collection highlighted) plus an inspect
 * affordance that drills into the full substrate.
 */
export function XrayTag({ atUri, onOpen }) {
  const parts = atUriParts(atUri);
  if (!parts) return null;
  return (
    <div className="xray-tag" aria-hidden="true">
      <span className="bp-uri">
        <span className="did">{parts.prefix}</span>
        <span className="nsid">{parts.nsid}</span>
        <span className="rkey">{parts.rkey}</span>
      </span>
      {onOpen && (
        <button type="button" className="xray-tag-open" onClick={onOpen}>
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

/**
 * The substrate readout for a focused record. Rather than dumping the record's
 * values (you can open it for those), it answers the more evocative question:
 * where does this thing sit in the atmosphere? A you-are-here descent through
 * the repo — PDS → repo → collection → this record — plus jump-offs into the
 * explorer and the record's own page. Owns a lazy PDS resolve for our own
 * records so the top of the descent is real.
 */
export function XraySubstratePanel({ atUri, cid }) {
  const [pds, setPds] = useState(null);
  const { did, collection, rkey } = parseAtUri(atUri);
  const isMe = did === ME_DID;

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
      </div>

      <div className="xray-actions">
        {explorerPath && <Link to={explorerPath}>open in explorer</Link>}
      </div>
    </div>
  );
}
