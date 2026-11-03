import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MapPinned } from 'lucide-react';
import {
  signGuestbook,
  detectCoarseRegion,
  graphemeLength,
  ENTRY_TEXT_MAX_GRAPHEMES,
} from '../lib/guestbook.js';
import { clearDraft, readDraft, saveDraft } from '../lib/guestbookRegister.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { avatarThumb } from '../lib/avatarThumb.js';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { holdReload } from '../lib/reloadHold.js';
// The pen's styles live with the /welcoming page, the only place it's drawn.
import '../pages/Guestbook.css';

const PLACE_HINT = 'The pin fills in your state, region or country, never your town.';
const HOP_HINT =
  'You’ll approve one permission on your PDS, writing guestbook entries, and land back on the book, signed.';

/**
 * The pen, set out like a line of the register it writes. On the page grid
 * the line number and the "as" / "from" labels hang in the margin (the note
 * column on a desk, the register's number column on a phone) and everything
 * written goes in the text column, where the signatures are set.
 *
 *   37 | the note, on ruled lines, filling the sheet
 *      |                                        92 / 300
 *   - - - - - - - - - - - - - - - - - - - - - - - - - - -
 *   as | @ handle field, or your avatar and handle
 * from | a place in your own words              [pin]
 *      | the one line of help, or what went wrong
 *      | [ Sign ]
 *
 * Every line is there from the start, so nothing appears or moves while you
 * sign. The place used to fold behind "Add a place" and open somewhere else
 * on the sheet; now it is an empty "from" line, and the pin fills that same
 * line with your general region. Errors take the help line's place rather
 * than adding one.
 *
 * Signing, once:
 *   - Signed out → the "as" line is a handle field and the button reads "Sign
 *     with atproto". The note is kept in sessionStorage across the hop to the
 *     signer's PDS, and /welcoming writes it on the way back, so there's no
 *     second tap and no retyping.
 *   - Signed in  → the "as" line is the signer's handle, with "not you?" to
 *     sign out.
 *
 * The button is the view's one filled control once there's something to
 * sign, and the quiet tier until then: a tap on it before that takes the
 * cursor to whatever's missing, rather than a dashed button doing nothing.
 *
 * On a successful write it calls `onSigned` with the fresh entry shape
 * (`{ uri, cid, did, rkey, value }`) so the caller can show it at once.
 */
export default function GuestbookSignForm({
  agent,
  did,
  signedIn,
  restoring = false,
  signer = null,
  initialHandle = '',
  lineNumber = null,
  signIn,
  signOut,
  onSigned,
}) {
  const ids = useId();
  // A note saved before a sign-in hop that didn't finish comes back here.
  const saved = useMemo(() => readDraft(), []);
  const [text, setText] = useState(saved?.text || '');
  const [location, setLocation] = useState(saved?.location || '');
  // Whether the place on the line came from the pin and hasn't been typed
  // over since; the pin wears the "on" look while it has.
  const [fromRegion, setFromRegion] = useState(false);
  // A handle written on the register's blank line comes across with the pen.
  const [handleInput, setHandleInput] = useState(initialHandle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);
  const noteRef = useRef(null);
  const handleRef = useRef(null);

  // With a mouse and keyboard the cursor starts in the note. On a touch
  // screen it doesn't: focusing would throw the keyboard up over the sheet
  // before the visitor has asked to type.
  //
  // A frame after mount, not during it. The sheet's focus trap notes what had
  // focus when it opened, to hand focus back on close, and a child's effect
  // runs before its parent's: focused in the same commit, the note was what
  // the trap noted, so closing the sheet dropped focus on <body> instead of
  // the blank line's button.
  useEffect(() => {
    if (!window.matchMedia?.('(pointer: fine)').matches) return undefined;
    const frame = requestAnimationFrame(() => {
      noteRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const length = graphemeLength(text);
  const over = length > ENTRY_TEXT_MAX_GRAPHEMES;
  const hasNote = Boolean(text.trim()) && !over;
  const hasSigner = signedIn ? Boolean(agent) : Boolean(handleInput.trim());
  const ready = hasNote && hasSigner && !restoring && !locating && !busy;

  // An unsent note is work in progress, and a deploy landing mid-sentence must
  // not reload it away. The sheet this renders in already holds the updater
  // off while it is open; holding here as well keeps the draft safe wherever
  // the form is drawn, the "from" line included, which no textarea check
  // would see.
  const hasDraft = Boolean(text.trim() || location.trim());
  useEffect(
    () => (hasDraft ? holdReload('guestbook-draft') : undefined),
    [hasDraft],
  );

  async function detectRegion() {
    if (locating || busy) return;
    setLocating(true);
    setLocError(null);
    try {
      setLocation(await detectCoarseRegion());
      setFromRegion(true);
    } catch (err) {
      setLocError(err?.message || String(err));
    } finally {
      setLocating(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (busy || restoring || locating) return;
    // Not ready yet: take the cursor to what's missing.
    if (!hasNote) {
      noteRef.current?.focus();
      return;
    }
    if (!hasSigner) {
      handleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const place = location.trim();

    if (!signedIn) {
      // Off to the signer's PDS. The note waits in sessionStorage; /welcoming
      // signs with it on the way back.
      saveDraft({ text, location: place });
      try {
        await signIn(handleInput.trim(), { returnTo: '/welcoming', intent: 'guestbook-sign' });
        // Redirected away; if we somehow keep running, drop the busy state.
      } catch (err) {
        console.warn('[guestbook] sign-in failed to start:', err);
        setBusy(false);
        setError(signInErrorMessage(err));
      }
      return;
    }

    try {
      const { uri, cid, value } = await signGuestbook(agent, { text, location: place });
      clearDraft();
      onSigned({ uri, cid, did, rkey: rkeyFromAtUri(uri), value });
      setText('');
      setLocation('');
      setFromRegion(false);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const message = error || locError;
  const help = signedIn || restoring ? PLACE_HINT : `${HOP_HINT} ${PLACE_HINT}`;

  return (
    <form className="guestbook-pen" onSubmit={handleSubmit}>
      <span className="guestbook-pen-number" aria-hidden="true">
        {lineNumber ?? ''}
      </span>
      <div className="guestbook-pen-note">
        <label className="visually-hidden" htmlFor={`${ids}-note`}>
          {lineNumber ? `Your note, for line ${lineNumber}` : 'Your note'}
        </label>
        <textarea
          id={`${ids}-note`}
          ref={noteRef}
          className="guestbook-pen-write"
          placeholder="Leave a note…"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (error) setError(null);
          }}
          disabled={busy}
          aria-describedby={`${ids}-count`}
        />
        <span
          id={`${ids}-count`}
          className={`guestbook-count${over ? ' guestbook-over' : ''}`}
          aria-live={over ? 'polite' : 'off'}
        >
          {length} / {ENTRY_TEXT_MAX_GRAPHEMES}
        </span>
      </div>

      <div className="guestbook-pen-sign">
        {restoring || signedIn ? (
          <span className="guestbook-pen-label">as</span>
        ) : (
          <label className="guestbook-pen-label" htmlFor={`${ids}-handle`}>
            as
          </label>
        )}
        <div className="guestbook-pen-line">
          {restoring ? (
            <>
              <PenAvatar />
              <span className="guestbook-pen-pending">restoring your session…</span>
            </>
          ) : signedIn ? (
            <>
              <PenAvatar src={signer?.avatar} />
              {/* Signed with the handle alone, as the book shows it. */}
              <span className="guestbook-entry-handle guestbook-pen-handle">
                {signer?.handle ? `@${signer.handle}` : signer?.name || 'you'}
              </span>
              <button
                type="button"
                className="btn btn--text btn--sm guestbook-pen-switch"
                onClick={() => signOut?.()}
                disabled={busy}
              >
                not you?
              </button>
            </>
          ) : (
            <>
              <PenAvatar />
              {/* The same guards as the account panel's field (see
                  SignInPanel): iOS otherwise capitalizes and autocorrects a
                  handle as if it were prose. */}
              <input
                id={`${ids}-handle`}
                ref={handleRef}
                className="guestbook-pen-input"
                type="text"
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                inputMode="url"
                enterKeyHint="go"
                spellCheck={false}
                placeholder="your atproto handle"
                value={handleInput}
                onChange={(e) => {
                  setHandleInput(e.target.value);
                  if (error) setError(null);
                }}
                disabled={busy}
              />
            </>
          )}
        </div>

        <label className="guestbook-pen-label" htmlFor={`${ids}-place`}>
          from
        </label>
        <div className="guestbook-pen-line guestbook-pen-place">
          <input
            id={`${ids}-place`}
            className="guestbook-pen-input"
            type="text"
            placeholder={locating ? 'finding your region…' : 'where you’re signing from · optional'}
            value={location}
            onChange={(e) => {
              setLocation(e.target.value);
              setFromRegion(false);
              if (locError) setLocError(null);
            }}
            maxLength={64}
            readOnly={locating}
            disabled={busy}
          />
          <button
            type="button"
            className={`btn btn--sm btn--icon guestbook-pen-locate${
              fromRegion ? ' is-on' : ''
            }${locating ? ' is-busy' : ''}`}
            onClick={detectRegion}
            aria-label="Fill in my general region"
            aria-busy={locating || undefined}
            title="Fill in my general region"
          >
            <MapPinned size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>

        <div className="guestbook-pen-submit">
          <p
            className={`guestbook-pen-help${message ? ' is-error' : ''}`}
            aria-live="polite"
          >
            {message || help}
          </p>
          <button
            type="submit"
            className={`btn${ready ? ' btn--primary' : ''} guestbook-pen-button`}
            disabled={busy || restoring}
          >
            {signedIn ? (
              busy ? (
                'Signing…'
              ) : (
                'Sign the guestbook'
              )
            ) : busy ? (
              'Redirecting…'
            ) : (
              <>
                Sign with atproto <span aria-hidden="true">→</span>
              </>
            )}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * The signature line's portrait, the register's 20px square: the signer's
 * avatar once there is one, else the dashed "@" a signature without a
 * picture wears in the book.
 */
function PenAvatar({ src = null }) {
  return (
    <span className="guestbook-entry-avatar guestbook-pen-avatar" aria-hidden="true">
      {src ? (
        <img src={avatarThumb(src)} alt="" width={20} height={20} />
      ) : (
        <span className="guestbook-entry-avatar-fallback">@</span>
      )}
    </span>
  );
}
