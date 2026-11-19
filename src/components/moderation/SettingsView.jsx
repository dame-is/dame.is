// Is the bot healthy, what has it used, and how is it set up.
//
// Health is three questions, with a button for the two the owner can act on:
// is the scoring snapshot fresh (rebuild it), when was the list last
// re-scored (re-score it now), and is the bot answering. How the bot writes is
// its config file, config/bot.json on the server, mounted read-only so the bot
// cannot rewrite its own instructions; this page shows it and nothing more.

import { useState } from 'react';
import Button from '../Button.jsx';
import Figures from '../Figures.jsx';
import SectionHead from '../SectionHead.jsx';
import Time from '../Time.jsx';
import {
  rebuildSnapshot,
  rescoreList,
  settingsPage,
} from '../../lib/moderation/client.js';
import { useHub } from './hub.jsx';
import {
  ErrorNote,
  SNAPSHOT_STALE_HOURS,
  Skeleton,
  compact,
  fmt,
  invalidate,
  useCached,
  useToast,
} from './ui.jsx';

const gb = (n) =>
  typeof n === 'number' ? `${(n / 1024 ** 3).toFixed(1)} GB` : '—';

function Health({ agent, health, graph, reload }) {
  const toast = useToast();
  const { isOwner } = useHub();
  const [asked, setAsked] = useState({ rebuild: false, rescore: false });

  const start = (what, fn, said) => async () => {
    setAsked((a) => ({ ...a, [what]: true }));
    try {
      const r = await fn(agent);
      toast(r.started ? said : r.reason || 'It did not start.', {
        tone: r.started ? 'plain' : 'danger',
      });
      if (r.started) invalidate('overview');
      reload();
    } catch (err) {
      toast(err.message, { tone: 'danger' });
      setAsked((a) => ({ ...a, [what]: false }));
    }
  };

  const snap = graph.snapshot;
  const ageHours = snap
    ? Math.round((Date.now() - Date.parse(snap.takenAt)) / 3_600_000)
    : null;
  const stale = ageHours != null && ageHours > SNAPSHOT_STALE_HOURS;
  const building = graph.newest?.building;
  // A finished run only: a re-score writes its row before it starts scoring.
  const audit = (graph.audits || []).find((a) => a.finishedAt && a.total > 0);

  return (
    <div className="mh-health">
      <article className="mh-health-card">
        <h3 className="mh-label eyebrow">Scoring snapshot</h3>
        <p className="mh-health-big">
          {snap
            ? ageHours < 48
              ? `${ageHours}h old`
              : `${Math.round(ageHours / 24)} days old`
            : 'not built yet'}
          {stale && <span className="mh-health-warn"> · stale</span>}
        </p>
        <p className="mh-small">
          {snap && `${fmt(snap.vouches)} accounts with shared follows, `}
          {fmt(graph.protected?.total ?? 0)} protected.
          {building &&
            ` A new one is being read: ${fmt(graph.newest.circle - graph.newest.pending)} of ${fmt(graph.newest.circle)} follows done.`}
          {stale &&
            !building &&
            ' Bands come from this, so anyone whose connections changed since is scored on the old graph.'}
        </p>
        {isOwner && (
          <Button
            size="sm"
            disabled={asked.rebuild || building}
            onClick={start(
              'rebuild',
              rebuildSnapshot,
              'Rebuilding. It reads between DMs and takes a few minutes.',
            )}
          >
            {building ? 'Rebuilding…' : 'Rebuild now'}
          </Button>
        )}
      </article>

      <article className="mh-health-card">
        <h3 className="mh-label eyebrow">List re-score</h3>
        <p className="mh-health-big">
          {audit ? (
            <Time value={audit.finishedAt} variant="relative" />
          ) : (
            'never'
          )}
        </p>
        <p className="mh-small">
          {audit ? `${fmt(audit.scored)} accounts. ` : ''}The bot re-scores the
          whole list weekly and DMs you what moved; the queue is built from the
          latest one.
        </p>
        {isOwner && (
          <Button
            size="sm"
            disabled={asked.rescore}
            onClick={start(
              'rescore',
              rescoreList,
              'Re-scoring. The bot will DM you what moved.',
            )}
          >
            {asked.rescore ? 'Asked' : 'Re-score now'}
          </Button>
        )}
      </article>

      <article className="mh-health-card">
        <h3 className="mh-label eyebrow">The bot</h3>
        <p className="mh-health-big">
          @{health.bot?.handle || 'not signed in'}
        </p>
        <p className="mh-small">
          {health.lastPollAt ? (
            <>
              Read its DMs <Time value={health.lastPollAt} variant="relative" />
              , {fmt(health.dmAnswers ?? 0)} answered since it started{' '}
              <Time value={health.startedAt} variant="relative" />.
            </>
          ) : (
            'Not reading DMs yet.'
          )}
          {health.dryRun && ' Dry run: it reads no DMs and writes nothing.'}
          {health.disk &&
            ` ${gb(health.disk.free)} of disk free${health.disk.low ? ', which is low' : ''}.`}
          {health.database?.kind && ` Data in ${health.database.kind}.`}
        </p>
      </article>
    </div>
  );
}

function Usage({ models }) {
  if (!models) return null;
  const m = models.models;
  return (
    <div className="mh-spend">
      <Figures
        layout="inline"
        label="Model use"
        items={[
          {
            key: 'calls',
            label: 'Calls, 30 days',
            value: fmt(models.total?.calls ?? 0),
          },
          {
            key: 'tokens',
            label: 'Tokens, 30 days',
            value: compact(
              (models.total?.input ?? 0) + (models.total?.output ?? 0),
            ),
          },
        ]}
      />
      {models.byModel?.length > 0 && (
        <table className="mh-table">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Calls</th>
              <th scope="col">Tokens</th>
            </tr>
          </thead>
          <tbody>
            {models.byModel.map((row) => (
              <tr key={row.name}>
                <td className="ident">{row.name}</td>
                <td>{fmt(row.calls)}</td>
                <td>{compact(row.input + row.output)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mh-small mh-muted">
        {m
          ? `Answers on ${m.agent}${m.escalation && m.escalation !== 'off' ? `, with ${m.escalation} as the second reader` : ''}, in ${models.mode} mode, through ${models.provider}. `
          : 'No model is set up, so the bot answers commands only. '}
        Token counts are what the provider reported; the bot does not price
        them.
      </p>
    </div>
  );
}

const FILE_FIELDS = [
  ['style', 'Voice'],
  ['guidance', 'Standing instructions'],
  ['model', 'Model'],
  ['barePost', 'A post sent with no words'],
];

function Config({ settings }) {
  const file = settings?.file;
  return (
    <div className="mh-voice">
      <p className="mh-small">
        The bot reads these from <code className="ident">config/bot.json</code>{' '}
        on its server. The file is mounted read-only, so the bot cannot change
        its own instructions; edit it there and restart the bot.
      </p>
      {!file && (
        <p className="mh-small mh-muted">
          No config file, so the bot runs on its built-in defaults.
        </p>
      )}
      {file && (
        <dl className="mh-config">
          {FILE_FIELDS.filter(([k]) => file[k]).map(([k, label]) => (
            <div key={k} className="mh-config-row">
              <dt className="mh-field-label eyebrow">{label}</dt>
              <dd>
                {file[k] === 'author'
                  ? 'Block whoever wrote it'
                  : file[k] === 'card'
                    ? 'Show the card'
                    : String(file[k])}
              </dd>
            </div>
          ))}
          {file.limits && (
            <div className="mh-config-row">
              <dt className="mh-field-label eyebrow">Limits</dt>
              <dd className="ident">
                {Object.entries(file.limits)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(' · ')}
              </dd>
            </div>
          )}
          {['openers', 'report', 'postReport'].some((k) => file[k]) && (
            <div className="mh-config-row">
              <dt className="mh-field-label eyebrow">Also set</dt>
              <dd>
                {[
                  file.openers && 'openers',
                  file.report && 'an account report template',
                  file.postReport && 'a post scan template',
                ]
                  .filter(Boolean)
                  .join(', ')}
              </dd>
            </div>
          )}
        </dl>
      )}
      <p className="mh-small mh-muted">
        {settings.mode === 'agent' ? 'Agent mode' : 'Classic mode'},{' '}
        {settings.scoring} scoring
        {settings.multiList ? ', several lists' : ''}. Set in the bot&apos;s
        environment.
      </p>
    </div>
  );
}

export default function SettingsView({ agent }) {
  const { data, error, loading, reload } = useCached(
    'settings',
    () => settingsPage(agent),
    { staleMs: 30_000 },
  );
  return (
    <section className="mh-view" aria-label="Settings">
      <SectionHead title="Health" className="mh-section-head" />
      {loading && <Skeleton rows={2} avatar={false} />}
      <ErrorNote error={error} onRetry={reload} />
      {data && (
        <Health
          agent={agent}
          health={data.health}
          graph={data.graph}
          reload={reload}
        />
      )}

      <SectionHead title="Model use" className="mh-section-head" />
      {data && <Usage models={data.models} />}

      <SectionHead title="How the bot is set up" className="mh-section-head" />
      {data && <Config settings={data.settings} />}
    </section>
  );
}
