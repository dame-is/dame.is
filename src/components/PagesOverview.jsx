// Site-pages studio: which of the site's pages serve their title + intro from an
// `is.dame.page` record on the PDS versus the hardcoded local defaults, plus the
// raw page records themselves.
//
// Lifted verbatim out of src/pages/Admin.jsx, where it lived as one of four
// managers inside a 1500-line file. Behaviour is unchanged — the move is what
// lets the admin shell own layout and the studios own their subject.
//
// As a studio it is a BODY, not a page: StudioPane draws the title, the blurb
// and the `is.dame.page` NSID above it, and the rail is the way back — so there
// is no PageShell and no "← All collections" link here. What survives from the
// old toolbar is the one thing the shell cannot draw: "New page record".
//
// The batched read is load-bearing: ONE `listRecords` with `limit: 100` decides
// which slugs exist, and each panel is handed `exists` as a prop. A
// `PageContentPanel` rendered WITHOUT `exists` self-fetches a `getRecord`, so
// dropping that prop would turn one request into eleven.

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import PageContentPanel, { pageRecordLink } from './PageContentPanel.jsx';
import { rkeyFromUri } from './RecordEditor.jsx';
import { Skeleton, SkeletonShell } from './Skeleton.jsx';
import Button from './Button.jsx';
import SectionHead from './SectionHead.jsx';
import Tag from './Tag.jsx';
import { COLLECTIONS } from '../config.js';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { knownPageSlugs } from '../lib/pageRegistry.js';
import './siteStudios.css';
import './PageContentPanel.css';
import './PagesOverview.css';

/**
 * Row-shaped loading lines for either list on this surface: a name, a longer
 * source line and the actions' width, on the same hairline the rows use, so
 * nothing moves when the records land.
 */
function PageRowsSkeleton({ rows = 4, label }) {
  return (
    <SkeletonShell label={label}>
      <ul className="ss-rows">
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="pcp pages-skel-row">
            {/* Sizes are PROPS: `Skeleton` writes width/height inline. */}
            <Skeleton width={`${5 + ((i * 3) % 4)}rem`} height="1em" />
            <Skeleton width={`${50 + ((i * 17) % 30)}%`} height="0.85em" />
            <Skeleton width="5.5rem" height="1.75rem" />
          </li>
        ))}
      </ul>
    </SkeletonShell>
  );
}

export default function PagesOverview({ agent, did }) {
  // Page records are edited on the generic records surface, so every link out of
  // this studio has to clear `view` explicitly — see `pageRecordLink`.
  const { go } = useAdminShell();
  const [records, setRecords] = useState(null); // is.dame.page records on the PDS
  const [error, setError] = useState(null);
  const [loadNonce, setLoadNonce] = useState(0);

  // A failed list leaves `records` null rather than empty. Empty used to badge
  // every page LOCAL and offer to migrate it, and say there were no page
  // records on the PDS at all — over a network error, about a PDS that may
  // hold every one of them.
  useEffect(() => {
    let cancelled = false;
    setError(null);
    agent.com.atproto.repo
      .listRecords({ repo: did, collection: COLLECTIONS.page, limit: 100 })
      .then((res) => {
        const next = res?.data || res;
        if (!cancelled) setRecords(next?.records || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [agent, did, loadNonce]);
  const failed = records === null && Boolean(error);

  const existing = useMemo(
    () => new Set((records || []).map((r) => rkeyFromUri(r.uri))),
    [records],
  );
  // Records whose slug isn't one of the known page surfaces — surfaced in the
  // raw records section so they're still reachable/editable.
  const known = new Set(knownPageSlugs());
  const extraRecords = (records || []).filter((r) => !known.has(rkeyFromUri(r.uri)));

  const slugs = knownPageSlugs();
  const onPds = records ? slugs.filter((slug) => existing.has(slug)).length : null;

  return (
    <>
      {error && <p className="ss-error">{error}</p>}

      <section className="ss-section" aria-labelledby="pages-content-head">
        <SectionHead
          id="pages-content-head"
          title="Page content"
          meta={
            <Button as={Link} size="sm" {...pageRecordLink(go, null, { mode: 'new' })}>
              <Plus size={14} aria-hidden="true" />
              New page record
            </Button>
          }
        />
        <p className="ss-note">
          Which pages serve their title and intro from a record on your PDS, and
          which from the defaults built into the site
          {onPds != null && ` (${onPds} of ${slugs.length} on your PDS)`}. Migrate or
          revert any of them.
        </p>
        {failed ? (
          <>
            <p className="ss-empty">
              The page records could not be listed, so which pages are local and
              which are on your PDS is not known.
            </p>
            <div className="ss-actions">
              <Button onClick={() => setLoadNonce((n) => n + 1)}>Try again</Button>
            </div>
          </>
        ) : records === null ? (
          <PageRowsSkeleton rows={slugs.length || 4} label="Loading page content" />
        ) : (
          <div className="reveal">
            {slugs.map((slug) => (
              <PageContentPanel
                key={slug}
                agent={agent}
                did={did}
                slug={slug}
                exists={existing.has(slug)}
                inList
              />
            ))}
          </div>
        )}
      </section>

      <section className="ss-section" aria-labelledby="pages-records-head">
        <SectionHead
          id="pages-records-head"
          title="Page records"
          meta={records ? records.length.toLocaleString('en-US') : null}
        />
        <p className="ss-note">
          The raw <code>{COLLECTIONS.page}</code> records on your PDS, including any
          page slugs beyond the built-in pages above.
        </p>
        {failed ? (
          <p className="ss-empty">Not loaded.</p>
        ) : records === null ? (
          <PageRowsSkeleton rows={4} label="Loading page records" />
        ) : records.length === 0 ? (
          <p className="ss-empty">No page records on your PDS yet.</p>
        ) : (
          <ul className="ss-rows reveal-stagger">
            {records.map((rec) => {
              const r = rkeyFromUri(rec.uri);
              return (
                <li key={rec.uri} className="ss-row">
                  <Link className="pages-rec" {...pageRecordLink(go, r)}>
                    <span className="ident pages-rec-key">{r}</span>
                    <span className="pages-rec-title">
                      {rec.value?.title || rec.value?.intro || ''}
                    </span>
                    {/* The rows the count under this list is about. It used to
                        name a number — "3 records outside the built-in page
                        surfaces" — over eight rows drawn identically, so there
                        was no way to tell WHICH three; and the Front Desk sends
                        you here with the same number as a task. */}
                    {!known.has(r) && <Tag className="pages-rec-tag">extra</Tag>}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {extraRecords.length > 0 && (
          <p className="ss-hint">
            The {extraRecords.length} row{extraRecords.length === 1 ? '' : 's'} tagged{' '}
            <strong>extra</strong> {extraRecords.length === 1 ? 'is a page slug' : 'are page slugs'}{' '}
            beyond the built-in pages above.
          </p>
        )}
      </section>
    </>
  );
}
