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
import { signInErrorMessage } from '../lib/oauthClient.js';
import { holdReload } from '../lib/reloadHold.js';
// The signature form's styles live with the /welcoming page; importing the
// stylesheet here (a global, side-effect import) means the form is styled
// wherever it renders — the guestbook page or the bottom-chrome sign sheet
// opened from anywhere (e.g. the home page).
import '../pages/Guestbook.css';

/**
 * The pen. Writing comes first: the note, its count against the 300-character
 * limit, and a place folded behind "Add a place". Then you sign, once:
 *
 *   - Signed out → one handle field and "Sign with atproto". The note is kept
 *     in sessionStorage across the hop to the signer's PDS, and /welcoming
 *     writes it on the way back, so there's no second tap and no retyping.
 *   - Signed in  → "Signing as @handle" and "Sign the guestbook".
 *
 * On a successful write it calls `onSigned` with the fresh entry shape
 * (`{ uri, cid, did, rkey, value }`) so the caller can show it at once.
 * (Older entries may carry a one-glyph `mark` from the retired picker; rows
 * still render them.)
 */
export default function GuestbookSignForm({ agent, did, signedIn, signerHandle, signIn, onSigned }) {
  const ids = useId();
  // A note saved before a sign-in hop that didn't finish comes back here.
  const saved = useMemo(() => readDraft(), []);
  const [text, setText] = useState(saved?.text || '');
  const [location, setLocation] = useState(saved?.location || '');
  const [placeOpen, setPlaceOpen] = useState(Boolean(saved?.location));
  const [handleInput, setHandleInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);
  const noteRef = useRef(null);

  // With a mouse and keyboard the cursor starts in the note. On a touch
  // screen it doesn't: focusing would throw the keyboard up over the sheet
  // before the visitor has asked to type.
  useEffect(() => {
    if (window.matchMedia?.('(pointer: fine)').matches) {
      noteRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const length = graphemeLength(text);
  const over = length > ENTRY_TEXT_MAX_GRAPHEMES;
  const hasNote = Boolean(text.trim()) && !over;
  const canSign = !busy && hasNote && (signedIn ? Boolean(agent) : Boolean(handleInput.trim()));

  // An unsent note is work in progress, and a deploy landing mid-sentence must
  // not reload it away. The sheet this renders in already holds the updater
  // off while it is open; holding here as well keeps the draft safe wherever
  // the form is drawn, the "signing from" field included, which no textarea
  // check would see.
  const hasDraft = Boolean(text.trim() || location.trim());
  useEffect(
    () => (hasDraft ? holdReload('guestbook-draft') : undefined),
    [hasDraft],
  );

  async function detectRegion() {
    if (locating) return;
    setLocating(true);
    setLocError(null);
    try {
      setLocation(await detectCoarseRegion());
    } catch (err) {
      setLocError(err?.message || String(err));
    } finally {
      setLocating(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!canSign) return;
    setBusy(true);
    setError(null);
    const place = placeOpen ? location : '';

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
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="guestbook-form" onSubmit={handleSubmit}>
      <div className="guestbook-note-field">
        <label className="visually-hidden" htmlFor={`${ids}-note`}>
          Your note
        </label>
        <textarea
          id={`${ids}-note`}
          ref={noteRef}
          className="guestbook-textarea"
          rows={3}
          placeholder="Leave a note…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={busy}
          aria-describedby={`${ids}-count`}
        />
        <div className="guestbook-note-foot">
          {!placeOpen && (
            <button type="button" className="guestbook-add-place" onClick={() => setPlaceOpen(true)}>
              <MapPinned size={14} strokeWidth={1.75} aria-hidden="true" />
              Add a place
            </button>
          )}
          <span
            id={`${ids}-count`}
            className={`guestbook-count${over ? ' guestbook-over' : ''}`}
            aria-live={over ? 'polite' : 'off'}
          >
            {length} / {ENTRY_TEXT_MAX_GRAPHEMES}
          </span>
        </div>
      </div>

      {placeOpen && (
        <div className="guestbook-location-field">
          <label className="small-caps guestbook-location-label" htmlFor={`${ids}-place`}>
            Signing from
          </label>
          <div className="guestbook-location-row">
            <input
              id={`${ids}-place`}
              className="guestbook-location signin-input"
              type="text"
              placeholder="a place, in your own words (optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              maxLength={64}
              disabled={busy}
            />
            <button
              type="button"
              className="guestbook-locate"
              onClick={detectRegion}
              disabled={busy || locating}
              aria-label="Fill in my general region"
              title="Fill in my general region"
            >
              <MapPinned size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          </div>
          <span className="guestbook-location-hint">
            The map button fills in your general state, region or country, never your town.
          </span>
          {locError && <p className="signin-error">{locError}</p>}
        </div>
      )}

      <div className="guestbook-signas">
        {signedIn ? (
          <>
            <p className="guestbook-signas-line">
              Signing as <span className="guestbook-signas-handle">{signerHandle || 'you'}</span>
            </p>
            <button type="submit" className="btn btn--primary signin-button" disabled={!canSign}>
              {busy ? 'Signing…' : 'Sign the guestbook'}
            </button>
          </>
        ) : (
          <>
            <label className="small-caps guestbook-signas-label" htmlFor={`${ids}-handle`}>
              Sign as
            </label>
            <div className="guestbook-signas-row">
              {/* The same guards as the account panel's field (see SignInPanel):
                  iOS otherwise capitalizes and autocorrects a handle as if it
                  were prose. */}
              <input
                id={`${ids}-handle`}
                className="signin-input"
                type="text"
                autoComplete="username"
                autoCorrect="off"
                autoCapitalize="none"
                inputMode="url"
                enterKeyHint="go"
                spellCheck={false}
                placeholder="handle, DID, or PDS URL"
                value={handleInput}
                onChange={(e) => setHandleInput(e.target.value)}
                disabled={busy}
              />
              <button type="submit" className="btn btn--primary signin-button" disabled={!canSign}>
                {busy ? (
                  'Redirecting…'
                ) : (
                  <>
                    Sign with atproto <span aria-hidden="true">→</span>
                  </>
                )}
              </button>
            </div>
            <p className="guestbook-signas-hint">
              You’ll hop to your PDS to approve, then land back here, signed. It asks for one
              permission: writing guestbook entries.
            </p>
          </>
        )}
      </div>
      {error && <p className="signin-error">{error}</p>}
    </form>
  );
}
