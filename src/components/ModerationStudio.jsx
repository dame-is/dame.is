// The gate, as a screen.
//
// Paste a post link; see who touched it, scored against your own graph. The
// layout encodes the one rule the whole system exists for: the accounts that
// need a human look are NAMED, and the ones that do not are COUNTED. A list of
// eight thousand strangers is not reviewable, and rendering it as though it
// were is how someone with 24 mutual connections and 58k followers ended up in
// a bulk block nobody read.
//
// Nothing here writes to the network. This is the look-before-you-act screen;
// acting still happens through the tool you already have, and the promoter
// decides what is allowed through.

import { useCallback, useState } from 'react';
import { AuditPanel, MigratePanel, VoicePanel } from './ModerationPanels.jsx';
import {
  preflight,
  precomputeStatus,
  BAND_META,
  describeEngagements,
} from '../lib/moderation/client.js';
import './ModerationStudio.css';

const num = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');

function bandOf(key) {
  return BAND_META.find((b) => b.key === key) || { label: key, hint: '' };
}

/**
 * One reviewable account.
 *
 * Shows the inputs, not just the verdict. "CONNECTED, trust 90" is an assertion;
 * "13 of the people you follow also follow them, 8,276 followers, they liked it"
 * is something you can disagree with, which is the point of a review screen.
 */
function ReviewRow({ row }) {
  const band = bandOf(row.band);
  return (
    <li className={`mod-row mod-row--${row.band.toLowerCase()}`}>
      <div className="mod-row-head">
        <a
          className="mod-row-handle"
          href={`https://bsky.app/profile/${row.handle || row.did}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          {row.handle || row.did}
        </a>
        <span className={`mod-band mod-band--${row.band.toLowerCase()}`}>
          {band.label}
        </span>
        {row.alreadyListed && <span className="mod-tag">already listed</span>}
      </div>
      <p className="mod-row-why">
        {row.protectedReason ? (
          <strong>{row.protectedReason}</strong>
        ) : (
          <>
            <strong>{row.vouches}</strong> of the people you follow also follow
            them
          </>
        )}
        {' · '}
        {num(row.followers)} followers
        {row.postsPerDay != null && <> · {row.postsPerDay}/day</>}
        {' · '}
        {describeEngagements(row.engagements)}
      </p>
    </li>
  );
}

function PreflightPanel({ agent }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [building, setBuilding] = useState(false);

  const run = useCallback(
    async (event) => {
      event?.preventDefault();
      if (!link.trim() || busy) return;
      setBusy(true);
      setError(null);
      try {
        // Dry by default: looking at a post should not litter the decision log
        // with plans nobody intends to approve.
        setResult(await preflight(agent, link.trim(), { dry: true }));
      } catch (err) {
        setError(String(err?.message || err));
        setResult(null);
      } finally {
        setBusy(false);
      }
    },
    [agent, link, busy],
  );

  /**
   * Check the reference data, and finish building it if it is unfinished.
   *
   * The endpoint is resumable rather than long-running: each call spends a time
   * budget and returns what is left. A single click used to do one batch and
   * report a half-built snapshot, which reads exactly like a finished one to
   * anyone not counting. So this loops until the answer stops changing.
   *
   * It also means the first build needs no CRON_SECRET. The browser holds an
   * OAuth session and mints its own token; the secret is for Vercel's crons,
   * and Vercel does not show it back to you once it is set.
   */
  const checkSnapshot = useCallback(async () => {
    setError(null);
    setBuilding(true);
    try {
      let last = null;
      for (let i = 0; i < 40; i += 1) {
        last = await precomputeStatus(agent);
        setSnapshot(last);
        // `finalising` means every member is read and only the aggregation is
        // left, so it keeps looping; `idle` and `finalised` are terminal.
        if (last.state !== 'collecting' && last.state !== 'finalising') break;
      }
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBuilding(false);
    }
  }, [agent]);

  const totals = result?.totals;

  return (
    <div className="mod-studio">
      <form className="mod-form" onSubmit={run}>
        <label className="mod-label" htmlFor="mod-link">
          Post link or at:// URI
        </label>
        <div className="mod-form-row">
          <input
            id="mod-link"
            className="mod-input"
            type="text"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://bsky.app/profile/…/post/… — any client works"
            spellCheck="false"
            autoComplete="off"
          />
          <button
            className="mod-go"
            type="submit"
            disabled={busy || !link.trim()}
          >
            {busy ? 'Reading…' : 'Preflight'}
          </button>
        </div>
      </form>

      {error && <p className="mod-error">{error}</p>}

      {result && (
        <>
          <div className="mod-summary">
            <p className="mod-summary-line">
              <strong>{num(totals.participants)}</strong> accounts ·{' '}
              {num(totals.records)} interactions ·{' '}
              {Object.entries(totals.engagements || {})
                .map(([k, n]) => `${k} ${n}`)
                .join(', ')}
            </p>
            {result.truncated && (
              <p className="mod-warn">
                A page cap was hit, so this roster is incomplete. Replies and
                quotes are whole; the like tail is cut.
              </p>
            )}
          </div>

          <ul className="mod-bands">
            {BAND_META.map(({ key, label, hint }) => {
              const n = totals.byBand?.[key] || 0;
              if (!n) return null;
              const pct = Math.round((100 * n) / totals.participants);
              return (
                <li
                  key={key}
                  className={`mod-band-tile mod-band-tile--${key.toLowerCase()}`}
                  title={hint}
                >
                  <span className="mod-band-n">{num(n)}</span>
                  <span className="mod-band-label">{label}</span>
                  <span className="mod-band-pct">{pct}%</span>
                </li>
              );
            })}
          </ul>

          <p className="mod-verdict">
            <strong>{num(result.requiresReview.length)}</strong> need a named
            look. <strong>{num(result.autoEligible)}</strong> would pass
            through. The review set reaches{' '}
            <strong>{num(totals.reviewReach)}</strong> followers between them.
          </p>

          {result.requiresReview.length > 0 ? (
            <ul className="mod-list">
              {result.requiresReview.map((row) => (
                <ReviewRow key={row.did} row={row} />
              ))}
            </ul>
          ) : (
            <p className="mod-empty">
              Nobody here is connected to your circle or notable on their own.
              This is what a stranger sweep looks like.
            </p>
          )}
        </>
      )}

      <footer className="mod-foot">
        <button
          className="mod-ghost"
          type="button"
          disabled={building}
          onClick={checkSnapshot}
        >
          {building ? 'Building…' : 'Check / build reference data'}
        </button>
        {snapshot && (
          <span className="mod-snapshot">
            {snapshot.state === 'idle' && 'ready'}
            {snapshot.state === 'finalised' && 'ready (just built)'}
            {snapshot.state === 'finalising' && 'aggregating…'}
            {snapshot.state === 'collecting' &&
              `building · ${num(snapshot.remaining ?? 0)} accounts left to read`}
            {snapshot.snapshot && ` · ${snapshot.snapshot.slice(0, 10)}`}
            {snapshot.vouches != null && ` · ${num(snapshot.vouches)} scored`}
            {snapshot.unreadableMembers
              ? ` · ${num(snapshot.unreadableMembers)} unreadable`
              : ''}
          </span>
        )}
      </footer>
    </div>
  );
}

/**
 * The list the audit and migration panels operate on.
 *
 * Editable rather than hardcoded: the whole point of the migration is that the
 * list moves, so a constant here would be wrong the moment it succeeded.
 */
const DEFAULT_LIST =
  'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.graph.list/3ll5hna42x52o';

const TABS = [
  { key: 'preflight', label: 'Preflight', hint: 'Score a post before acting' },
  { key: 'audit', label: 'Audit', hint: 'Re-score an existing list' },
  { key: 'migrate', label: 'Migrate', hint: 'Carry the list to the bot' },
  { key: 'voice', label: 'Voice', hint: 'How the analyst writes' },
];

export default function ModerationStudio({ agent }) {
  const [tab, setTab] = useState('preflight');
  const [listUri, setListUri] = useState(DEFAULT_LIST);

  return (
    <div className="mod-shell">
      <nav className="mod-tabs">
        {TABS.map(({ key, label, hint }) => (
          <button
            key={key}
            type="button"
            title={hint}
            className={tab === key ? 'is-on' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab !== 'preflight' && tab !== 'voice' && (
        <div className="mod-form-row">
          <input
            className="mod-input"
            type="text"
            value={listUri}
            onChange={(e) => setListUri(e.target.value)}
            spellCheck="false"
            autoComplete="off"
            aria-label="List at:// URI"
          />
        </div>
      )}

      {tab === 'preflight' && <PreflightPanel agent={agent} />}
      {tab === 'audit' && <AuditPanel agent={agent} listUri={listUri} />}
      {tab === 'migrate' && <MigratePanel agent={agent} listUri={listUri} />}
      {tab === 'voice' && <VoicePanel agent={agent} />}
    </div>
  );
}
