// One account, everything at once: who they are, whether they are on the list,
// how they got there, and the way off it.
//
// Opened from every view -- a queue card, a list row, a lookup -- so "why is
// this person blocked" is one tap from anywhere it can be asked.

import { useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import Modal from '../Modal.jsx';
import { accountDetail, queueDecide } from '../../lib/moderation/client.js';
import {
  Avatar,
  BandBadge,
  ErrorNote,
  Skeleton,
  Tag,
  age,
  compact,
  day,
  invalidate,
  profileUrl,
  timeAgo,
  useCached,
  useToast,
  viaText,
} from './ui.jsx';

export default function AccountSheet({ agent, actor, onClose, onOpenPlan }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const key = actor ? `account:${actor}` : null;
  const { data, error, loading, reload } = useCached(
    key,
    () => accountDetail(agent, actor),
    { staleMs: 15_000 },
  );

  const p = data?.profile || {};
  const name = p.displayName || p.handle || actor;

  const act = async (decision) => {
    setBusy(true);
    try {
      await queueDecide(agent, {
        did: data.did,
        decision,
        reason: 'account',
        band: data.score?.band ?? null,
      });
      invalidate('queue:');
      invalidate('members');
      invalidate('overview');
      toast(
        decision === 'remove'
          ? `Removed @${p.handle || data.did} from the list`
          : `Put @${p.handle || data.did} back on the list`,
        decision === 'remove'
          ? {
              action: {
                label: 'Undo',
                run: () =>
                  queueDecide(agent, {
                    did: data.did,
                    decision: 'restore',
                  }).then(() => {
                    invalidate('members');
                    reload();
                  }),
              },
            }
          : {},
      );
      await reload();
    } catch (err) {
      toast(String(err?.message || err), { tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(actor)}
      onClose={onClose}
      label={`Account: ${name || ''}`}
      variant="anchored"
      className="mh-sheet"
    >
      <div className="mh-sheet-head">
        <span className="mh-label">Account</span>
        <button
          type="button"
          className="mh-icon-button"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>

      {loading && <Skeleton rows={3} />}
      <ErrorNote error={error} onRetry={reload} />

      {data && (
        <div className="mh-sheet-body">
          <header className="mh-profile">
            <Avatar src={p.avatar} name={name} size={64} />
            <div className="mh-profile-text">
              <h2 className="mh-profile-name">{name}</h2>
              <a
                className="mh-handle"
                href={profileUrl(p.handle || data.did)}
                target="_blank"
                rel="noreferrer noopener"
              >
                @{p.handle || data.did}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </div>
          </header>
          {p.description && <p className="mh-bio">{p.description}</p>}
          <p className="mh-meta">
            {p.followers != null && (
              <span>{compact(p.followers)} followers</span>
            )}
            {p.posts != null && <span>{compact(p.posts)} posts</span>}
            {p.createdAt && <span>joined {age(p.createdAt)} ago</span>}
          </p>

          <section className="mh-status">
            <div className="mh-status-row">
              <span
                className={`mh-dot ${data.onList ? 'mh-dot--on' : 'mh-dot--off'}`}
              />
              <strong>
                {data.onList === null
                  ? 'Could not check the list'
                  : data.onList
                    ? 'On the list'
                    : 'Not on the list'}
              </strong>
              {data.score?.band && <BandBadge band={data.score.band} />}
            </div>
            {data.protected && (
              <p className="mh-warn">
                Protected ({data.protected.reason}). Nothing automated may add
                them.
              </p>
            )}
            {data.score && (
              <p className="mh-small">
                {data.score.vouches ?? 0} of the people you follow follow them
                {data.scoredAt ? ` · scored ${timeAgo(data.scoredAt)}` : ''}
              </p>
            )}
            {data.review && (
              <p className="mh-small">
                You chose to <strong>{data.review.decision}</strong>{' '}
                {timeAgo(data.review.decided_at)}
                {data.review.note ? ` (${data.review.note})` : ''}.
              </p>
            )}
            <div className="mh-actions">
              {data.onList && (
                <button
                  type="button"
                  className="mh-button mh-button--danger"
                  disabled={busy}
                  onClick={() => act('remove')}
                >
                  {busy ? 'Working…' : 'Remove from list'}
                </button>
              )}
              {data.onList === false &&
                data.decisions.some((d) => d.acted_at) && (
                  <button
                    type="button"
                    className="mh-button"
                    disabled={busy || Boolean(data.protected)}
                    onClick={() => act('restore')}
                  >
                    {busy ? 'Working…' : 'Put back on the list'}
                  </button>
                )}
            </div>
          </section>

          <section className="mh-record">
            <h3 className="mh-label">How they got here</h3>
            {!data.decisions.length && (
              <p className="mh-small">
                {data.onList
                  ? 'No decision is recorded for them. They were carried over when the list moved to the bot in September.'
                  : 'Nothing recorded. This account has never been through the gate.'}
              </p>
            )}
            <ol className="mh-timeline">
              {[...data.decisions]
                .sort(
                  (a, b) =>
                    Date.parse(b.acted_at || 0) - Date.parse(a.acted_at || 0),
                )
                .map((d) => {
                  const plan = data.plans.find((x) => x.id === d.plan_id);
                  return (
                    <li
                      key={`${d.plan_id}-${d.did}`}
                      className="mh-timeline-item"
                    >
                      <span className="mh-timeline-when">
                        {d.acted_at ? day(d.acted_at) : 'proposed'}
                      </span>
                      <span className="mh-timeline-what">
                        {d.acted_at
                          ? `Added: ${viaText(d.approved_via)}`
                          : 'In a scan that was not acted on'}
                        {d.undone_at && (
                          <Tag tone="muted">undone {timeAgo(d.undone_at)}</Tag>
                        )}
                      </span>
                      <span className="mh-timeline-meta">
                        <BandBadge band={d.band} />
                        {plan?.code && (
                          <button
                            type="button"
                            className="mh-link"
                            onClick={() => onOpenPlan?.(plan.code)}
                          >
                            plan {plan.code}
                          </button>
                        )}
                      </span>
                      {plan?.note && !/^bulk /.test(plan.note) && (
                        <q className="mh-quote">{plan.note}</q>
                      )}
                    </li>
                  );
                })}
            </ol>
            {data.audits?.length > 0 && (
              <p className="mh-small">
                Scored in {data.audits.length} weekly re-score
                {data.audits.length === 1 ? '' : 's'}.
              </p>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
