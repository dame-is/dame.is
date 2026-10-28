import {
  lazy,
  Suspense,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { getProfile } from '../lib/atproto.js';
import './GuestbookSheet.css';

// Lazy: the pen carries the guestbook library and the profanity matcher,
// which were a sizeable share of every visitor's entry chunk, and only a
// visitor who opens the sheet needs them. Its stylesheet (pages/Guestbook.css)
// is already in the entry through lib/pageStyles.js, so only the JavaScript
// moves.
const loadSignForm = () => import('./GuestbookSignForm.jsx');
const GuestbookSignForm = lazy(loadSignForm);

/**
 * The guestbook sign sheet — the bottom-chrome surface behind every "Sign the
 * guestbook" call to action (the home page's button, the register's blank
 * line on /welcoming). It expands up out of the bottom bar like the search /
 * filter / info panels, and is coordinated through the same `useChromePanel`
 * slot so it never stacks on another panel or the nav dock.
 *
 * It opens on the note, signed in or not (GuestbookSignForm). A visitor who
 * isn't signed in signs with their handle at the end: a one-record sign-in
 * that grants write access to just the is.dame.guestbook.entry collection
 * (see scopeForAccount), returns them to /welcoming, and writes the note they
 * left before the hop.
 *
 * On a successful signature it closes and routes to /welcoming, handing the
 * fresh entry along so it appears immediately — ahead of the backlink index.
 */
export default function GuestbookSheet() {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'guestbook';
  const { session, agent, did, loading, signIn, restore } = useAtprotoSession();
  const navigate = useNavigate();

  // A returning signer's session isn't restored at startup (see
  // useAtprotoSession); opening the pen is what asks for it. A layout effect,
  // so the sheet's first frame already knows a restore is under way.
  useLayoutEffect(() => {
    if (open) restore();
  }, [open, restore]);

  // Fetch the pen as the sheet opens (and while any session restores), so the
  // waits overlap and the form is usually there by the time the sheet is.
  useEffect(() => {
    if (open) loadSignForm().catch(() => {});
  }, [open]);

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

  // The signer's handle for the form's "Signing as" line, falling back to a
  // shortened DID. Empty when signed out.
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
      label="Sign the guestbook"
      id="chrome-guestbook-sheet"
      className="guestbook-sheet-panel"
    >
      <div className="guestbook-sheet-header">
        <span className="small-caps">Sign the guestbook</span>
        <button
          type="button"
          className="guestbook-sheet-close"
          onClick={closePanel}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      {loading ? (
        // `loading` also covers a live session whose Agent is still loading;
        // the pen can't write without it.
        <p className="guestbook-sheet-restoring">Restoring your session…</p>
      ) : (
        <Suspense
          fallback={
            <p className="guestbook-sheet-restoring">Loading the form…</p>
          }
        >
          <GuestbookSignForm
            agent={agent}
            did={did}
            signedIn={Boolean(session)}
            signerHandle={signerHandle}
            signIn={signIn}
            onSigned={handleSigned}
          />
        </Suspense>
      )}
    </BottomSheet>
  );
}
