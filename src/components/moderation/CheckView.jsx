// Look before acting: score a post's engagers, or open any account's record.
//
// Nothing here writes. A post score runs dry, so looking does not leave plans
// in the decision log; acting on a post is still the bot's job, in a DM.

import { useState } from 'react';
import { describeEngagements, preflight } from '../../lib/moderation/client.js';
import {
  Avatar,
  BAND_LABEL,
  BandBadge,
  Chips,
  ErrorNote,
  Skeleton,
  Tag,
  compact,
  fmt,
} from './ui.jsx';

const MODES = [
  { key: 'post', label: 'A post' },
  { key: 'account', label: 'An account' },
];
const ORDER = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'];

export default function CheckView({ agent, onOpenAccount }) {
  const [mode, setMode] = useState('post');
  const [link, setLink] = useState('');
  const [actor, setActor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const score = async (e) => {
    e.preventDefault();
    if (!link.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await preflight(agent, link.trim(), { dry: true }));
    } catch (err) {
      setError(err);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const look = (e) => {
    e.preventDefault();
    const a = actor
      .trim()
      .replace(/^@/, '')
      .replace(/^https?:\/\/bsky\.app\/profile\//, '')
      .split('/')[0];
    if (a) onOpenAccount(a);
  };

  const totals = result?.totals;

  return (
    <section className="mh-view" aria-label="Check">
      <Chips
        options={MODES}
        value={mode}
        onChange={setMode}
        label="What to check"
      />

      {mode === 'post' ? (
        <form className="mh-form" onSubmit={score}>
          <label className="mh-label" htmlFor="mh-post">
            Post link
          </label>
          <div className="mh-form-row">
            <input
              id="mh-post"
              className="mh-input"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://bsky.app/profile/…/post/…"
              spellCheck="false"
              autoComplete="off"
              inputMode="url"
            />
            <button
              className="mh-button mh-button--primary"
              type="submit"
              disabled={busy || !link.trim()}
            >
              {busy ? 'Scoring…' : 'Score'}
            </button>
          </div>
          <p className="mh-small mh-muted">
            Everyone who liked, reposted, replied or quoted, scored against your
            follow graph. Nothing is added; a scan here leaves no plan behind.
          </p>
        </form>
      ) : (
        <form className="mh-form" onSubmit={look}>
          <label className="mh-label" htmlFor="mh-actor">
            Handle, DID or profile link
          </label>
          <div className="mh-form-row">
            <input
              id="mh-actor"
              className="mh-input"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="someone.bsky.social"
              spellCheck="false"
              autoComplete="off"
              autoCapitalize="none"
            />
            <button
              className="mh-button mh-button--primary"
              type="submit"
              disabled={!actor.trim()}
            >
              Look up
            </button>
          </div>
          <p className="mh-small mh-muted">
            Whether they are on the list, their band, and every decision
            recorded about them.
          </p>
        </form>
      )}

      {mode === 'post' && busy && <Skeleton rows={4} />}
      {mode === 'post' && <ErrorNote error={error} />}

      {mode === 'post' && result && (
        <div className="mh-result">
          <p>
            <strong>{fmt(totals.participants)}</strong> accounts ·{' '}
            {Object.entries(totals.engagements || {})
              .map(([k, n]) => `${fmt(n)} ${k}${n === 1 ? '' : 's'}`)
              .join(' · ')}
          </p>
          {result.truncated && (
            <p className="mh-warn">
              A page cap was hit, so this is not everyone. Replies and quotes
              are whole; the tail of the likes is cut.
            </p>
          )}
          <ul className="mh-tiles">
            {ORDER.map((band) => {
              const n = totals.byBand?.[band] || 0;
              return (
                <li
                  key={band}
                  className={`mh-tile mh-tile--${band.toLowerCase()}`}
                >
                  <span className="mh-tile-n">{fmt(n)}</span>
                  <span className="mh-tile-label">{BAND_LABEL[band]}</span>
                </li>
              );
            })}
          </ul>
          <p>
            <strong>{fmt(result.requiresReview.length)}</strong> need a named
            look; <strong>{fmt(result.autoEligible)}</strong> are strangers. The
            ones worth a look reach{' '}
            <strong>{compact(totals.reviewReach)}</strong> followers between
            them.
          </p>
          {result.requiresReview.length > 0 && (
            <ul className="mh-rows">
              {result.requiresReview.map((r) => (
                <li key={r.did}>
                  <button
                    type="button"
                    className="mh-row"
                    onClick={() => onOpenAccount(r.did)}
                  >
                    <Avatar name={r.handle || r.did} size={36} />
                    <span className="mh-row-text">
                      <span className="mh-row-name">@{r.handle || r.did}</span>
                      <span className="mh-row-sub">
                        {r.protectedReason ||
                          `${r.vouches} of your follows follow them`}
                        {' · '}
                        {compact(r.followers)} followers ·{' '}
                        {describeEngagements(r.engagements)}
                      </span>
                    </span>
                    <span className="mh-row-tags">
                      <BandBadge band={r.band} />
                      {r.alreadyListed && <Tag tone="muted">on the list</Tag>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
