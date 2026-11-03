import { useEffect, useMemo, useState } from 'react';
import BottomSheet from './BottomSheet.jsx';
import GuestbookSignForm from './GuestbookSignForm.jsx';
import { useChromePanel } from '../hooks/useChromePanel.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { getProfile } from '../lib/atproto.js';
import { registerDate } from '../lib/guestbookRegister.js';

/**
 * The guestbook sign sheet: a fresh page of the book, opened from the
 * register's next blank line on /welcoming. It is the page's own, not the
 * chrome's. The home page's pen and the About ledger link to the book rather
 * than opening this over themselves, which left a half-covered hero showing
 * above a short sheet.
 *
 * It rises out of the bottom bar like the other chrome sheets, and is
 * coordinated through the same `useChromePanel` slot so it never stacks on
 * another panel or the nav dock. Unlike them it fills the window up to the
 * running head, so nothing half-hidden shows behind it, and keeps one × at the
 * top; the signature and the sign button sit at its foot, in the thumb's
 * reach. The form (GuestbookSignForm) is laid on the page grid the way the
 * register is: the line number and the "as" / "from" labels in the margin,
 * the note and the signature in the text column.
 *
 * A visitor who isn't signed in signs with their handle at the foot: a
 * one-record sign-in that grants write access to just the
 * is.dame.guestbook.entry collection (see scopeForAccount), returns them to
 * /welcoming, and writes the note they left before the hop.
 *
 * `lineNumber` is the number the signature will take (the page's count plus
 * one), or null while the count isn't known. `onSigned` gets the fresh entry,
 * with the signer's profile, to put on the register at once, ahead of the
 * backlink index.
 */
export default function GuestbookSheet({ lineNumber = null, onSigned }) {
  const { panel, closePanel } = useChromePanel();
  const open = panel === 'guestbook';
  // The page restores a returning signer's session as it mounts, long before
  // the blank line can be tapped; `loading` covers the rest of that wait.
  const { session, agent, did, loading, signIn, signOut } = useAtprotoSession();

  // The signer's profile: the name and avatar on the signature line, and the
  // fresh signature's portrait before Constellation indexes the backlink.
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

  // Who the signature line names: the profile's handle and display name, or a
  // shortened DID while the profile is on its way (or has none).
  const signer = useMemo(() => {
    if (!did) return null;
    const handle =
      profile?.handle && profile.handle !== 'handle.invalid' ? profile.handle : null;
    const shortDid = did.length > 24 ? `${did.slice(0, 12)}…${did.slice(-6)}` : did;
    return {
      handle,
      name: profile?.displayName?.trim() || (handle ? `@${handle}` : shortDid),
      avatar: profile?.avatar || null,
    };
  }, [did, profile]);

  // The date the line will carry, on Dame's calendar like every date in the
  // book. Read as the sheet opens, so a sheet left open past midnight still
  // names the day it was opened on rather than ticking under the signer.
  const today = useMemo(() => (open ? registerDate(new Date().toISOString()) : ''), [open]);

  function handleSigned(entry) {
    closePanel();
    onSigned?.({ ...entry, profile });
  }

  return (
    <BottomSheet
      open={open}
      onClose={closePanel}
      title="Sign the guestbook"
      meta={today}
      id="guestbook-sheet"
      size="fill"
      // The fill size draws a second Close at the foot for a thumb by default.
      // Here the foot is the sign button, and the sheet keeps one ×.
      thumbClose={false}
      className="guestbook-sheet-panel"
      bodyClassName="guestbook-sheet-body"
    >
      <GuestbookSignForm
        agent={agent}
        did={did}
        signedIn={Boolean(session)}
        restoring={loading}
        signer={signer}
        lineNumber={lineNumber}
        signIn={signIn}
        signOut={signOut}
        onSigned={handleSigned}
      />
    </BottomSheet>
  );
}
