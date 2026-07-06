import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID } from '../config.js';
import { getProfile } from '../lib/atproto.js';
import './SignInPanel.css';

/**
 * Sign-in surface that lives inside the ActionDock's Tools section.
 *
 *   - Signed out → a tiny handle / DID / PDS-URL field that kicks off the
 *     OAuth flow.
 *   - Signed in → identity readout + sign out. If the signed-in DID is the
 *     site owner, also expose a link to /admin.
 */
export default function SignInPanel({ onAction }) {
  const { session, did, loading, signIn, signOut } = useAtprotoSession();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [handle, setHandle] = useState(null);

  useEffect(() => {
    setHandle(null);
    if (!did) return undefined;
    let cancelled = false;
    getProfile(did)
      .then((profile) => {
        if (cancelled) return;
        const h = profile?.handle;
        if (h && h !== 'handle.invalid') setHandle(h);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [did]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(input.trim());
      // Redirected away; if we somehow keep running, clear state.
    } catch (err) {
      setBusy(false);
      setError(err?.message || String(err));
    }
  }

  async function handleSignOut() {
    await signOut();
    onAction?.();
  }

  if (loading) {
    return (
      <div className="signin-panel">
        <div className="signin-status">Restoring session…</div>
      </div>
    );
  }

  if (session) {
    const isOwner = did === ME_DID;
    return (
      <div className="signin-panel">
        <div className="signin-status">
          <span className="small-caps signin-status-label">signed in</span>
          {handle ? (
            <span className="signin-handle" title={did || ''}>@{handle}</span>
          ) : (
            <code className="signin-did" title={did || ''}>{shortDid(did)}</code>
          )}
        </div>
        {isOwner && (
          <Link to="/admin" className="dock-tool" onClick={onAction}>
            <span className="dock-tool-label">Admin</span>
            <span className="dock-tool-key">↗</span>
          </Link>
        )}
        <button type="button" className="dock-tool" onClick={handleSignOut}>
          <span className="dock-tool-label">Sign out</span>
          <span className="dock-tool-key">×</span>
        </button>
      </div>
    );
  }

  return (
    <form className="signin-panel" onSubmit={handleSubmit}>
      <label className="signin-label" htmlFor="signin-input">
        <span className="small-caps">Sign in with ATProto</span>
      </label>
      <input
        id="signin-input"
        className="signin-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="handle, DID, or PDS URL"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
      />
      <button type="submit" className="signin-button" disabled={busy || !input.trim()}>
        {busy ? 'Redirecting…' : 'Sign in'}
      </button>
      {error && <p className="signin-error">{error}</p>}
    </form>
  );
}

function shortDid(did) {
  if (!did) return '';
  if (did.length <= 24) return did;
  return `${did.slice(0, 12)}…${did.slice(-8)}`;
}
