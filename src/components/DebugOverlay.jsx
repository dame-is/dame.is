import { useState } from 'react';
import { useDebugOverlay } from '../hooks/useDebugOverlay.jsx';
import { useAtUri } from '../hooks/useAtUri.js';
import './DebugOverlay.css';

export default function DebugOverlay() {
  const { open, closeOverlay } = useDebugOverlay();
  const { atUri, cid, lexicon, pds, record, route } = useAtUri();
  const [copied, setCopied] = useState(null);

  if (!open) return null;

  const value = record?.value || record;
  const recordCid = cid || record?.cid || null;

  function copy(text) {
    if (!text) return;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(text);
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
          <Row label="route" value={route} />
          <Row label="at uri" value={atUri} mono onClick={() => copy(atUri)} action={copied === atUri ? 'copied' : 'copy'} />
          <Row label="cid" value={recordCid || '—'} mono onClick={recordCid ? () => copy(recordCid) : null} action={recordCid ? (copied === recordCid ? 'copied' : 'copy') : null} />
          <Row label="lexicon" value={lexicon || '—'} mono />
          <Row label="pds" value={pds || 'resolving…'} mono />
          <Row label="appview" value="public.api.bsky.app" mono />
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
        </div>

        {value ? (
          <>
            <div className="small-caps" style={{ marginTop: 'var(--space-3)' }}>raw record</div>
            <pre className="debug-overlay-json">{JSON.stringify(record, null, 2)}</pre>
          </>
        ) : (
          <p className="debug-overlay-empty">
            {atUri
              ? 'Loading record…'
              : 'No backing record for this route yet.'}
          </p>
        )}
      </aside>
    </div>
  );
}

function Row({ label, value, mono, onClick, action }) {
  return (
    <div className="debug-overlay-row">
      <dt>{label}</dt>
      <dd className={mono ? '' : ''}>
        {onClick ? (
          <button type="button" onClick={onClick} className="debug-overlay-row-button">
            <span>{value || '—'}</span>
            {action && <span className="debug-overlay-row-action small-caps">{action}</span>}
          </button>
        ) : (
          value || '—'
        )}
      </dd>
    </div>
  );
}
