import { useState } from 'react';
import { MapPinned } from 'lucide-react';
import {
  signGuestbook,
  detectCoarseRegion,
  graphemeLength,
  ENTRY_TEXT_MAX_GRAPHEMES,
} from '../lib/guestbook.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
// The signature form's styles live with the /welcoming page; importing the
// stylesheet here (a global, side-effect import) means the form is styled
// wherever it renders — the guestbook page or the bottom-chrome sign sheet
// opened from anywhere (e.g. the home page).
import '../pages/Guestbook.css';

/**
 * The pen: a note plus an optional "signing from". Shared by every surface that
 * lets a visitor sign — currently the bottom-chrome GuestbookSheet. (Older
 * entries may carry a one-glyph `mark` from the retired picker; rows still
 * render them.)
 *
 * On a successful write it calls `onSigned` with the fresh entry shape
 * (`{ uri, did, rkey, value }`) so the caller can show it optimistically.
 */
export default function GuestbookSignForm({ agent, did, onSigned }) {
  const [text, setText] = useState('');
  const [location, setLocation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [signedAt, setSignedAt] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState(null);

  const remaining = ENTRY_TEXT_MAX_GRAPHEMES - graphemeLength(text);
  const canSign = !busy && Boolean(text.trim());

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
    try {
      const { uri, cid, value } = await signGuestbook(agent, { text, location });
      onSigned({ uri, cid, did, rkey: rkeyFromAtUri(uri), value });
      setText('');
      setLocation('');
      setSignedAt(new Date());
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="guestbook-form" onSubmit={handleSubmit}>
      <textarea
        className="guestbook-textarea"
        rows={3}
        placeholder="Leave a note…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      {remaining < 40 && (
        <span className={`guestbook-remaining gutter${remaining < 0 ? ' guestbook-over' : ''}`}>
          {remaining}
        </span>
      )}

      <div className="guestbook-location-field">
        <label className="small-caps guestbook-location-label" htmlFor="guestbook-location">
          Signing from
        </label>
        <input
          id="guestbook-location"
          className="guestbook-location signin-input"
          type="text"
          placeholder="a place, in your own words (optional)"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          maxLength={64}
          disabled={busy}
        />
        <span className="guestbook-location-hint">
          Tap map icon to fill the input with your general state/region/country.
        </span>
        {locError && <p className="signin-error">{locError}</p>}
      </div>

      <div className="guestbook-form-actions">
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
        <button type="submit" className="signin-button" disabled={!canSign}>
          {busy ? 'Signing…' : 'Sign'}
        </button>
        {signedAt && !error && (
          <span className="guestbook-signed-note gutter">
            Signed. The record now lives on your PDS.
          </span>
        )}
      </div>
      {error && <p className="signin-error">{error}</p>}
    </form>
  );
}
