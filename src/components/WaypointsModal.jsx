import { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, ArrowUpRight } from 'lucide-react';
import Modal from './Modal.jsx';
import { resolveWaypoints, groupWaypoints, describeResolved } from '../lib/waypoints.js';
import './WaypointsModal.css';

/**
 * The "Open in…" picker. Given an outbound Atmosphere link (or `at://` URI),
 * it resolves the record to the set of clients that can open it and lets the
 * visitor choose one — powered by @aturi.to/waypoints.
 *
 * Rendered once at the app root by <WaypointsModalProvider>; `href` is set by
 * the global link interceptor (or an imperative `openWaypoints()` call). The
 * whole subtree carries `data-no-waypoints` so its own links don't re-trigger
 * the interceptor.
 */
export default function WaypointsModal({ open, href, onClose }) {
  const [status, setStatus] = useState('idle'); // idle | loading | ready | empty | error
  const [sections, setSections] = useState({ recommended: [], groups: [] });
  const [subtitle, setSubtitle] = useState('');
  const [copiedUrl, setCopiedUrl] = useState(null);
  const copyTimer = useRef(null);

  const isHttp = typeof href === 'string' && /^https?:\/\//.test(href);

  useEffect(() => {
    if (!open || !href) {
      setStatus('idle');
      setSections({ recommended: [], groups: [] });
      setSubtitle('');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    setSubtitle('');
    resolveWaypoints(href)
      .then((result) => {
        if (cancelled) return;
        if (result && Array.isArray(result.waypoints) && result.waypoints.length > 0) {
          setSections(groupWaypoints(result));
          setSubtitle(describeResolved(result));
          setStatus('ready');
        } else {
          setStatus('empty');
        }
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open, href]);

  // Reset the transient "copied" checkmark whenever the modal closes.
  useEffect(() => {
    if (!open) {
      setCopiedUrl(null);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    }
  }, [open]);

  useEffect(() => () => copyTimer.current && clearTimeout(copyTimer.current), []);

  async function copy(url) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopiedUrl(null), 1600);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  return (
    <Modal open={open} onClose={onClose} label="Open in…" className="waypoints-modal-panel">
      <div className="waypoints-modal" data-no-waypoints>
        <div className="waypoints-modal-header">
          <div className="waypoints-modal-heading">
            <span className="small-caps">open in…</span>
            {subtitle && <span className="waypoints-modal-subtitle">{subtitle}</span>}
          </div>
          <button
            type="button"
            className="waypoints-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="waypoints-modal-body">
          {status === 'loading' && (
            <p className="waypoints-modal-note">Resolving destinations…</p>
          )}

          {status === 'error' && (
            <p className="waypoints-modal-note">
              Couldn't resolve this link into Atmosphere clients.
            </p>
          )}

          {status === 'empty' && (
            <p className="waypoints-modal-note">
              No other clients can open this link.
            </p>
          )}

          {status === 'ready' && (
            <>
              {sections.recommended.length > 0 && (
                <WaypointGroup
                  name={sections.recommendedLabel}
                  waypoints={sections.recommended}
                  copiedUrl={copiedUrl}
                  onCopy={copy}
                  onOpen={onClose}
                  recommended
                />
              )}
              {sections.groups.map((group) => (
                <WaypointGroup
                  key={group.id}
                  name={group.name}
                  waypoints={group.waypoints}
                  copiedUrl={copiedUrl}
                  onCopy={copy}
                  onOpen={onClose}
                />
              ))}
            </>
          )}
        </div>

        {isHttp && status !== 'loading' && (
          <a
            className="waypoints-modal-original"
            href={href}
            target="_blank"
            rel="noreferrer noopener"
            onClick={onClose}
          >
            Open the original link
            <ArrowUpRight size={13} aria-hidden="true" />
          </a>
        )}
      </div>
    </Modal>
  );
}

function WaypointGroup({ name, waypoints, copiedUrl, onCopy, onOpen, recommended }) {
  return (
    <section className={`waypoints-group${recommended ? ' is-recommended' : ''}`}>
      <h3 className="waypoints-group-title small-caps">{name}</h3>
      <ul className="waypoints-list">
        {waypoints.map((w) => (
          <li key={w.id} className="waypoints-row">
            <a
              className="waypoints-row-open"
              href={w.url}
              target="_blank"
              rel="noreferrer noopener"
              onClick={onOpen}
            >
              <span className="waypoints-row-name">{w.name}</span>
              <ArrowUpRight size={14} aria-hidden="true" className="waypoints-row-arrow" />
            </a>
            <button
              type="button"
              className="waypoints-row-copy"
              onClick={() => onCopy(w.url)}
              aria-label={`Copy ${w.name} link`}
            >
              {copiedUrl === w.url ? (
                <Check size={14} aria-hidden="true" />
              ) : (
                <Copy size={14} aria-hidden="true" />
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
