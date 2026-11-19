// One account, everything at once: who they are, whether they are on the list,
// how they got there, and the way off it.
//
// Opened from every view -- a queue card, a list row, a lookup -- so "why is
// this person blocked" is one tap from anywhere it can be asked.

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { blockCommand, unblockCommand } from 'bluesky-mod-client';
import { SheetHeader } from '../BottomSheet.jsx';
import Button from '../Button.jsx';
import Modal from '../Modal.jsx';
import SectionHead from '../SectionHead.jsx';
import Time from '../Time.jsx';
import '../BottomSheet.css';
import { accountDetail } from '../../lib/moderation/client.js';
import { useCommand, useHub } from './hub.jsx';
import {
  Avatar,
  BandBadge,
  ErrorNote,
  Skeleton,
  Tag,
  age,
  compact,
  decisionText,
  fmt,
  invalidate,
  isCarried,
  profileUrl,
  useCached,
  useToast,
} from './ui.jsx';

export default function AccountSheet({ agent, actor, onClose, onOpenPlan }) {
  const toast = useToast();
  const hub = useHub();
  const run = useCommand(agent);
  const [busy, setBusy] = useState(false);
  const key = actor ? `account:${actor}` : null;
  const { data, error, loading, reload } = useCached(
    key,
    () => accountDetail(agent, actor),
    { staleMs: 15_000 },
  );

  const p = data?.profile || {};
  const name = p.displayName || p.handle || actor;
  const listName = (rkey) =>
    hub.lists.find((l) => l.rkey === rkey)?.name || 'the list';

  const refreshAll = () => {
    invalidate('queue:');
    invalidate('members');
    invalidate('overview');
    invalidate('radar');
  };

  // Unblock and block are the bot's own commands. With several lists the bot
  // asks which, and the hub asks the same question.
  const act = async (decision) => {
    setBusy(true);
    try {
      const reply = await run(
        decision === 'remove'
          ? unblockCommand(data.did)
          : blockCommand(data.did),
      );
      if (!reply) return;
      refreshAll();
      toast(reply.text || (decision === 'remove' ? 'Removed.' : 'Added.'));
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
      <SheetHeader title="Account" onClose={onClose} />

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
                {data.onList
                  ? hub.multi
                    ? `On ${data.onLists.map((l) => listName(l.list)).join(' and ')}`
                    : 'On the list'
                  : 'Not on the list'}
              </strong>
              {data.score?.band && <BandBadge band={data.score.band} />}
            </div>
            {data.protectedReason && (
              <p className="mh-warn">
                Protected ({data.protectedReason}). Nothing automated may add
                them.
              </p>
            )}
            {data.score && (
              <p className="mh-small">
                {data.score.vouches ?? 0} of the people you follow follow them ·
                scored just now
              </p>
            )}
            {data.failed && (
              <p className="mh-small mh-muted">
                Could not score them just now: {data.failed}
              </p>
            )}
            {data.kept && (
              <p className="mh-small">
                You kept them on the list, out of the queue,{' '}
                <Time value={data.kept.at} variant="relative" />.
              </p>
            )}
            {hub.canWrite && (
              <div className="mh-actions">
                {data.onList && (
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => act('remove')}
                  >
                    {busy ? 'Working…' : 'Remove from list'}
                  </Button>
                )}
                {!data.onList &&
                  data.entries.some((e) => e.action === 'list_add') && (
                    <Button
                      disabled={busy || Boolean(data.protectedReason)}
                      onClick={() => act('restore')}
                    >
                      {busy ? 'Working…' : 'Put back on the list'}
                    </Button>
                  )}
              </div>
            )}
          </section>

          <section className="mh-record">
            <SectionHead
              as="h3"
              title="How they got here"
              meta={data.entries.length ? fmt(data.entries.length) : null}
              className="mh-section-head"
            />
            {!data.entries.length && (
              <p className="mh-small">
                {data.onList
                  ? 'No decision is recorded for them.'
                  : 'Nothing recorded. This account has never been through the gate.'}
              </p>
            )}
            <ol className="mh-timeline">
              {data.entries.map((e) => (
                <li key={`${e.code}-${e.at}`} className="mh-timeline-item">
                  <span className="mh-timeline-when">
                    {e.action ? (
                      <Time value={e.at} variant="dateShort" />
                    ) : (
                      'proposed'
                    )}
                  </span>
                  <span className="mh-timeline-what">
                    {decisionText(e)}
                    {e.undoneAt && (
                      <Tag tone="muted">
                        undone <Time value={e.undoneAt} variant="relative" />
                      </Tag>
                    )}
                    {e.label && (
                      <Tag tone={e.label === 'hostile' ? 'danger' : 'muted'}>
                        {e.label}
                      </Tag>
                    )}
                  </span>
                  <span className="mh-timeline-meta">
                    {e.band && e.band !== 'UNSCORED' && (
                      <BandBadge band={e.band} />
                    )}
                    {hub.multi && e.list && (
                      <Tag tone="muted">{listName(e.list)}</Tag>
                    )}
                    <Button
                      variant="text"
                      size="sm"
                      onClick={() => onOpenPlan?.(e.code)}
                    >
                      plan <span className="ident">{e.code}</span>
                    </Button>
                  </span>
                  {e.quote && <q className="mh-quote">{e.quote}</q>}
                  {!e.quote && e.words?.length > 0 && !isCarried(e.words) && (
                    <q className="mh-quote">{e.words.join(' · ')}</q>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </Modal>
  );
}
