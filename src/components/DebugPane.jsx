import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAtUri } from '../hooks/useAtUri.js';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import RecordEditor from './RecordEditor.jsx';
import { ME_DID } from '../config.js';
import { explorerPathFromAtUri } from '../lib/atproto.js';
import { BUILD_ID } from '../lib/appVersion.js';
import './DebugOverlay.css';

/**
 * Atmosphere debug content for the current route. Rendered inside the
 * DebugSheet — that sheet owns the surrounding BottomSheet, the header, and
 * the close button, so this component renders only the readouts, actions, and
 * (optionally) the inline record editor.
 */
export default function DebugPane({ onClose }) {
  const { atUri, cid, lexicon, pds, record, route, rkey, slug, recordStatus } = useAtUri();
  const { agent, did, session, signIn } = useAtprotoSession();
  const [copied, setCopied] = useState(null);
  const [editing, setEditing] = useState(false);

  const value = record?.value || record;
  const recordCid = cid || record?.cid || null;
  const recordJson = record ? JSON.stringify(record, null, 2) : null;
  const JSON_COPY_KEY = '__raw_record__';

  const recordUri = record?.uri || atUri || null;
  const recordOwnerDid = ownerDidFromAtUri(recordUri);
  const recordRkey = rkey || rkeyFromAtUri(recordUri);
  const recordCollection = lexicon || collectionFromAtUri(recordUri);

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
    <div className="debug-pane">
      <dl>
        <Row label="route" value={route} copyValue={route} copied={copied} onCopy={copy} />
        <Row
          label="at uri"
          value={atUri}
          copyValue={atUri}
          linkTo={explorerPathFromAtUri(atUri)}
          onNavigate={onClose}
          mono
          copied={copied}
          onCopy={copy}
        />
        <Row label="cid" value={recordCid} copyValue={recordCid} mono copied={copied} onCopy={copy} />
        <Row label="lexicon" value={lexicon} copyValue={lexicon} mono copied={copied} onCopy={copy} />
        <Row label="pds" value={pds} copyValue={pds} placeholder="resolving…" mono copied={copied} onCopy={copy} />
        <Row label="appview" value="public.api.bsky.app" copyValue="public.api.bsky.app" mono copied={copied} onCopy={copy} />
        <Row label="build" value={BUILD_ID} copyValue={BUILD_ID} mono copied={copied} onCopy={copy} />
      </dl>

      <div className="debug-overlay-actions">
        {recordOwnerDid && recordCollection && recordRkey && (
          <Link
            to={`/exploring/${recordOwnerDid}/${recordCollection}/${encodeURIComponent(recordRkey)}`}
            onClick={onClose}
          >
            Open in explorer
          </Link>
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
              onClose?.();
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

function Row({ label, value, copyValue, placeholder, mono, copied, onCopy, linkTo, onNavigate }) {
  const display = value || placeholder || '—';
  const canCopy = Boolean(copyValue);
  const isCopied = canCopy && copied === copyValue;

  let displayNode;
  if (linkTo) {
    displayNode = (
      <Link to={linkTo} className="debug-overlay-row-link" onClick={onNavigate}>
        {display}
      </Link>
    );
  } else if (canCopy) {
    displayNode = (
      <button
        type="button"
        onClick={() => onCopy(copyValue)}
        className="debug-overlay-row-button"
      >
        {display}
      </button>
    );
  } else {
    displayNode = display;
  }

  return (
    <div className="debug-overlay-row">
      <dt>{label}</dt>
      <dd className={mono ? '' : ''}>
        <span className="debug-overlay-row-value">{displayNode}</span>
        {canCopy && (
          <button
            type="button"
            onClick={() => onCopy(copyValue)}
            className="debug-overlay-row-action small-caps"
            aria-label={`Copy ${label}`}
          >
            {isCopied ? 'copied' : 'copy'}
          </button>
        )}
      </dd>
    </div>
  );
}

function emptyStateText(status, { atUri, rkey, slug }) {
  if (status === 'missing') return 'No backing record found for this route.';
  if (status === 'none') return 'No backing record for this route yet.';
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
