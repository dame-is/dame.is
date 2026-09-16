// The two jobs that change the list: the remediation queue and the migration.
//
// Kept apart from the preflight panel because they are a different kind of
// thing. Preflight looks; these two act, and the acting is deliberately
// awkward in one specific way — removals happen in the browser, signed by
// dame's own session, so the credential that changes who is blocked is the one
// that owns the list. No server key can alter the graph.

import { useCallback, useEffect, useState } from 'react';
import {
  auditRun,
  auditReview,
  auditDecide,
  removeFromList,
  migrateStart,
  migrateStatus,
  migrateRun,
  BAND_META,
} from '../lib/moderation/client.js';

const num = (n) => (typeof n === 'number' ? n.toLocaleString() : '—');
const ACTIONABLE = BAND_META.filter((b) => b.key !== 'UNKNOWN').map(
  (b) => b.key,
);

/**
 * The remediation queue.
 *
 * Scores everyone already on a list and surfaces the ones who are no longer
 * strangers. On the September list that is 398 of 8,697, of which 88 are
 * CONNECTED — the sweep's blast radius, visible for the first time.
 */
export function AuditPanel({ agent, listUri }) {
  const [status, setStatus] = useState(null);
  const [items, setItems] = useState([]);
  const [marks, setMarks] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [applied, setApplied] = useState(null);

  const loadReview = useCallback(async () => {
    try {
      const r = await auditReview(agent);
      setItems(r.items || []);
      setStatus(r.audit || null);
    } catch (err) {
      setError(String(err?.message || err));
    }
  }, [agent]);

  useEffect(() => {
    loadReview();
  }, [loadReview]);

  /**
   * Score until finished.
   *
   * Loops rather than firing once: the endpoint is resumable by design and
   * leaving a half-scored audit on screen would invite acting on a partial
   * picture, which is the failure this whole system exists to prevent.
   */
  const score = useCallback(
    async (start) => {
      setBusy(true);
      setError(null);
      try {
        let state = null;
        for (let i = 0; i < 40; i += 1) {
          const r = await auditRun(agent, { listUri, start: start && i === 0 });
          setStatus({ ...(status || {}), scored: r.scored });
          state = r.state;
          if (state === 'finished') break;
        }
        await loadReview();
      } catch (err) {
        setError(String(err?.message || err));
      } finally {
        setBusy(false);
      }
    },
    [agent, listUri, status, loadReview],
  );

  const apply = useCallback(async () => {
    const decisions = Object.entries(marks).map(([did, decision]) => ({
      did,
      decision,
    }));
    if (!decisions.length) return;
    setBusy(true);
    setError(null);
    try {
      await auditDecide(agent, decisions);
      const toRemove = decisions
        .filter((d) => d.decision === 'remove')
        .map((d) => d.did);
      const result = toRemove.length
        ? await removeFromList(agent, listUri, toRemove)
        : { removed: 0 };
      setApplied(result);
      setMarks({});
      await loadReview();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  }, [agent, marks, listUri, loadReview]);

  const markAll = (decision) =>
    setMarks(Object.fromEntries(items.map((i) => [i.did, decision])));

  return (
    <div className="mod-studio">
      <p className="mod-verdict">
        {status
          ? `${num(status.scored)} scored${status.finished_at ? ', complete' : ', in progress'} · ${num(items.length)} need a look`
          : 'No audit yet.'}
      </p>
      {error && <p className="mod-error">{error}</p>}
      {applied && (
        <p className="mod-warn">
          Removed {num(applied.removed)} listitems
          {applied.found !== applied.asked &&
            ` (${num(applied.asked)} marked, ${num(applied.found)} found on the list)`}
          .
        </p>
      )}

      <div className="mod-form-row">
        <button
          className="mod-go"
          type="button"
          disabled={busy}
          onClick={() => score(!status || Boolean(status.finished_at))}
        >
          {busy
            ? 'Scoring…'
            : status?.finished_at
              ? 'Re-score list'
              : 'Score list'}
        </button>
        <button
          className="mod-ghost"
          type="button"
          disabled={busy || !items.length}
          onClick={() => markAll('remove')}
        >
          Mark all remove
        </button>
        <button
          className="mod-ghost"
          type="button"
          disabled={busy || !items.length}
          onClick={() => markAll('keep')}
        >
          Mark all keep
        </button>
        <button
          className="mod-go"
          type="button"
          disabled={busy || !Object.keys(marks).length}
          onClick={apply}
        >
          Apply {Object.keys(marks).length || ''}
        </button>
      </div>

      <ul className="mod-list">
        {items.map((item) => (
          <li
            key={item.did}
            className={`mod-row mod-row--${item.band.toLowerCase()}`}
          >
            <div className="mod-row-head">
              <a
                className="mod-row-handle"
                href={`https://bsky.app/profile/${item.handle || item.did}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {item.handle || item.did}
              </a>
              <span className={`mod-band mod-band--${item.band.toLowerCase()}`}>
                {item.band}
              </span>
              <span className="mod-choice">
                <button
                  type="button"
                  className={marks[item.did] === 'keep' ? 'is-on' : ''}
                  onClick={() =>
                    setMarks((m) => ({ ...m, [item.did]: 'keep' }))
                  }
                >
                  keep
                </button>
                <button
                  type="button"
                  className={marks[item.did] === 'remove' ? 'is-on' : ''}
                  onClick={() =>
                    setMarks((m) => ({ ...m, [item.did]: 'remove' }))
                  }
                >
                  remove
                </button>
              </span>
            </div>
            <p className="mod-row-why">
              {item.protected_reason ? (
                <strong>{item.protected_reason}</strong>
              ) : (
                <>
                  <strong>{item.vouches}</strong> of the people you follow also
                  follow them
                </>
              )}
              {' · '}
              {num(item.followers)} followers
            </p>
          </li>
        ))}
      </ul>
      {!items.length && status?.finished_at && (
        <p className="mod-empty">
          Nothing on this list scores above UNKNOWN. Either the sweeps were
          clean or the reference data is stale.
        </p>
      )}
    </div>
  );
}

/**
 * The migration.
 *
 * Carries only the bands you choose, so leaving the CONNECTED accounts behind
 * IS the remediation — they are fixed by never being copied rather than by a
 * second cleanup nobody gets to.
 */
export function MigratePanel({ agent, listUri }) {
  const [state, setState] = useState(null);
  const [bands, setBands] = useState(['UNKNOWN']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    try {
      setState(await migrateStatus(agent));
    } catch (err) {
      setError(String(err?.message || err));
    }
  }, [agent]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const wrap = (fn) => async () => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(String(err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  const m = state?.migration;

  return (
    <div className="mod-studio">
      {error && <p className="mod-error">{error}</p>}
      <p className="mod-verdict">
        {m
          ? `${num(m.carried)} carried${m.failed ? `, ${num(m.failed)} failed` : ''}${m.finished_at ? ' · complete' : ' · running'}`
          : 'Not started.'}
      </p>
      {m?.target_list && (
        <p className="mod-summary-line">Target: {m.target_list}</p>
      )}

      <fieldset className="mod-bandpick">
        <legend className="mod-label">Carry these bands</legend>
        {BAND_META.map(({ key, label, hint }) => (
          <label key={key} title={hint}>
            <input
              type="checkbox"
              checked={bands.includes(key)}
              disabled={Boolean(m) && !m.finished_at}
              onChange={(e) =>
                setBands((b) =>
                  e.target.checked ? [...b, key] : b.filter((x) => x !== key),
                )
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="mod-row-why">
        Anything not ticked stays behind. Leaving {ACTIONABLE.join(', ')}{' '}
        unticked is how the accounts a sweep should never have caught get fixed:
        they are simply not copied.
      </p>

      <div className="mod-form-row">
        <button
          className="mod-go"
          type="button"
          disabled={busy || (m && !m.finished_at)}
          onClick={wrap(() =>
            migrateStart(agent, { sourceList: listUri, carryBands: bands }),
          )}
        >
          Start migration
        </button>
        <button
          className="mod-ghost"
          type="button"
          disabled={busy || !m || Boolean(m.finished_at)}
          onClick={wrap(() => migrateRun(agent))}
        >
          Run a batch now
        </button>
        <button
          className="mod-ghost"
          type="button"
          onClick={wrap(async () => {})}
        >
          Refresh
        </button>
      </div>
      <p className="mod-row-why">
        A batch is 250 accounts. The cron carries one every ten minutes, so a
        full list takes about six hours; the buttons are for watching it start
        rather than for driving it to the end.
      </p>
    </div>
  );
}
