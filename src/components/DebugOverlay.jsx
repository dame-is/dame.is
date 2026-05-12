import { useState } from 'react';
import { useDebugOverlay } from '../hooks/useDebugOverlay.jsx';
import { useAtUri } from '../hooks/useAtUri.js';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import RecordEditor from './RecordEditor.jsx';
import { ME_DID } from '../config.js';
import './DebugOverlay.css';

export default function DebugOverlay() {
  const { open, closeOverlay } = useDebugOverlay();
  const { atUri, cid, lexicon, pds, record, route, rkey, slug, recordStatus } = useAtUri();
  const { agent, did, session, signIn } = useAtprotoSession();
  const [copied, setCopied] = useState(null);
  const [editing, setEditing] = useState(false);

  if (!open) return null;

  const value = record?.value || record;
  const recordCid = cid || record?.cid || null;
  const recordJson = record ? JSON.stringify(record, null, 2) : null;
  const JSON_COPY_KEY = '__raw_record__';

  const recordUri = record?.uri || atUri || null;
  const recordOwnerDid = ownerDidFromAtUri(recordUri);
  const recordRkey = rkey || rkeyFromAtUri(recordUri);
  const recordCollection = lexicon || collectionFromAtUri(recordUri);

  // Editable when: we know the record's atUri, the owner is the site's DID,
  // we have a lexicon NSID + rkey, and the signed-in agent matches that DID.
  const isOwnRecord = recordOwnerDid === ME_DID;
  const canEdit = Boolean(
    isOwnRecord && recordRkey && recordCollection && agent && did === ME_DID,
  );
  const showSignInToEdit = isOwnRecord && recordRkey && recordCollection && !session;

  function copy(text, key) {
    if (!text) return;
    const marker = key || text;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(marker);
        setTimeout(() => setCopied(null), 1800);
      },
      () => {},
    );
  }

  return (
    <div className="debug-overlay" role="dialog" aria-modal="true" aria-label="Atmosphere debug">
      <button className="debug-overlay-scrim" onClick={closeOverlay} aria-label="Close debug overlay" />
      <aside className="debug-overlay-panel">
        <div className="debug-overlay-header">
          <span className="small-caps">atmosphere · this page</span>
          <button type="button" className="debug-overlay-close" onClick={closeOverlay} aria-label="Close">
            ×
          </button>
        </div>

        <dl>
          <Row label="route" value={route} copyValue={route} copied={copied} onCopy={copy} />
          <Row label="at uri" value={atUri} copyValue={atUri} mono copied={copied} onCopy={copy} />
          <Row label="cid" value={recordCid} copyValue={recordCid} mono copied={copied} onCopy={copy} />
          <Row label="lexicon" value={lexicon} copyValue={lexicon} mono copied={copied} onCopy={copy} />
          <Row label="pds" value={pds} copyValue={pds} placeholder="resolving…" mono copied={copied} onCopy={copy} />
          <Row label="appview" value="public.api.bsky.app" copyValue="public.api.bsky.app" mono copied={copied} onCopy={copy} />
        </dl>

        <div className="debug-overlay-actions">
          {atUri && (
            <a href={`https://atproto-browser.vercel.app/at?u=${encodeURIComponent(atUri)}`} target="_blank" rel="noreferrer noopener">
              Open in atproto browser
            </a>
          )}
          {atUri && (
            <button type="button" onClick={() => copy(atUri)}>
              {copied === atUri ? 'AT URI copied' : 'Copy AT URI'}
            </button>
          )}
          {recordJson && (
            <button type="button" onClick={() => copy(recordJson, JSON_COPY_KEY)}>
              {copied === JSON_COPY_KEY ? 'Record JSON copied' : 'Copy record JSON'}
            </button>
          )}
          {canEdit && (
            <button type="button" onClick={() => setEditing((e) => !e)}>
              {editing ? 'Close editor' : 'Edit record'}
            </button>
          )}
          {showSignInToEdit && (
            <SignInToEditButton signIn={signIn} />
          )}
        </div>

        {editing && canEdit ? (
          <div className="debug-overlay-editor">
            <RecordEditor
              agent={agent}
              did={ME_DID}
              collection={recordCollection}
              rkey={recordRkey}
              compact
              onDeleted={() => {
                setEditing(false);
                closeOverlay();
                window.location.assign('/');
              }}
            />
          </div>
        ) : value ? (
          <>
            <div className="small-caps" style={{ marginTop: 'var(--space-3)' }}>raw record</div>
            <pre className="debug-overlay-json">{recordJson}</pre>
          </>
        ) : (
          <p className="debug-overlay-empty">{emptyStateText(recordStatus, { atUri, rkey, slug })}</p>
        )}
      </aside>
    </div>
  );
}

function SignInToEditButton({ signIn }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signIn(ME_DID);
        } catch {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Redirecting…' : 'Sign in to edit'}
    </button>
  );
}

function Row({ label, value, copyValue, placeholder, mono, copied, onCopy }) {
  const display = value || placeholder || '—';
  const canCopy = Boolean(copyValue);
  const isCopied = canCopy && copied === copyValue;
  return (
    <div className="debug-overlay-row">
      <dt>{label}</dt>
      <dd className={mono ? '' : ''}>
        {canCopy ? (
          <button
            type="button"
            onClick={() => onCopy(copyValue)}
            className="debug-overlay-row-button"
          >
            <span>{display}</span>
            <span className="debug-overlay-row-action small-caps">
              {isCopied ? 'copied' : 'copy'}
            </span>
          </button>
        ) : (
          display
        )}
      </dd>
    </div>
  );
}

function emptyStateText(status, { atUri, rkey, slug }) {
  if (status === 'missing') return 'No backing record found for this route.';
  if (status === 'none') return 'No backing record for this route yet.';
  // Default for 'loading' / 'idle' / undefined — and the legacy fallback for
  // routes that hint at a record (atUri/rkey/slug) but haven't told us a
  // status yet.
  if (status === 'loading' || atUri || rkey || slug) return 'Loading record…';
  return 'No backing record for this route yet.';
}

function ownerDidFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/([^/]+)\//);
  return m ? m[1] : null;
}

function collectionFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}

function rkeyFromAtUri(uri) {
  const m = String(uri || '').match(/^at:\/\/[^/]+\/[^/]+\/([^/?#]+)/);
  return m ? m[1] : null;
}
