// Who is on the list: faces and names, newest first, searchable, or the
// whole list as a radar.
//
// Reads the list the way subscribers experience it, people, and searches the
// whole of it on the bot (part of a handle, or a DID).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { FAMILY_WORDS } from 'bluesky-mod-client';
import Button from '../Button.jsx';
import Time from '../Time.jsx';
import { listPage, listRadar } from '../../lib/moderation/client.js';
import { useHub } from './hub.jsx';
import Radar from './Radar.jsx';
import {
  Avatar,
  BandBadge,
  Chips,
  Empty,
  ErrorNote,
  Skeleton,
  Tag,
  fmt,
  useCached,
  useNearEnd,
  viaTag,
} from './ui.jsx';

const PAGE = 50;

function MemberRow({ m, onOpen }) {
  const p = m.profile || {};
  const handle = p.handle || m.handle;
  const name = p.displayName || handle || m.did;
  const tag = viaTag(m.via);
  return (
    <li>
      <button type="button" className="mh-row" onClick={() => onOpen(m.did)}>
        <Avatar src={p.avatar} name={name} size={40} />
        <span className="mh-row-text">
          <span className="mh-row-name">{name}</span>
          <span className="mh-row-sub">
            {p.displayName
              ? `@${handle || m.did}`
              : handle
                ? 'no display name'
                : 'not found'}
          </span>
        </span>
        <span className="mh-row-tags">
          {m.band && m.band !== 'UNKNOWN' && <BandBadge band={m.band} />}
          {tag && <Tag tone={tag.tone}>{tag.text}</Tag>}
          {m.keptBand && <Tag tone="muted">kept</Tag>}
          {m.addedAt && (
            <Time
              className="mh-row-when"
              value={m.addedAt}
              variant="relative"
            />
          )}
        </span>
      </button>
    </li>
  );
}

const SHOW = [
  { key: 'people', label: 'People' },
  { key: 'radar', label: 'Radar' },
];

/** The list's radar: how close everyone on it is, sliced by how they got there. */
function ListRadar({ agent, list, onOpen }) {
  const { data, error, loading, reload } = useCached(
    `radar:${list || 'main'}`,
    () => listRadar(agent, { list }),
    {
      staleMs: 60_000,
    },
  );
  const drawn = useMemo(() => {
    if (!data) return null;
    const keys = Object.keys(FAMILY_WORDS).filter(
      (k) => (data.far?.[k] || 0) > 0 || data.near.some((p) => p.family === k),
    );
    return {
      sectors: keys.map((k) => ({ key: k, label: FAMILY_WORDS[k] })),
      points: data.near.map((p) => ({
        did: p.did,
        band: p.band,
        name: p.handle,
        sector: keys.indexOf(p.family),
      })),
      far: keys.map((k) => data.far?.[k] || 0),
    };
  }, [data]);
  if (loading) return <Skeleton rows={4} avatar={false} />;
  if (error) return <ErrorNote error={error} onRetry={reload} />;
  return (
    <>
      <Radar label="Who on the list is near you" {...drawn} onOpen={onOpen} />
      {data.asOf && (
        <p className="mh-small mh-muted">
          Bands from the re-score <Time value={data.asOf} variant="relative" />.
          Tap a mark to open the account.
        </p>
      )}
    </>
  );
}

export default function BlockedView({ agent, onOpenAccount }) {
  const { list } = useHub();
  const [show, setShow] = useState('people');
  const [query, setQuery] = useState('');
  const [term, setTerm] = useState('');
  const [pages, setPages] = useState([]);
  const [more, setMore] = useState({
    loading: false,
    error: null,
    done: false,
  });

  // Debounced: a search per keystroke is a search per keystroke on the bot.
  useEffect(() => {
    const t = setTimeout(() => setTerm(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const searching = term.length >= 2;
  const key = `members:${list || 'main'}:${searching ? term.toLowerCase() : ''}`;
  const first = useCached(
    key,
    () => listPage(agent, { q: searching ? term : '', list, limit: PAGE }),
    {
      staleMs: 60_000,
    },
  );

  useEffect(() => {
    setPages([]);
    setMore({ loading: false, error: null, done: false });
  }, [first.data]);

  const members = useMemo(
    () => [...(first.data?.items || []), ...pages],
    [first.data, pages],
  );
  const hasMore =
    Boolean(first.data) &&
    !more.done &&
    members.length < (first.data?.matched ?? 0);

  const loadMore = useCallback(async () => {
    if (!hasMore || more.loading) return;
    setMore((m) => ({ ...m, loading: true, error: null }));
    try {
      const next = await listPage(agent, {
        q: searching ? term : '',
        list,
        offset: members.length,
        limit: PAGE,
      });
      setPages((p) => [...p, ...next.items]);
      setMore({ loading: false, error: null, done: !next.more });
    } catch (error) {
      setMore((m) => ({ ...m, loading: false, error }));
    }
  }, [agent, hasMore, more.loading, searching, term, list, members.length]);

  const sentinel = useNearEnd(loadMore, show === 'people' && hasMore);
  const total = first.data?.total;

  return (
    <section className="mh-view" aria-label="Accounts on the list">
      <div className="mh-view-intro">
        <Chips
          options={SHOW}
          value={show}
          onChange={setShow}
          label="Show the list as"
        />
        {show === 'people' && (
          <>
            <label className="mh-search">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by handle or DID"
                spellCheck="false"
                autoComplete="off"
                aria-label="Search the list"
              />
              {query && (
                <Button
                  variant="icon"
                  size="sm"
                  className="mh-search-clear"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              )}
            </label>
            <p className="mh-small mh-muted">
              {searching
                ? first.loading
                  ? 'Searching…'
                  : `${fmt(first.data?.matched ?? 0)} on the list match “${term}”`
                : total != null
                  ? `${fmt(total)} accounts · newest first`
                  : ' '}
            </p>
          </>
        )}
      </div>

      {show === 'radar' ? (
        <ListRadar agent={agent} list={list} onOpen={onOpenAccount} />
      ) : (
        <>
          {first.loading && <Skeleton rows={8} />}
          <ErrorNote error={first.error} onRetry={first.reload} />
          {first.data && !members.length && (
            <Empty
              title={
                searching
                  ? 'Nobody on the list matches'
                  : 'Nobody is on the list'
              }
            >
              {searching
                ? 'Search covers handles from the last weekly re-score; for someone added since, paste their DID.'
                : null}
            </Empty>
          )}
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
              {!more.loading && hasMore && (
                <Button size="sm" onClick={loadMore}>
                  Load more ({fmt((first.data?.matched ?? 0) - members.length)}{' '}
                  left)
                </Button>
              )}
              {!hasMore && (
                <p className="mh-small mh-muted">
                  That is everyone in this view.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
