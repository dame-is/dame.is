// Is the system healthy, what has it cost, and how does the bot write.
//
// Health is three questions with a button each: is the scoring snapshot fresh
// (rebuild it), when was the list last re-scored (re-score it now), is the bot
// signed in. Spend is priced at today's gateway rates. The voice is the config
// record in dame's own repo, which the bot reads and cannot change.

import { useEffect, useState } from 'react';
import {
  CONFIG_NSID,
  auditRun,
  getAgentConfig,
  hubOverview,
  precomputeStatus,
  setAgentConfig,
} from '../../lib/moderation/client.js';
import {
  ErrorNote,
  Skeleton,
  compact,
  fmt,
  invalidate,
  timeAgo,
  usd,
  useCached,
  useToast,
} from './ui.jsx';

function Health({ agent, data, reload }) {
  const toast = useToast();
  const [building, setBuilding] = useState(null);
  const [scoring, setScoring] = useState(null);

  const rebuild = async () => {
    setBuilding('starting…');
    try {
      let last = null;
      for (let i = 0; i < 40; i += 1) {
        last = await precomputeStatus(agent);
        setBuilding(
          last.state === 'collecting'
            ? `reading · ${fmt(last.remaining ?? 0)} accounts left`
            : last.state === 'finalising'
              ? 'aggregating…'
              : 'done',
        );
        if (last.state !== 'collecting' && last.state !== 'finalising') break;
      }
      toast('Reference data is up to date');
      reload();
    } catch (err) {
      toast(`Rebuild failed: ${err.message}`, { tone: 'danger' });
    } finally {
      setBuilding(null);
    }
  };

  const rescore = async () => {
    setScoring('starting…');
    try {
      let r = await auditRun(agent, { listUri: data.list, start: true });
      for (let i = 0; i < 40 && r.state !== 'finished'; i += 1) {
        setScoring(`scored ${fmt(r.scored ?? 0)}`);
        r = await auditRun(agent);
      }
      invalidate('queue:');
      toast(`Re-scored ${fmt(r.scored ?? r.audit?.scored ?? 0)} accounts`);
      reload();
    } catch (err) {
      toast(`Re-score failed: ${err.message}`, { tone: 'danger' });
    } finally {
      setScoring(null);
    }
  };

  const snap = data.snapshot;
  const stale = snap.ageHours != null && snap.ageHours > 48;
  const audit = (data.audits || []).find((a) => a.total > 0);
  const session = data.bot?.refreshed_at;

  return (
    <div className="mh-health">
      <article className={`mh-health-card${stale ? ' is-warn' : ''}`}>
        <h3 className="mh-label">Scoring snapshot</h3>
        <p className="mh-health-big">
          {snap.ageHours != null ? `${snap.ageHours}h old` : 'missing'}
        </p>
        <p className="mh-small">
          {fmt(snap.scored)} accounts scored, {fmt(snap.protected)} protected.
          {stale &&
            ' Bands are computed from this, so anyone whose connections changed since is scored on the old graph.'}
        </p>
        <button
          type="button"
          className="mh-button"
          disabled={Boolean(building)}
          onClick={rebuild}
        >
          {building ? `Rebuilding: ${building}` : 'Rebuild now'}
        </button>
      </article>

      <article className="mh-health-card">
        <h3 className="mh-label">List re-score</h3>
        <p className="mh-health-big">
          {audit ? timeAgo(audit.finished_at || audit.started_at) : 'never'}
        </p>
        <p className="mh-small">
          {audit ? `${fmt(audit.scored)} accounts. ` : ''}The droplet re-scores
          the whole list weekly; the queue is built from the latest one.
        </p>
        <button
          type="button"
          className="mh-button"
          disabled={Boolean(scoring)}
          onClick={rescore}
        >
          {scoring ? `Re-scoring: ${scoring}` : 'Re-score now'}
        </button>
      </article>

      <article className="mh-health-card">
        <h3 className="mh-label">The bot</h3>
        <p className="mh-health-big">@{data.bot?.handle || 'no session'}</p>
        <p className="mh-small">
          {session
            ? `Session refreshed ${timeAgo(session)}.`
            : 'No stored session.'}{' '}
          It owns the list and answers your DMs.
        </p>
      </article>
    </div>
  );
}

function Spend({ cost }) {
  if (!cost) return null;
  return (
    <div className="mh-spend">
      <div className="mh-spend-totals">
        <p>
          <span className="mh-health-big">{usd(cost.week)}</span>
          <span className="mh-small"> this week</span>
        </p>
        <p>
          <span className="mh-health-big">{usd(cost.total)}</span>
          <span className="mh-small"> all time</span>
        </p>
      </div>
      <table className="mh-table">
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Calls</th>
            <th scope="col">Tokens</th>
            <th scope="col">Cost</th>
          </tr>
        </thead>
        <tbody>
          {cost.models.map((m) => (
            <tr key={m.model}>
              <td className="mh-code">{m.model}</td>
              <td>{fmt(m.calls)}</td>
              <td>{compact(m.input + m.output)}</td>
              <td>{cost.priced ? usd(m.usd) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mh-small mh-muted">
        Estimated from recorded token counts at today&apos;s gateway prices.
        Cache discounts and reasoning tokens are not in the counts.
      </p>
    </div>
  );
}

function Voice({ agent }) {
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let live = true;
    getAgentConfig(agent)
      .then((r) => {
        if (!live) return;
        setCfg(r);
        const c = r.config || {};
        setForm({
          style: c.style || '',
          guidance: c.guidance || '',
          openers: c.openers || '',
          report: c.report || '',
          postReport: c.postReport || '',
          model: c.model || '',
          limits: c.limits || {},
        });
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
  }, [agent]);

  if (error) return <ErrorNote error={error} />;
  if (!cfg) return <Skeleton rows={3} avatar={false} />;

  const max = cfg.maxChars || 2000;
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setDirty(true);
  };
  const over = ['style', 'guidance', 'openers'].some(
    (k) => (form[k] || '').length > max,
  );

  const save = async () => {
    setBusy(true);
    try {
      const r = await setAgentConfig(agent, form);
      setCfg((c) => ({ ...c, config: r.config }));
      setDirty(false);
      toast('Published. The next message uses it.');
    } catch (e) {
      toast(e.message, { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  const field = (k, label, help, rows = 4, placeholder = '') => (
    <label className="mh-field">
      <span className="mh-field-label">{label}</span>
      {help && <span className="mh-small mh-muted">{help}</span>}
      <textarea
        className="mh-input"
        rows={rows}
        value={form[k] || ''}
        placeholder={placeholder}
        onChange={set(k)}
        spellCheck={k === 'report' || k === 'postReport' ? 'false' : 'true'}
      />
      {['style', 'guidance', 'openers'].includes(k) && (
        <span
          className={`mh-small ${(form[k] || '').length > max ? 'mh-danger-text' : 'mh-muted'}`}
        >
          {fmt((form[k] || '').length)} / {fmt(max)}
        </span>
      )}
    </label>
  );

  return (
    <div className="mh-voice">
      <p className="mh-small">
        Published as <code className="mh-code">{CONFIG_NSID}</code> in your own
        repo, signed by your session. The bot reads it and cannot change it.{' '}
        {cfg.config
          ? cfg.config.source === 'pds'
            ? `Live from your repo${cfg.config.updated_at ? `, updated ${timeAgo(cfg.config.updated_at)}` : ''}.`
            : 'Showing the cached copy; the record could not be read.'
          : 'No record yet, so the bot runs on its built-in defaults.'}
      </p>
      {field('style', 'Voice', 'How it writes.', 5, cfg.default?.style)}
      {field(
        'guidance',
        'Standing instructions',
        'Followed every turn. They add to the rules; they cannot remove what the bands mean.',
        5,
        'e.g. always mention how often they post',
      )}
      {field(
        'openers',
        'Openers',
        'One per line. What the non-model replies greet with.',
        4,
        'Acknowledged.\nOn it.',
      )}
      <details className="mh-details">
        <summary>Report templates, model and budgets</summary>
        {field(
          'report',
          'Account report',
          'Variables: {displayName} {handle} {band} {distance} {relationship} {vouches} {followers} {ageDays} {postsPerDay} {lists} {trust} {posts}',
          8,
          cfg.default?.report,
        )}
        {field(
          'postReport',
          'Post scan',
          'Variables: {uri} {code} {participants} {engagements} {needsLook} {truncated} {PROTECTED} {CONNECTED} {PERIPHERAL} {NOTABLE} {UNKNOWN}',
          8,
          cfg.default?.postReport,
        )}
        <label className="mh-field">
          <span className="mh-field-label">Analyst model</span>
          <span className="mh-small mh-muted">
            Blank uses what the droplet is configured with.
          </span>
          <input
            className="mh-input"
            value={form.model || ''}
            onChange={set('model')}
            placeholder="deepseek/deepseek-v4.1-flash"
            spellCheck="false"
          />
        </label>
        <div className="mh-limits">
          {Object.entries(cfg.limitSpec || {}).map(([k, range]) => (
            <label key={k} className="mh-field">
              <span className="mh-field-label">{k}</span>
              <input
                className="mh-input"
                type="number"
                min={range.min}
                max={range.max}
                value={form.limits?.[k] ?? range.def}
                onChange={(e) => {
                  setForm((f) => ({
                    ...f,
                    limits: { ...f.limits, [k]: Number(e.target.value) },
                  }));
                  setDirty(true);
                }}
              />
            </label>
          ))}
        </div>
      </details>
      <div className="mh-form-row">
        <button
          type="button"
          className="mh-button mh-button--primary"
          disabled={busy || over || !dirty}
          onClick={save}
        >
          {busy ? 'Publishing…' : 'Publish to your repo'}
        </button>
      </div>
    </div>
  );
}

export default function SettingsView({ agent }) {
  const { data, error, loading, reload } = useCached(
    'overview',
    () => hubOverview(agent),
    {
      staleMs: 30_000,
    },
  );
  return (
    <section className="mh-view" aria-label="Settings">
      <h2 className="mh-section-title">Health</h2>
      {loading && <Skeleton rows={2} avatar={false} />}
      <ErrorNote error={error} onRetry={reload} />
      {data && <Health agent={agent} data={data} reload={reload} />}

      <h2 className="mh-section-title">Spend</h2>
      {data && <Spend cost={data.cost} />}

      <h2 className="mh-section-title">How the bot writes</h2>
      <Voice agent={agent} />
    </section>
  );
}
