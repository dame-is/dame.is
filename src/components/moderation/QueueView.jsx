// The queue: everyone on the list who needs a person to look at them, one card
// each, most urgent first, with the two decisions that matter one tap away.
//
// The old Audit tab held the same accounts in a list of keep/remove toggles
// applied in a batch, decisions that vanished with the next weekly re-score,
// and a list URI to paste before any of it worked. 565 accounts were waiting
// and none had ever been decided. This is built to be worked through: a card,
// a decision, the next card, with Undo on every decision for the one you got
// wrong.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { queueDecide, queuePage } from '../../lib/moderation/client.js';
import {
  Avatar,
  BandBadge,
  Chips,
  Empty,
  ErrorNote,
  Skeleton,
  Tag,
  age,
  compact,
  fmt,
  invalidate,
  profileUrl,
  setCached,
  timeAgo,
  useCached,
  useNearEnd,
  useToast,
} from './ui.jsx';

export const REASON_META = {
  PROTECTED: {
    label: 'Protected',
    blurb:
      'You follow them, or they are on a curation list. They should never be on this list.',
  },
  CONNECTED: {
    label: 'Connected',
    blurb:
      'Several people you follow follow them. The likeliest collateral from a sweep.',
  },
  disputed: {
    label: 'Disputed',
    blurb:
      'Added because triage read their post as hostile. Two stronger readers now read it differently.',
  },
  PERIPHERAL: {
    label: 'Peripheral',
    blurb: 'One or two people you follow follow them.',
  },
  NOTABLE: {
    label: 'Notable',
    blurb:
      'No connection to you, but a large audience or an unusually loud account.',
  },
};

const PAGE = 20;

/** Why this card is here, in one line. */
function reasonLine(item) {
  if (item.reason === 'PROTECTED') {
    return item.protectedReason || 'Protected, and still on the list';
  }
  if (item.reason === 'disputed') {
    return `Added as hostile · both readers now say ${item.label}`;
  }
  const v = item.vouches ?? 0;
  if (v) return `${v} of the people you follow follow them`;
  if (item.reason === 'NOTABLE')
    return 'No shared follows, but a big or very loud account';
  return 'Close to your circle';
}

function QueueCard({ item, busy, onDecide, onOpen, cardRef, onFocus }) {
  const p = item.profile || {};
  const handle = p.handle || item.handle;
  const name = p.displayName || handle || item.did;
  return (
    <li
      ref={cardRef}
      tabIndex={0}
      onFocus={onFocus}
      className={`mh-card mh-card--${item.reason.toLowerCase()}`}
      aria-label={`${name}, ${REASON_META[item.reason]?.label || item.reason}`}
    >
      <div className="mh-card-head">
        <Avatar src={p.avatar} name={name} size={44} />
        <div className="mh-card-who">
          <span className="mh-card-name">{name}</span>
          <a
            className="mh-handle"
            href={profileUrl(handle || item.did)}
            target="_blank"
            rel="noreferrer noopener"
            onClick={(e) => e.stopPropagation()}
          >
            {/* No display name means the name above already is the handle. */}
            {p.displayName ? `@${handle || item.did}` : 'Open on Bluesky'}
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        </div>
      </div>

      <p className="mh-card-reason">
        <BandBadge band={item.band} />
        <span>{reasonLine(item)}</span>
      </p>

      {item.quote && (
        <blockquote className="mh-card-quote">
          <p>{item.quote}</p>
          {item.plan && (
            <footer>
              <Tag tone="muted">plan {item.plan}</Tag>
            </footer>
          )}
        </blockquote>
      )}

      {p.description && <p className="mh-card-bio">{p.description}</p>}

      <p className="mh-meta">
        {p.followers != null && <span>{compact(p.followers)} followers</span>}
        {p.posts != null && <span>{compact(p.posts)} posts</span>}
        {p.createdAt && <span>{age(p.createdAt)} old</span>}
      </p>

      <div className="mh-card-actions">
        <button
          type="button"
          className="mh-button"
          disabled={busy}
          onClick={() => onDecide(item, 'keep')}
        >
          Keep on list
        </button>
        <button
          type="button"
          className="mh-button mh-button--danger"
          disabled={busy}
          onClick={() => onDecide(item, 'remove')}
        >
          Remove
        </button>
        <button
          type="button"
          className="mh-button mh-button--quiet mh-card-more"
          onClick={() => onOpen(item.did)}
        >
          Details <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/**
 * Move the "to review" count in the header by `delta`, now, rather than when
 * the overview next refetches. The number counting down is most of what makes
 * working a queue feel like progress.
 */
function nudgeOverview(delta) {
  setCached('overview', (d) =>
    d?.queue
      ? {
          ...d,
          queue: {
            ...d.queue,
            total: Math.max(0, (d.queue.total || 0) + delta),
          },
        }
      : d,
  );
}

export default function QueueView({ agent, onOpenAccount }) {
  const toast = useToast();
  const [reason, setReason] = useState('all');
  const [extra, setExtra] = useState([]);
  const [gone, setGone] = useState(() => new Set());
  const [busy, setBusy] = useState(() => new Set());
  const [more, setMore] = useState({
    loading: false,
    done: false,
    error: null,
  });
  const [tally, setTally] = useState({ keep: 0, remove: 0 });
  const cards = useRef([]);
  const focusIndex = useRef(0);

  const key = `queue:${reason}`;
  const first = useCached(
    key,
    () => queuePage(agent, { reason, offset: 0, limit: PAGE }),
    { staleMs: 20_000 },
  );

  // A new filter starts its own pages.
  useEffect(() => {
    setExtra([]);
    setMore({ loading: false, done: false, error: null });
  }, [reason]);

  const page = first.data;
  const items = useMemo(
    () =>
      [...(page?.items || []), ...extra].filter(
        (i, n, all) =>
          !gone.has(i.did) && all.findIndex((x) => x.did === i.did) === n,
      ),
    [page, extra, gone],
  );

  // The cached page carries its own counts and every decision moves them (see
  // shift below), so these are always the server's numbers less what was
  // decided since, wherever on the page the decided card was.
  const counts = page?.counts || {};
  const total = Object.values(counts).reduce((t, n) => t + (n || 0), 0);
  const matched = reason === 'all' ? total : counts[reason] || 0;

  const loadMore = useCallback(async () => {
    if (more.loading || more.done || !page) return;
    if (items.length >= matched) {
      setMore((m) => ({ ...m, done: true }));
      return;
    }
    setMore({ loading: true, done: false, error: null });
    try {
      const next = await queuePage(agent, {
        reason,
        offset: items.length,
        limit: PAGE,
      });
      setExtra((xs) => [...xs, ...next.items]);
      setMore({ loading: false, done: !next.items.length, error: null });
    } catch (error) {
      setMore({ loading: false, done: false, error });
    }
  }, [agent, reason, items.length, matched, more.loading, more.done, page]);

  const sentinel = useNearEnd(loadMore, Boolean(page) && !more.done);

  const decide = useCallback(
    async (item, decision) => {
      setBusy((b) => new Set(b).add(item.did));
      setGone((g) => new Set(g).add(item.did));
      const name = `@${item.profile?.handle || item.handle || item.did}`;
      // Where it sat in the cached first page, so an undo can put it back
      // there rather than at the end of the queue or nowhere.
      let at = -1;
      // Move this card's reason count by `by` in the cached page, and say
      // every other filter's cached page is out of date.
      const shift = (by, update = (d) => d) => {
        setCached(key, (d) => {
          if (!d) return d;
          const next = update(d);
          return {
            ...next,
            counts: {
              ...next.counts,
              [item.reason]: Math.max(
                0,
                (next.counts?.[item.reason] || 0) + by,
              ),
            },
          };
        });
        for (const r of ['all', ...Object.keys(REASON_META)]) {
          if (`queue:${r}` !== key) invalidate(`queue:${r}`);
        }
      };
      try {
        await queueDecide(agent, {
          did: item.did,
          decision,
          reason: item.reason,
          band: item.band,
        });
        setTally((t) => ({ ...t, [decision]: t[decision] + 1 }));
        nudgeOverview(-1);
        if (decision === 'remove') invalidate('members');
        toast(
          decision === 'remove'
            ? `Removed ${name} from the list`
            : `Kept ${name}`,
          {
            action: {
              label: 'Undo',
              run: async () => {
                try {
                  await queueDecide(agent, {
                    did: item.did,
                    decision: decision === 'remove' ? 'restore' : 'reopen',
                    reason: item.reason,
                    band: item.band,
                  });
                  setTally((t) => ({
                    ...t,
                    [decision]: Math.max(0, t[decision] - 1),
                  }));
                  nudgeOverview(1);
                  shift(1, (d) => {
                    if (at === -1 || d.items.some((i) => i.did === item.did)) {
                      return d;
                    }
                    const items = [...d.items];
                    items.splice(Math.min(at, items.length), 0, item);
                    return { ...d, items };
                  });
                  setGone((g) => {
                    const n = new Set(g);
                    n.delete(item.did);
                    return n;
                  });
                  invalidate('members');
                } catch (err) {
                  toast(`Could not undo: ${err.message}`, { tone: 'danger' });
                }
              },
            },
          },
        );
        // Keep the cached first page honest for the next time this tab opens.
        shift(-1, (d) => {
          at = d.items.findIndex((i) => i.did === item.did);
          return { ...d, items: d.items.filter((i) => i.did !== item.did) };
        });
      } catch (err) {
        setGone((g) => {
          const n = new Set(g);
          n.delete(item.did);
          return n;
        });
        toast(`Could not ${decision} ${name}: ${err.message}`, {
          tone: 'danger',
        });
      } finally {
        setBusy((b) => {
          const n = new Set(b);
          n.delete(item.did);
          return n;
        });
      }
    },
    [agent, key, toast],
  );

  // Keyboard: arrows to move, K keeps, R removes, Enter opens. Only when a card
  // has focus, so typing anywhere else on the page is never a decision.
  const onKeyDown = (e) => {
    const el = e.target.closest?.('.mh-card');
    if (!el || e.metaKey || e.ctrlKey || e.altKey) return;
    const index = cards.current.indexOf(el);
    const item = items[index];
    if (!item) return;
    const move = (to) => {
      const next = cards.current[Math.max(0, Math.min(items.length - 1, to))];
      next?.focus();
      e.preventDefault();
    };
    if (e.key === 'ArrowDown' || e.key === 'j') move(index + 1);
    else if (e.key === 'ArrowUp') move(index - 1);
    else if (e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      decide(item, 'keep');
      setTimeout(() => cards.current[index]?.focus(), 0);
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      decide(item, 'remove');
      setTimeout(() => cards.current[index]?.focus(), 0);
    } else if (e.key === 'Enter' && e.target === el) {
      e.preventDefault();
      onOpenAccount(item.did);
    }
  };

  const options = [
    { key: 'all', label: 'All', count: total },
    ...Object.keys(REASON_META)
      .filter((r) => (counts[r] || 0) > 0 || r === reason)
      .map((r) => ({
        key: r,
        label: REASON_META[r].label,
        count: counts[r] || 0,
      })),
  ];

  cards.current = [];

  return (
    <section className="mh-view" aria-label="Review queue">
      <div className="mh-view-intro">
        <Chips
          options={options}
          value={reason}
          onChange={setReason}
          label="Why they are here"
        />
        <p className="mh-small">
          {reason === 'all'
            ? 'Accounts on the list who are not strangers, and labels the second readers dispute. Most urgent first.'
            : REASON_META[reason]?.blurb}
        </p>
        {page?.audit && (
          <p className="mh-small mh-muted">
            List re-scored {timeAgo(page.audit.at)} ({fmt(page.audit.total)}{' '}
            accounts)
            {tally.keep + tally.remove > 0 &&
              ` · this session: ${tally.keep} kept, ${tally.remove} removed`}
          </p>
        )}
      </div>

      {first.loading && <Skeleton rows={4} />}
      <ErrorNote error={first.error} onRetry={first.reload} />

      {page && !items.length && !more.loading && (
        <Empty
          title={
            reason === 'all'
              ? 'Nothing waiting for you'
              : `No ${REASON_META[reason]?.label.toLowerCase()} accounts waiting`
          }
        >
          {reason === 'all'
            ? 'Everyone on the list is a stranger to your circle, or you have already decided on them. The list is re-scored weekly, and anyone who stops being a stranger shows up here.'
            : 'Try another filter.'}
        </Empty>
      )}

      {items.length > 0 && (
        <ol className="mh-cards" onKeyDown={onKeyDown}>
          {items.map((item, n) => (
            <QueueCard
              key={item.did}
              item={item}
              busy={busy.has(item.did)}
              onDecide={decide}
              onOpen={onOpenAccount}
              onFocus={() => {
                focusIndex.current = n;
              }}
              cardRef={(el) => {
                if (el) cards.current[n] = el;
              }}
            />
          ))}
        </ol>
      )}

      {items.length > 0 && (
        <div className="mh-more" ref={sentinel}>
          <ErrorNote error={more.error} onRetry={loadMore} compact />
          {more.loading && <Skeleton rows={2} />}
          {!more.loading && !more.done && items.length < matched && (
            <button
              type="button"
              className="mh-button mh-button--quiet"
              onClick={loadMore}
            >
              Show more ({fmt(matched - items.length)} left)
            </button>
          )}
          {items.length >= matched && (
            <p className="mh-small mh-muted">That is everyone in this view.</p>
          )}
        </div>
      )}

      <p className="mh-hint" aria-hidden="true">
        Keyboard: ↑ ↓ to move, K to keep, R to remove, Enter for details.
      </p>
    </section>
  );
}
