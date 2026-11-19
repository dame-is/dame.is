// The shield: who may reply to and quote your own posts when strangers pile
// on, and attack mode, which closes every recent post at once.
//
// Read from the bot (GET /api/shield). Every action is one of the bot's own
// shield commands, run as a DM's would be, so only the account it works for
// can take one, and the bot puts back exactly what it changed.

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { postLink } from 'bluesky-mod-client';
import Button from '../Button.jsx';
import SectionHead from '../SectionHead.jsx';
import Time from '../Time.jsx';
import { shieldState } from '../../lib/moderation/client.js';
import { useCommand, useHub } from './hub.jsx';
import {
  Empty,
  ErrorNote,
  Skeleton,
  Tag,
  fmt,
  useCached,
  useToast,
} from './ui.jsx';

/** "12 in 15 minutes" */
function rate(r) {
  if (!r) return 'off';
  const m = Math.round(r.windowMs / 60_000);
  return `${fmt(r.count)} in ${m % 60 === 0 ? `${m / 60} ${m === 60 ? 'hour' : 'hours'}` : `${m} minutes`}`;
}

/** What attack mode does when it trips. */
const MODE_WORDS = {
  off: 'off',
  ask: 'asks you first',
  auto: 'acts, then tells you',
};
/** What the per-post triggers do, said of them together. */
const TRIGGER_WORDS = {
  off: 'are off',
  ask: 'ask you first',
  auto: 'act, then tell you',
};
const WHY_WORDS = {
  trigger: 'by a trigger',
  attack: 'in attack mode',
  manual: 'by you',
};
const RULE_WORDS = {
  following: 'people you follow',
  followers: 'your followers',
  mentioned: 'people you mention',
  nobody: 'nobody',
};

function PostLink({ uri }) {
  const href = postLink(uri);
  if (!href) return <span className="ident">{uri}</span>;
  return (
    <a
      className="mh-handle"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      Your post <span className="ident">{uri.split('/').pop()}</span>
      <ExternalLink size={11} aria-hidden="true" />
    </a>
  );
}

export default function ShieldView({ agent }) {
  const toast = useToast();
  const { isOwner } = useHub();
  const run = useCommand(agent);
  const [busy, setBusy] = useState(null);
  const {
    data: s,
    error,
    loading,
    reload,
  } = useCached('shield', () => shieldState(agent), { staleMs: 15_000 });

  const send = async (key, command, ask = null) => {
    if (ask && !window.confirm(ask)) return;
    setBusy(key);
    try {
      const reply = await run(command);
      if (reply) toast(reply.text || 'Done.');
      await reload();
    } catch (err) {
      toast(err.message, { tone: 'danger' });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Skeleton rows={3} avatar={false} />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  if (!s?.running) {
    return (
      <Empty title="The shield is not running">
        It watches replies and quotes on your posts through the stream, which is
        off on this bot (MOD_STREAM).
      </Empty>
    );
  }

  const act = isOwner && s.canAct;

  return (
    <section className="mh-view" aria-label="Shield">
      {!s.canAct && <p className="mh-warn">{s.problem}</p>}

      <article className="mh-shield-attack">
        <div className="mh-status-row">
          <span
            className={`mh-dot ${s.attack.on ? 'mh-dot--on' : 'mh-dot--off'}`}
          />
          <strong>
            {s.attack.on ? 'Attack mode is on' : 'Attack mode is off'}
          </strong>
        </div>
        <p className="mh-small">
          {s.attack.on ? (
            <>
              On since <Time value={s.attack.since} variant="relative" />
              {s.attack.why ? ` (${s.attack.why})` : ''}, until{' '}
              <Time value={s.attack.until} variant="relative" />. Every recent
              post is closed to strangers; standing down puts back exactly what
              it changed.
            </>
          ) : s.attack.mode === 'off' ? (
            'It never trips by itself. You can still put the shields up.'
          ) : (
            `Trips at ${rate(s.attack.trip)} strangers replying, quoting or mentioning you, and ${MODE_WORDS[s.attack.mode]}.`
          )}
        </p>
        {act && (
          <div className="mh-actions">
            {s.attack.on ? (
              <Button
                disabled={Boolean(busy)}
                onClick={() => send('down', 'shields down')}
              >
                {busy === 'down' ? 'Standing down…' : 'Shields down'}
              </Button>
            ) : (
              <Button
                variant="danger"
                disabled={Boolean(busy)}
                onClick={() =>
                  send(
                    'up',
                    'shields up',
                    'Close replies and turn quotes off on every recent post? Shields down puts them back.',
                  )
                }
              >
                {busy === 'up' ? 'Raising…' : 'Shields up'}
              </Button>
            )}
          </div>
        )}
      </article>

      <p className="mh-small">
        Per-post triggers {TRIGGER_WORDS[s.triggers.mode] || s.triggers.mode}
        {s.triggers.mode !== 'off' &&
          `: replies at ${rate(s.triggers.replies)}, quotes at ${rate(s.triggers.quotes)} from strangers. Closed replies stay open to ${(s.triggers.replyRule || []).map((r) => RULE_WORDS[r] || r).join(' and ') || 'nobody'}.`}
        {s.triggers.mode === 'off' && '. Guard a post to watch it alone.'}
      </p>
      <p className="mh-small mh-muted">
        {!s.stream.on
          ? 'Not listening: the stream is off, so nothing trips by itself.'
          : s.stream.live
            ? `Listening: ${fmt(s.stream.held)} replies, quotes and mentions in the last ${Math.max(1, Math.round(s.stream.coversMs / 3_600_000))}h.`
            : 'Not connected to the stream right now, so nothing trips by itself until it is back.'}
      </p>

      <SectionHead
        title="Limits it has set"
        meta={s.limits.length ? fmt(s.limits.length) : null}
        className="mh-section-head"
      />
      {!s.limits.length && (
        <p className="mh-small mh-muted">
          None. Your posts are as you left them.
        </p>
      )}
      {s.limits.length > 0 && (
        <ul className="mh-rows">
          {s.limits.map((l) => (
            <li key={`${l.post}-${l.kind}`} className="mh-shield-row">
              <span className="mh-row-text">
                <PostLink uri={l.post} />
                <span className="mh-row-sub">
                  {l.kind === 'replies' ? 'Replies closed' : 'Quotes off'}{' '}
                  {WHY_WORDS[l.why] || ''}{' '}
                  <Time value={l.appliedAt} variant="relative" />
                  {l.restoreAfter && (
                    <>
                      {' · back by itself '}
                      <Time value={l.restoreAfter} variant="relative" />, once
                      it is quiet
                    </>
                  )}
                </span>
              </span>
              {act && (
                <Button
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    send(
                      `${l.post}-${l.kind}`,
                      l.kind === 'replies'
                        ? `open replies ${l.post}`
                        : `enable quotes ${l.post}`,
                    )
                  }
                >
                  {l.kind === 'replies' ? 'Open replies' : 'Turn quotes on'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      <SectionHead
        title="Posts it is guarding"
        meta={s.guards.length ? fmt(s.guards.length) : null}
        className="mh-section-head"
      />
      {!s.guards.length && (
        <p className="mh-small mh-muted">
          None. Send the bot one of your posts and choose “guard it” to watch it
          alone.
        </p>
      )}
      {s.guards.length > 0 && (
        <ul className="mh-rows">
          {s.guards.map((g) => (
            <li key={g.post} className="mh-shield-row">
              <span className="mh-row-text">
                <PostLink uri={g.post} />
                <span className="mh-row-sub">
                  <Tag tone="muted">
                    {g.mode === 'auto' ? 'acts by itself' : 'asks first'}
                  </Tag>{' '}
                  until <Time value={g.until} variant="relative" />
                </span>
              </span>
              {isOwner && (
                <Button
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={() => send(g.post, `unguard ${g.post}`)}
                >
                  Stop guarding
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
