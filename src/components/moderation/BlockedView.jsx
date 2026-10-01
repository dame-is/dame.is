// Who is on the list: faces and names, newest first, searchable.
//
// The old List tab printed "@handle — Name · 1,204 followers" fifty at a time
// behind a "choose a list" step, with a filter that only searched what had
// already been paged in. This reads the list the way subscribers experience
// it -- people -- and searches the whole of it on the server.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { listPage, searchList } from '../../lib/moderation/client.js';
import {
  Avatar,
  BandBadge,
  Empty,
  ErrorNote,
  Skeleton,
  Tag,
  fmt,
  timeAgo,
  useCached,
  useNearEnd,
  viaTag,
} from './ui.jsx';

function MemberRow({ m, onOpen }) {
  const name = m.displayName || m.handle || m.did;
  const tag = viaTag(m.addedVia);
  return (
    <li>
      <button type="button" className="mh-row" onClick={() => onOpen(m.did)}>
        <Avatar src={m.avatar} name={name} size={40} />
        <span className="mh-row-text">
          <span className="mh-row-name">{name}</span>
          <span className="mh-row-sub">
            {m.displayName ? `@${m.handle || m.did}` : 'no display name'}
          </span>
        </span>
        <span className="mh-row-tags">
          {m.band && m.band !== 'UNKNOWN' && <BandBadge band={m.band} />}
          {tag && <Tag tone={tag.tone}>{tag.text}</Tag>}
          {m.reviewed === 'keep' && <Tag tone="muted">kept</Tag>}
          {m.onList === false && <Tag tone="muted">not on list</Tag>}
          {m.addedAt && (
            <span className="mh-row-when">{timeAgo(m.addedAt)}</span>
          )}
        </span>
      </button>
    </li>
  );
}

export default function BlockedView({ agent, onOpenAccount }) {
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [pages, setPages] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [more, setMore] = useState({ loading: false, error: null });

  // Debounced: a search per keystroke is a search per keystroke on the server.
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const first = useCached('members', () => listPage(agent), {
    staleMs: 60_000,
  });
  const found = useCached(
    term.length >= 2 ? `search:${term.toLowerCase()}` : null,
    () => searchList(agent, term),
    { staleMs: 60_000 },
  );

  useEffect(() => {
    setPages([]);
    setCursor(first.data?.cursor ?? null);
  }, [first.data]);

  const members = useMemo(
    () => [...(first.data?.items || []), ...pages],
    [first.data, pages],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || more.loading) return;
    setMore({ loading: true, error: null });
    try {
      const next = await listPage(agent, { cursor });
      setPages((p) => [...p, ...next.items]);
      setCursor(next.cursor);
      setMore({ loading: false, error: null });
    } catch (error) {
      setMore({ loading: false, error });
    }
  }, [agent, cursor, more.loading]);

  const searching = term.length >= 2;
  const sentinel = useNearEnd(loadMore, !searching && Boolean(cursor));
  const list = first.data?.list;

  return (
    <section className="mh-view" aria-label="Accounts on the list">
      <div className="mh-view-intro">
        <label className="mh-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by handle"
            spellCheck="false"
            autoComplete="off"
            aria-label="Search the list"
          />
          {query && (
            <button
              type="button"
              className="mh-icon-button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <p className="mh-small mh-muted">
          {searching
            ? found.loading
              ? 'Searching…'
              : `${fmt(found.data?.items?.length ?? 0)} on the list match “${term}”`
            : list
              ? `${list.name || 'The list'} · ${fmt(list.count)} accounts · newest first`
              : ' '}
        </p>
      </div>

      {searching ? (
        <>
          {found.loading && <Skeleton rows={3} />}
          <ErrorNote error={found.error} onRetry={found.reload} />
          {found.data && !found.data.items.length && (
            <Empty title="Nobody on the list matches">
              Search covers handles from the last weekly re-score; for someone
              added since, type their full handle.
            </Empty>
          )}
          {found.data?.items?.length > 0 && (
            <ul className="mh-rows">
              {found.data.items.map((m) => (
                <MemberRow key={m.did} m={m} onOpen={onOpenAccount} />
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {first.loading && <Skeleton rows={8} />}
          <ErrorNote error={first.error} onRetry={first.reload} />
          {members.length > 0 && (
            <ul className="mh-rows">
              {members.map((m) => (
                <MemberRow key={m.did} m={m} onOpen={onOpenAccount} />
              ))}
            </ul>
          )}
          {members.length > 0 && (
            <div className="mh-more" ref={sentinel}>
              <ErrorNote error={more.error} onRetry={loadMore} compact />
              {more.loading && <Skeleton rows={2} />}
              {!more.loading && cursor && (
                <button
                  type="button"
                  className="mh-button mh-button--quiet"
                  onClick={loadMore}
                >
                  Load more
                </button>
              )}
              {!cursor && (
                <p className="mh-small mh-muted">That is the whole list.</p>
              )}
              {list?.count > members.length && cursor && (
                <p className="mh-small mh-muted">
                  Showing {fmt(members.length)} of {fmt(list.count)}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
