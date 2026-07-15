import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import GuestbookSignForm from './GuestbookSignForm.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { getProfile } from '../lib/atproto.js';
import './GuestbookSheet.css';

/**
 * The guestbook sign sheet — the bottom-chrome surface behind every "Sign the
 * guestbook" call to action (the home page aside, the /welcoming page CTA). It
 * expands up out of the bottom bar like the search / filter / info panels, and
 * is coordinated through the same `useChromePanel` slot so it never stacks on
 * another panel or the nav dock.
 *
 *   - Signed in  → the pen (GuestbookSignForm).
 *   - Signed out → a one-record sign-in: visitors grant write access to just
 *     the is.dame.guestbook.entry collection (see scopeForAccount), and are
 *     returned to /welcoming with this sheet reopened.
 *
 * On a successful signature it closes and routes to /welcoming, handing the
 * fresh entry along so it appears immediately — ahead of the backlink index.
 */
export default function GuestbookSheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'guestbook';
  const { session, agent, did, signIn } = useAtprotoSession();
  const navigate = useNavigate();

  // The signer's profile, for the form's "signing as" line and to render their
  // fresh signature optimistically before Constellation indexes the backlink.
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    setProfile(null);
    if (!did) return undefined;
    let cancelled = false;
    getProfile(did)
      .then((p) => {
        if (!cancelled && p) setProfile(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [did]);

  // The signer's handle for the header ("Sign guestbook as @handle"), falling
  // back to a shortened DID. Empty when signed out.
  const signerHandle = useMemo(() => {
    if (profile?.handle && profile.handle !== 'handle.invalid') return `@${profile.handle}`;
    if (!did) return '';
    return did.length > 24 ? `${did.slice(0, 12)}…${did.slice(-6)}` : did;
  }, [profile, did]);

  function handleSigned(entry) {
    closePanel();
    // Land on the book with the new signature in hand so it shows at once.
    navigate('/welcoming', { state: { justSigned: { ...entry, profile } } });
  }

  return (
    <BottomSheet
      open={open}
      onClose={closePanel}
      label="Sign guestbook"
      id="chrome-guestbook-sheet"
      className="guestbook-sheet-panel"
    >
      <div className="guestbook-sheet-header">
        <span className="small-caps">
          Sign guestbook{session && signerHandle ? ' as ' : ''}
          {session && signerHandle && (
            <span className="guestbook-sheet-signer">{signerHandle}</span>
          )}
        </span>
        <button
          type="button"
          className="guestbook-sheet-close"
          onClick={closePanel}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {session ? (
        <GuestbookSignForm agent={agent} did={did} onSigned={handleSigned} />
      ) : (
        <GuestbookSignIn signIn={signIn} />
      )}
    </BottomSheet>
  );
}

/**
 * Signed-out state: a compact, purpose-built sign-in. Unlike the account
 * panel's general sign-in, it asks only for guestbook write access and returns
 * the visitor to /welcoming — reopening this sheet — once they're back.
 */
function GuestbookSignIn({ signIn }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(input.trim(), { returnTo: '/welcoming', intent: 'guestbook-sign' });
      // Redirected away; if we somehow keep running, drop the busy state.
    } catch (err) {
      setBusy(false);
      setError(err?.message || String(err));
    }
  }

  return (
    <form className="guestbook-sheet-signin" onSubmit={handleSubmit}>
      <p className="guestbook-sheet-signin-text">
        Sign in with your Atmosphere or Bluesky account to leave a note in my guestbook. The
        record is saved to your PDS and displays on my site via backlinks.
      </p>
      <input
        className="signin-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="handle, DID, or PDS URL"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        aria-label="Your handle, DID, or PDS URL"
      />
      <button type="submit" className="signin-button" disabled={busy || !input.trim()}>
        {busy ? 'Redirecting…' : 'Sign in to sign'}
      </button>
      {error && <p className="signin-error">{error}</p>}
    </form>
  );
}
