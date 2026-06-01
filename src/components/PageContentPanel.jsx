import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pageDefault } from '../lib/pageRegistry.js';
import { blankRecordFor } from '../lib/lexicons.js';
import { COLLECTIONS } from '../config.js';

/**
 * Local-vs-PDS control for a single page's chrome (title / intro / body).
 *
 * Shows whether an `is.dame.page/<slug>` record exists and lets the owner
 * migrate the hardcoded defaults onto the PDS, edit the record, or revert
 * back to local (delete the record).
 *
 * Used in two places:
 *   - embedded atop a backing collection's record list (self-fetches status)
 *   - the standalone Site-pages overview (status seeded via the `exists` prop
 *     from one batched listRecords, so it skips the per-panel getRecord)
 */
export default function PageContentPanel({ agent, did, slug, exists: initialExists }) {
  const def = pageDefault(slug);
  const [exists, setExists] = useState(initialExists);
  const [checking, setChecking] = useState(initialExists === undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Self-fetch status when the caller didn't supply it (embedded usage).
  useEffect(() => {
    if (initialExists !== undefined) {
      setExists(initialExists);
      setChecking(false);
      return undefined;
    }
    let cancelled = false;
    setChecking(true);
    agent.com.atproto.repo
      .getRecord({ repo: did, collection: COLLECTIONS.page, rkey: slug })
      .then(() => {
        if (!cancelled) setExists(true);
      })
      .catch(() => {
        if (!cancelled) setExists(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, did, slug, initialExists]);

  const migrate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const record = { ...blankRecordFor(COLLECTIONS.page), title: def.title, intro: def.intro };
      if (def.body) record.body = def.body;
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COLLECTIONS.page,
        rkey: slug,
        record,
      });
      setExists(true);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [agent, did, slug, def]);

  const revert = useCallback(async () => {
    if (
      !window.confirm(
        `Revert "${def.label}" to local? This deletes is.dame.page/${slug} from your PDS; the page falls back to its hardcoded title and intro.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection: COLLECTIONS.page, rkey: slug });
      setExists(false);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [agent, did, slug, def]);

  if (!def) return null;

  return (
    <div className="admin-page-panel">
      <div className="admin-page-panel-head">
        <span className="admin-page-panel-label">{def.label} — page content</span>
        <span className={`admin-badge ${exists ? 'admin-badge-pds' : 'admin-badge-local'}`}>
          {checking ? '…' : exists ? 'PDS' : 'Local'}
        </span>
      </div>
      <p className="admin-page-panel-desc">
        {checking ? (
          'Checking status…'
        ) : exists ? (
          <>
            Title &amp; intro are served from <code>is.dame.page/{slug}</code> on your PDS.
          </>
        ) : (
          <>
            Title &amp; intro are hardcoded in the site. Migrate to edit them on your PDS.
          </>
        )}
      </p>
      <div className="admin-page-panel-actions">
        {exists ? (
          <>
            <Link
              className="admin-gate-button admin-gate-button-tight"
              to={`/admin?c=${encodeURIComponent(COLLECTIONS.page)}&r=${encodeURIComponent(slug)}`}
            >
              Edit
            </Link>
            <button
              type="button"
              className="admin-gate-button admin-gate-button-tight admin-danger"
              onClick={revert}
              disabled={busy}
            >
              {busy ? 'Reverting…' : 'Revert to local'}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="admin-gate-button admin-gate-button-tight"
            onClick={migrate}
            disabled={busy || checking}
          >
            {busy ? 'Migrating…' : 'Migrate to PDS'}
          </button>
        )}
      </div>
      {error && <p className="admin-error">{error}</p>}
    </div>
  );
}
