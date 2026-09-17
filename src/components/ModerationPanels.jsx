// The two jobs that change the list: the remediation queue and the migration.
//
// Kept apart from the preflight panel because they are a different kind of
// thing: preflight looks, these two act.
//
// Removals route on who owns the list. A list in dame's repo is deleted from
// here, signed by dame's own session; a list on the moderator account goes to
// the server, which holds that account's credential. `removeFromList` picks,
// so neither panel has to know which configuration it is in — and neither can
// repeat the bug where the browser asked the wrong repo, matched nothing, and
// reported success.

import { useCallback, useEffect, useState } from 'react';
import {
  auditRun,
  auditReview,
  auditDecide,
  removeFromList,
  migrateStart,
  migrateStatus,
  migrateRun,
  getAgentConfig,
  setAgentConfig,
  retireStatus,
  retireList,
  CONFIG_NSID,
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

/**
 * The analyst's configuration, published as a record in dame's own repo.
 *
 * The write is signed by dame's session, not the server's. The server holds the
 * BOT's credential, and the one thing the bot must not be able to do is rewrite
 * the instructions it runs under — so the record lives here, in dame's repo,
 * read-only to the thing being configured. Same split as list removals, same
 * reason.
 *
 * Style and guidance steer; they cannot replace. What the bands mean, the
 * untrusted-input handling and the length budgets stay in version control,
 * because those are the claims that keep the decision log replayable and the
 * reply well-formed.
 */
export function VoicePanel({ agent }) {
  const [style, setStyle] = useState('');
  const [guidance, setGuidance] = useState('');
  const [openers, setOpeners] = useState('');
  const [model, setModel] = useState('');
  const [limits, setLimits] = useState({});
  const [fallback, setFallback] = useState('');
  const [config, setConfig] = useState(null);
  const [maxChars, setMaxChars] = useState(2000);
  const [spec, setSpec] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let live = true;
    getAgentConfig(agent)
      .then((r) => {
        if (!live) return;
        setFallback(r.default?.style || '');
        setConfig(r.config || null);
        setStyle(r.config?.style || '');
        setGuidance(r.config?.guidance || '');
        setOpeners(r.config?.openers || '');
        setModel(r.config?.model || '');
        setLimits(r.config?.limits || {});
        if (r.limitSpec) setSpec(r.limitSpec);
        if (r.maxChars) setMaxChars(r.maxChars);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [agent]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await setAgentConfig(agent, {
        style,
        guidance,
        openers,
        model,
        limits,
      });
      setConfig(r.config || null);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [agent, style, guidance, openers, model, limits]);

  const over =
    style.length > maxChars ||
    guidance.length > maxChars ||
    openers.length > maxChars;

  return (
    <div className="mod-studio">
      {error && <p className="mod-error">{error}</p>}
      <p className="mod-verdict">
        Published as <code>{CONFIG_NSID}</code> in your own repo, signed by your
        session. The bot reads it and cannot change it.
      </p>
      <p className="mod-summary-line">
        {config
          ? `${config.source === 'pds' ? 'Live from your repo' : 'Cached copy — the record could not be read'}${
              config.updated_at
                ? `, updated ${new Date(config.updated_at).toLocaleString()}`
                : ''
            }`
          : 'No record yet — running on the built-in defaults'}
      </p>

      <p className="mod-summary-line">Voice — how it writes.</p>
      <textarea
        className="mod-input"
        rows={6}
        value={style}
        placeholder={fallback}
        onChange={(e) => {
          setStyle(e.target.value);
          setSaved(false);
        }}
        aria-label="Analyst voice"
      />

      <p className="mod-summary-line">
        Standing instructions — followed every turn. These add to the rules;
        they cannot remove what the bands mean or how untrusted text is handled.
      </p>
      <textarea
        className="mod-input"
        rows={6}
        value={guidance}
        placeholder="e.g. always tell me their posting frequency; lead with the band"
        onChange={(e) => {
          setGuidance(e.target.value);
          setSaved(false);
        }}
        aria-label="Standing instructions"
      />

      <p className="mod-summary-line">
        Openers, one per line. These are what the non-model replies greet with:
        the acknowledgement, the nudges. What follows the opener is a statement
        of what is happening and is not editable, because a receipt that can be
        edited is a receipt that can lie.
      </p>
      <textarea
        className="mod-input"
        rows={5}
        value={openers}
        placeholder={'Acknowledged.\nOn it.\nOn it, boss.\nGot it.'}
        onChange={(e) => {
          setOpeners(e.target.value);
          setSaved(false);
        }}
        aria-label="Reply openers"
      />

      <p className="mod-summary-line">
        {style.length.toLocaleString()} + {guidance.length.toLocaleString()} +{' '}
        {openers.length.toLocaleString()} of {maxChars.toLocaleString()} each
        {over && ' — too long'}
      </p>

      <p className="mod-summary-line">
        Model. Leave blank to use whatever the droplet is configured with.
      </p>
      <input
        className="mod-input"
        type="text"
        value={model}
        placeholder="anthropic/claude-opus-5"
        spellCheck="false"
        autoComplete="off"
        onChange={(e) => {
          setModel(e.target.value);
          setSaved(false);
        }}
        aria-label="Model"
      />

      <p className="mod-summary-line">
        Budgets. Clamped to a range on read, because these have a bill attached:
        every tool-loop step resends the prompt and the tools.
      </p>
      <div className="mod-form-row">
        {Object.entries(spec).map(([key, range]) => (
          <label key={key} className="mod-choice">
            {key}
            <input
              className="mod-input"
              type="number"
              min={range.min}
              max={range.max}
              value={limits[key] ?? range.def}
              onChange={(e) => {
                setLimits({ ...limits, [key]: Number(e.target.value) });
                setSaved(false);
              }}
            />
          </label>
        ))}
      </div>

      <div className="mod-form-row">
        <button
          type="button"
          className="mod-go"
          disabled={busy || over}
          onClick={save}
        >
          {busy ? 'Publishing…' : 'Publish to your repo'}
        </button>
        <button
          type="button"
          className="mod-ghost"
          disabled={busy || (!style && !guidance)}
          onClick={() => {
            setStyle('');
            setGuidance('');
            setSaved(false);
          }}
        >
          Clear to default
        </button>
        {saved && (
          <span className="mod-choice">Published — next message uses it</span>
        )}
      </div>

      <details>
        <summary>The default voice, for reference</summary>
        <pre className="mod-row-why">{fallback}</pre>
      </details>
    </div>
  );
}

/**
 * Retiring the old list, once something else holds the blocks.
 *
 * The guard is the whole panel. Deleting a block list that nothing has replaced
 * is how a block list quietly stops blocking, and the failure is invisible:
 * nothing errors, the accounts simply come back. So the button stays disabled
 * until the server has compared SUBJECTS between the two lists, not counts. A
 * matching total with a different membership would pass a count and lose people.
 */
export function RetirePanel({ agent, listUri }) {
  const [target, setTarget] = useState('');
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    let live = true;
    migrateStatus(agent)
      .then((r) => live && setTarget(r.migration?.target_list || ''))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [agent]);

  const check = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setStatus(
        await retireStatus(agent, {
          sourceList: listUri,
          targetList: target,
          onProgress: (p) =>
            setProgress({ scanning: `${p.phase}: ${p.scanned}` }),
        }),
      );
      setProgress(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [agent, listUri, target]);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    setProgress(null);
    try {
      const out = await retireList(agent, {
        sourceList: listUri,
        sourceBlockUri: status?.sourceBlockUri,
        onProgress: setProgress,
      });
      setProgress(out);
      await check();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [agent, listUri, status, check]);

  const blocked = status && !status.subscribedToTarget;
  const gap = status?.missing?.length || 0;
  const ready = status && !blocked && (!gap || acknowledged);

  return (
    <div className="mod-studio">
      {error && <p className="mod-error">{error}</p>}
      <p className="mod-verdict">
        Delete the old list from your own repo, once the new one is holding the
        blocks. Runs in your browser, signed by your session.
      </p>

      <div className="mod-form-row">
        <input
          className="mod-input"
          type="text"
          value={target}
          placeholder="at:// the list that replaces it"
          spellCheck="false"
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Replacement list URI"
        />
        <button
          type="button"
          className="mod-ghost"
          disabled={busy || !target}
          onClick={check}
        >
          Check coverage
        </button>
      </div>

      {status && (
        <>
          <p className="mod-summary-line">
            Old list: {num(status.source.records)} items for{' '}
            {num(status.source.accounts)} accounts
            {status.source.duplicates > 0 &&
              ` (${num(status.source.duplicates)} duplicates)`}
          </p>
          <p className="mod-summary-line">
            New list: {num(status.target.accounts)} accounts
          </p>

          {blocked && (
            <p className="mod-warn">
              You are not subscribed to the new list. Deleting the old one now
              would unblock everyone on it. Subscribe first.
            </p>
          )}

          {gap > 0 && (
            <>
              <p className="mod-warn">
                {num(gap)} accounts are on the old list and not on the new one.
                Deleting drops their block.
              </p>
              <label className="mod-choice">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                />
                I know, delete anyway
              </label>
            </>
          )}

          {!gap && !blocked && (
            <p className="mod-summary-line">
              Every account on the old list is on the new one. Safe to delete.
            </p>
          )}

          <p className="mod-summary-line">
            {num(status.points)} deletes. One point each against 5,000/hour, and
            one repo event each against the relay&apos;s 2,600/hour for your
            whole PDS, so this takes a few sittings.
          </p>

          <div className="mod-form-row">
            <button
              type="button"
              className="mod-go"
              disabled={busy || !ready}
              onClick={run}
            >
              {busy ? 'Deleting…' : `Delete up to 2,000`}
            </button>
          </div>
        </>
      )}

      {progress && (
        <p className="mod-summary-line">
          {progress.scanning
            ? `Scanning ${progress.scanning}`
            : `${num(progress.removed)} removed`}
          {progress.remaining ? `, ${num(progress.remaining)} left` : ''}
          {progress.rateLimited &&
            ' — hit the rate limit, try again in an hour'}
          {progress.done && ' — list deleted'}
        </p>
      )}
    </div>
  );
}
