import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ME_DID, ME_HANDLE } from '../config.js';
import { resolvePds, explorerPathFromAtUri } from '../lib/atproto.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import {
  atUriParts,
  parseAtUri,
  shortenCid,
  substrateFields,
  depthStack,
} from '../lib/xray.js';

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
 * The full substrate readout for a focused record: the field map (with
 * numbered markers), the record's coordinates, the depth stack, and jump-offs
 * into the explorer / the record's own page. Owns a lazy PDS resolve so the
 * "pds" line and depth stack can name where the record actually lives.
 */
export function XraySubstratePanel({ atUri, cid, value, leadField }) {
  const [pds, setPds] = useState(null);
  const { did } = parseAtUri(atUri);
  const isMe = did === ME_DID;

  useEffect(() => {
    let cancelled = false;
    // Only our own records get a live PDS resolve here; foreign repos would
    // need their own identity lookup, which the explorer page already does.
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

  const { rkey } = parseAtUri(atUri);
  const fields = substrateFields(value, 5);
  const pdsHost = pds ? String(pds).replace(/^https?:\/\//, '') : isMe ? 'resolving…' : '—';
  // Lead the depth stack with the most telling field, not the boilerplate
  // $type, so "the element you tapped → value.text" reads meaningfully.
  const leadFieldPath =
    leadField || fields.find((f) => f.path !== 'value.$type')?.path || fields[0]?.path || null;
  const stack = depthStack(atUri, {
    handle: isMe ? ME_HANDLE : null,
    pds: pdsHost,
    leadField: leadFieldPath,
  });
  const explorerPath = explorerPathFromAtUri(atUri);
  const recordPath = recordPathFromAtUri(atUri);

  return (
    <div className="xray-substrate" role="group" aria-label="record substrate">
      <div className="xray-substrate-wide xray-uri-line">
        <AtUriMono atUri={atUri} />
        {cid && <span className="bp-cid">cid {shortenCid(cid)}</span>}
      </div>

      <div>
        <p className="xray-substrate-h">this element = these fields</p>
        <ul className="xray-fields">
          {fields.length === 0 && <li><span className="v">—</span></li>}
          {fields.map((f, i) => (
            <li key={f.path}>
              <span className="num">{i + 1}</span>
              <span>
                <span className="p">{f.path}</span>
                <span className="v">{f.value}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="xray-substrate-h">where it lives</p>
        <dl className="xray-meta">
          <div><dt>rkey</dt><dd>{rkey || '—'}</dd></div>
          {cid && <div><dt>cid</dt><dd>{shortenCid(cid)}</dd></div>}
          <div><dt>repo</dt><dd>{isMe ? `@${ME_HANDLE}` : did}</dd></div>
          <div><dt>pds</dt><dd>{pdsHost}</dd></div>
        </dl>
      </div>

      <div className="xray-substrate-wide">
        <p className="xray-substrate-h">where you are in the atmosphere</p>
        <div className="xray-depth">
          {stack.map((row, i) => (
            <span className={`lvl${i === 0 ? ' top' : ''}`} key={i}>
              <span className="lead">{row.lead}</span>
              <span className="k">{row.key}</span>
              {row.value && <span className="v">  {row.value}</span>}
            </span>
          ))}
        </div>
        <div className="xray-actions">
          {explorerPath && <Link to={explorerPath}>open in explorer</Link>}
          {recordPath && <Link to={recordPath}>view record page</Link>}
        </div>
      </div>
    </div>
  );
}
