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
  hubOverview,
  whyListed,
  listMembers,
  getAgentConfig,
  setAgentConfig,
  CONFIG_NSID,
  BAND_META,
  planList,
  planDetail,
  planAdd,
  planUndo,
} from '../lib/moderation/client.js';
import { BANDS } from '../lib/moderation/score.js';

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
  const [report, setReport] = useState('');
  const [reportDefault, setReportDefault] = useState('');
  const [postReport, setPostReport] = useState('');
  const [postDefault, setPostDefault] = useState('');
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
        setReport(r.config?.report || '');
        setReportDefault(r.default?.report || '');
        setPostReport(r.config?.postReport || '');
        setPostDefault(r.default?.postReport || '');
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
        report,
        postReport,
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
  }, [agent, style, guidance, openers, report, postReport, model, limits]);

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
        Account report. Rendered from this template with no model call, so a
        lookup is instant and the same shape every time. Variables:{' '}
        <code>
          {'{displayName} {handle} {band} {distance} {relationship} {vouches} '}
          {'{followers} {ageDays} {postsPerDay} {lists} {trust} {posts}'}
        </code>
      </p>
      <textarea
        className="mod-input"
        rows={10}
        value={report}
        placeholder={reportDefault}
        spellCheck="false"
        onChange={(e) => {
          setReport(e.target.value);
          setSaved(false);
        }}
        aria-label="Account report template"
      />

      <p className="mod-summary-line">
        Post scan. Also rendered with no model call. Variables:{' '}
        <code>
          {'{uri} {code} {participants} {engagements} {needsLook} {truncated} '}
          {'{PROTECTED} {CONNECTED} {PERIPHERAL} {NOTABLE} {UNKNOWN}'}
        </code>
      </p>
      <textarea
        className="mod-input"
        rows={10}
        value={postReport}
        placeholder={postDefault}
        spellCheck="false"
        onChange={(e) => {
          setPostReport(e.target.value);
          setSaved(false);
        }}
        aria-label="Post scan template"
      />

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
 * Is any of this healthy, and what has it cost.
 *
 * Until now the only way to know whether the snapshot was stale, the bot's
 * session alive or the spend reasonable was to go and ask the database. A
 * system that decides who gets blocked should be able to say how it is doing.
 */
export function OverviewPanel({ agent }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    hubOverview(agent)
      .then((r) => live && setData(r))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [agent]);

  if (error) return <p className="mod-error">{error}</p>;
  if (!data) return <p className="mod-summary-line">Reading…</p>;

  const stale = data.snapshot.ageHours != null && data.snapshot.ageHours > 48;

  return (
    <div className="mod-studio">
      <p className="mod-verdict">
        {num(data.snapshot.scored)} accounts scored against{' '}
        {num(data.snapshot.protected)} protected, from a snapshot{' '}
        {data.snapshot.ageHours}h old.
      </p>
      {stale && (
        <p className="mod-warn">
          That snapshot is over two days old. Bands are computed from it, so
          anyone whose connections changed since is being scored on the old
          graph.
        </p>
      )}
      <p className="mod-summary-line">List: {data.list}</p>
      <p className="mod-summary-line">
        Bot: {data.bot?.handle ?? 'no session'}
        {data.bot?.refreshed_at &&
          `, session refreshed ${new Date(data.bot.refreshed_at).toLocaleString()}`}
      </p>
      <p className="mod-summary-line">
        {num(data.plans)} plans, {num(data.decisions)} decisions recorded.
      </p>
      <p className="mod-summary-line">
        {num(data.calls)} model calls, {num(data.tokens.input)} in /{' '}
        {num(data.tokens.output)} out.
      </p>

      <p className="mod-summary-line">Recent audits</p>
      <ul className="mod-list">
        {data.audits.map((a) => (
          <li key={a.id}>
            <span className="mod-row-handle">
              {new Date(a.started_at).toLocaleString()}
            </span>{' '}
            — {num(a.scored)} of {num(a.total)}
            {!a.total && ' (scored nothing; the list was empty or gone)'}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Why is this account on the list?
 *
 * The question the whole system exists to answer. `approved_via` is the part
 * that matters: "you were in a category dame approved" and "dame read your
 * profile and decided" are different answers, and the record could not tell
 * them apart until recently.
 */
export function WhyPanel({ agent }) {
  const [actor, setActor] = useState('');
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const look = useCallback(async () => {
    setBusy(true);
    setError(null);
    setData(null);
    try {
      setData(await whyListed(agent, actor));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [agent, actor]);

  return (
    <div className="mod-studio">
      {error && <p className="mod-error">{error}</p>}
      <p className="mod-verdict">
        Everything recorded about one account: how it was banded, which plan
        carried it, and whether that was a band approval or a personal decision.
      </p>
      <div className="mod-form-row">
        <input
          className="mod-input"
          type="text"
          value={actor}
          placeholder="handle or did"
          spellCheck="false"
          autoComplete="off"
          onChange={(e) => setActor(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && actor && look()}
          aria-label="Account"
        />
        <button
          type="button"
          className="mod-go"
          disabled={busy || !actor}
          onClick={look}
        >
          {busy ? 'Looking…' : 'Look up'}
        </button>
      </div>

      {data && (
        <>
          <p className="mod-summary-line">{data.did}</p>
          {data.protected && (
            <p className="mod-warn">
              PROTECTED ({data.protected.reason}). No automated path may act on
              them.
            </p>
          )}
          {!data.decisions.length && !data.audits.length && (
            <p className="mod-empty">
              Nothing recorded. This account has never been through the gate.
            </p>
          )}
          {data.decisions.map((d) => {
            const plan = data.plans.find((p) => p.id === d.plan_id);
            return (
              <div key={`${d.plan_id}-${d.did}`} className="mod-row-why">
                <strong>{d.band}</strong>
                {d.vouches != null && ` · ${d.vouches} vouches`}
                {d.trust != null && ` · trust ${d.trust}`}
                {d.action && ` · ${d.action}`}
                {d.approved_via && ` · via ${d.approved_via}`}
                {d.acted_at && ` · ${new Date(d.acted_at).toLocaleString()}`}
                {plan?.note && <div>“{plan.note}”</div>}
                {plan?.approved_bands?.length > 0 && (
                  <div>Bands approved: {plan.approved_bands.join(', ')}</div>
                )}
              </div>
            );
          })}
          {data.audits.map((a) => (
            <div key={a.audit_id} className="mod-row-why">
              Audit · {a.band}
              {a.vouches != null && ` · ${a.vouches} vouches`}
              {a.decision ? ` · you chose ${a.decision}` : ' · not reviewed'}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** A window onto the list itself, which there has never been one of. */
export function ListPanel({ agent }) {
  const [page, setPage] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(
    async (cursor) => {
      setBusy(true);
      setError(null);
      try {
        const r = await listMembers(agent, { cursor });
        setPage(r);
        setRows((prev) => (cursor ? [...prev, ...r.items] : r.items));
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [agent],
  );

  useEffect(() => {
    load();
  }, [load]);

  const shown = filter
    ? rows.filter((r) =>
        `${r.handle} ${r.displayName ?? ''}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
      )
    : rows;

  return (
    <div className="mod-studio">
      {error && <p className="mod-error">{error}</p>}
      <p className="mod-verdict">
        {page?.list?.name ?? 'The list'} — {num(rows.length)} loaded
        {page?.cursor ? ', more available' : ''}
      </p>
      <div className="mod-form-row">
        <input
          className="mod-input"
          type="text"
          value={filter}
          placeholder="filter what is loaded"
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter"
        />
        <button
          type="button"
          className="mod-ghost"
          disabled={busy || !page?.cursor}
          onClick={() => load(page.cursor)}
        >
          {busy ? 'Loading…' : 'Load more'}
        </button>
      </div>
      <ul className="mod-list">
        {shown.map((r) => (
          <li key={r.did}>
            <span className="mod-row-handle">@{r.handle}</span>
            {r.displayName ? ` — ${r.displayName}` : ''}
            {r.followers != null ? ` · ${num(r.followers)} followers` : ''}
          </li>
        ))}
      </ul>
      {!shown.length && !busy && <p className="mod-empty">Nothing matches.</p>}
    </div>
  );
}

/**
 * One plan, in depth.
 *
 * THE DM'S COUNTERPART, not its replacement. A chat bubble can show ten quotes
 * as a spot check before a bulk action and it cannot show 231, because nobody
 * reads 231 of anything in a DM -- and a menu implying otherwise is the failure
 * this whole system was built against. So the DM stays where you act quickly and
 * this is where you look properly. Same rows, same table.
 *
 * Trust descending throughout, as in the audit queue and the DM review: the
 * accounts most embedded in dame's world first, so attention running out halfway
 * down runs out in the right place.
 *
 * Ticking accounts and adding them records `individual`, not a band or a label,
 * because on this screen that is what actually happened -- somebody read them.
 */
export function PlansPanel({ agent }) {
  const [list, setList] = useState(null);
  const [code, setCode] = useState(null);
  const [data, setData] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [label, setLabel] = useState('');
  const [band, setBand] = useState('');
  const [state, setState] = useState('pending');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    planList(agent)
      .then((r) => live && setList(r.plans))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [agent]);

  const load = useCallback(
    async (next = {}) => {
      setBusy(true);
      setError(null);
      try {
        const r = await planDetail(agent, {
          code: next.code ?? code,
          label: next.label ?? label,
          band: next.band ?? band,
          state: next.state ?? state,
          offset: next.offset ?? 0,
        });
        setData(r);
        setPicked(new Set());
      } catch (e) {
        setError(e.message);
      } finally {
        setBusy(false);
      }
    },
    [agent, code, label, band, state],
  );

  const open = (c) => {
    setCode(c);
    setData(null);
    load({ code: c, offset: 0 });
  };

  const toggle = (did) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(did)) next.delete(did);
      else next.add(did);
      return next;
    });

  const addPicked = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await planAdd(agent, { code, dids: [...picked] });
      setNote(r.message || `Added ${r.added}.`);
      await load({ offset: data?.offset ?? 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const undoAll = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await planUndo(agent, { code });
      setNote(r.message || 'Undone.');
      await load({ offset: 0 });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!code) {
    return (
      <div className="mod-studio">
        {error && <p className="mod-error">{error}</p>}
        <p className="mod-verdict">
          Every batch this system has proposed, and what became of it. Open one
          to read each account beside the words it was labelled on.
        </p>
        {!list && <p className="mod-empty">Loading…</p>}
        {list?.length === 0 && <p className="mod-empty">No plans yet.</p>}
        <ul className="mod-list">
          {(list || []).map((p) => (
            <li key={p.code}>
              <div className="mod-row-head">
                <button
                  type="button"
                  className="mod-row-handle mod-linkish"
                  onClick={() => open(p.code)}
                >
                  {p.code}
                </button>
                <span>
                  {p.accounts} accounts
                  {p.added ? `, ${p.added} on the list` : ''}
                  {p.undone ? `, ${p.undone} undone` : ''}
                </span>
              </div>
              <p className="mod-row-why">
                {p.note || 'no note'}
                {p.labelled
                  ? ` — read: ${p.hostile} hostile, ${p.arguing} arguing, ${p.neutral} neutral`
                  : ''}
              </p>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mod-studio">
      {error && <p className="mod-error">{error}</p>}
      {note && <p className="mod-summary-line">{note}</p>}

      <div className="mod-form-row">
        <button
          type="button"
          className="mod-ghost"
          onClick={() => setCode(null)}
        >
          ← All plans
        </button>
        <span className="mod-summary-line">{code}</span>
      </div>

      {data && (
        <>
          <p className="mod-verdict">
            {data.counts.total} accounts, {data.counts.added} on the list now,{' '}
            {data.counts.labelled} read by a model. {data.byLabel.hostile}{' '}
            hostile, {data.byLabel.arguing} arguing, {data.byLabel.neutral}{' '}
            neutral
            {data.byLabel.gone ? `, ${data.byLabel.gone} deleted` : ''}.
          </p>
          <p className="mod-row-why">
            A label is a model reading somebody&apos;s post. It is not a band,
            it cannot change one, and the sentence it was read from is printed
            beside it so you can disagree with it.
          </p>

          <div className="mod-form-row">
            <select
              className="mod-input"
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                load({ state: e.target.value, offset: 0 });
              }}
              aria-label="Status"
            >
              <option value="pending">Not on the list</option>
              <option value="added">Already added</option>
              <option value="all">Everyone</option>
            </select>
            <select
              className="mod-input"
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                load({ label: e.target.value, offset: 0 });
              }}
              aria-label="Label"
            >
              <option value="">Any label</option>
              <option value="hostile">Hostile</option>
              <option value="arguing">Arguing</option>
              <option value="neutral">Neutral</option>
            </select>
            <select
              className="mod-input"
              value={band}
              onChange={(e) => {
                setBand(e.target.value);
                load({ band: e.target.value, offset: 0 });
              }}
              aria-label="Band"
            >
              <option value="">Any band</option>
              {BANDS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>

          <div className="mod-form-row">
            <span className="mod-summary-line">
              {data.matched} match, showing {data.rows.length} from{' '}
              {data.offset + 1}. Most connected first.
            </span>
            <button
              type="button"
              className="mod-go"
              disabled={busy || !picked.size}
              onClick={addPicked}
            >
              {busy ? 'Working…' : `Add ${picked.size} ticked`}
            </button>
            <button
              type="button"
              className="mod-ghost"
              disabled={busy || !data.counts.added}
              onClick={undoAll}
            >
              Undo all {data.counts.added}
            </button>
          </div>

          <ul className="mod-list">
            {data.rows.map((r) => (
              <li key={r.did}>
                <div className="mod-row-head">
                  <label className="mod-row-handle">
                    <input
                      type="checkbox"
                      checked={picked.has(r.did)}
                      disabled={r.added || r.band === 'PROTECTED'}
                      onChange={() => toggle(r.did)}
                    />{' '}
                    @{r.handle || r.did}
                  </label>
                  <span>
                    {r.band}
                    {r.trust != null ? ` · trust ${r.trust}` : ''}
                    {r.vouches ? ` · ${r.vouches} vouches` : ''}
                    {r.triage ? ` · ${r.triage}` : ''}
                    {r.added ? ` · on the list (${r.approvedVia || '?'})` : ''}
                  </span>
                </div>
                {r.quote && (
                  <p className="mod-row-why">&ldquo;{r.quote}&rdquo;</p>
                )}
              </li>
            ))}
          </ul>

          <div className="mod-form-row">
            <button
              type="button"
              className="mod-ghost"
              disabled={busy || !data.offset}
              onClick={() =>
                load({ offset: Math.max(0, data.offset - data.pageSize) })
              }
            >
              ← Back
            </button>
            <button
              type="button"
              className="mod-ghost"
              disabled={busy || data.offset + data.pageSize >= data.matched}
              onClick={() => load({ offset: data.offset + data.pageSize })}
            >
              More →
            </button>
          </div>
        </>
      )}
    </div>
  );
}
