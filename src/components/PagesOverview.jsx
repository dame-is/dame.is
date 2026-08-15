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
import PageContentPanel, { pageRecordLink } from './PageContentPanel.jsx';
import { rkeyFromUri } from './RecordEditor.jsx';
import { AdminRecordListSkeleton, AdminPagePanelsSkeleton } from './Skeleton.jsx';
import { COLLECTIONS } from '../config.js';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { knownPageSlugs } from '../lib/pageRegistry.js';

export default function PagesOverview({ agent, did }) {
  // Page records are edited on the generic records surface, so every link out of
  // this studio has to clear `view` explicitly — see `pageRecordLink`.
  const { go } = useAdminShell();
  const [records, setRecords] = useState(null); // is.dame.page records on the PDS
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    agent.com.atproto.repo
      .listRecords({ repo: did, collection: COLLECTIONS.page, limit: 100 })
      .then((res) => {
        const next = res?.data || res;
        if (!cancelled) setRecords(next?.records || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || String(err));
          setRecords([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agent, did]);

  const existing = useMemo(
    () => new Set((records || []).map((r) => rkeyFromUri(r.uri))),
    [records],
  );
  // Records whose slug isn't one of the known page surfaces — surfaced in the
  // raw records section so they're still reachable/editable.
  const known = new Set(knownPageSlugs());
  const extraRecords = (records || []).filter((r) => !known.has(rkeyFromUri(r.uri)));

  return (
    <>
      <div className="admin-toolbar">
        <Link
          className="admin-gate-button admin-gate-button-tight"
          {...pageRecordLink(go, null, { mode: 'new' })}
        >
          New page record
        </Link>
      </div>

      {error && <p className="admin-error">{error}</p>}

      <section className="admin-page-section">
        <h2 className="admin-collection-group-heading small-caps">Local vs PDS</h2>
        <p className="admin-collection-group-note">
          Which pages serve their title &amp; intro from a PDS record vs the
          hardcoded defaults. Migrate or revert any of them.
        </p>
        {records === null ? (
          <AdminPagePanelsSkeleton panels={knownPageSlugs().length || 4} />
        ) : (
          <div className="admin-page-panels reveal">
            {knownPageSlugs().map((slug) => (
              <PageContentPanel
                key={slug}
                agent={agent}
                did={did}
                slug={slug}
                exists={existing.has(slug)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="admin-page-section">
        <h2 className="admin-collection-group-heading small-caps">Page records</h2>
        <p className="admin-collection-group-note">
          The raw <code>{COLLECTIONS.page}</code> records on your PDS, including any
          page slugs beyond the built-in surfaces above.
        </p>
        {records === null ? (
          <AdminRecordListSkeleton rows={4} label="Loading page records" />
        ) : records.length === 0 ? (
          <p className="placeholder-card">No page records on your PDS yet.</p>
        ) : (
          <ul className="admin-record-list reveal-stagger">
            {records.map((rec) => {
              const r = rkeyFromUri(rec.uri);
              return (
                <li key={rec.uri} className="admin-record-row">
                  <Link className="admin-record-link" {...pageRecordLink(go, r)}>
                    <code className="admin-record-rkey">{r}</code>
                    <span className="admin-record-preview">
                      {rec.value?.title || rec.value?.intro || ''}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {extraRecords.length > 0 && (
          <p className="admin-field-hint">
            {extraRecords.length} record{extraRecords.length === 1 ? '' : 's'} outside the
            built-in page surfaces.
          </p>
        )}
      </section>
    </>
  );
}
