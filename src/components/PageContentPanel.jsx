import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { pageDefault } from '../lib/pageRegistry.js';
import { blankRecordFor } from '../lib/lexicons.js';
import { COLLECTIONS } from '../config.js';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { Skeleton } from './Skeleton.jsx';

/**
 * Link props for one `is.dame.page` record on the GENERIC records surface —
 * which is where page records are actually edited — as both the `to` a real
 * `<Link>` needs and an onClick that routes through the shell's `go`.
 *
 * The explicit `view: null` is the load-bearing part. `go` is merge-only, and a
 * leftover `view=pages` beats `c` in `resolveSurface`'s precedence, so without
 * it "Edit" pressed inside the Site-pages studio would resolve straight back to
 * that studio and read as a dead click. Going through `go` rather than letting
 * the `<Link>` navigate is what runs the unsaved-changes guard — this panel has
 * no edits of its own, but it renders beside a detail pane that may.
 *
 * Modified and non-primary clicks are left to the browser, so cmd-click still
 * opens a record in a new tab.
 *
 * @param {(patch: object) => void} go   from `useAdminShell()`
 * @param {string|null} rkey             the page slug, or null for a new record
 * @param {{mode?: string|null}} [opts]
 */
export function pageRecordLink(go, rkey, { mode = null } = {}) {
  const patch = { view: null, c: COLLECTIONS.page, r: rkey, mode, for: null };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(patch)) if (value != null) query.set(key, value);
  return {
    to: `/admin?${query}`,
    onClick: (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      go(patch);
    },
  };
}

/**
 * Local-vs-PDS control for a single page's chrome (title / intro / body).
 *
 * Shows whether an `is.dame.page/<slug>` record exists and lets the owner
 * migrate the hardcoded defaults onto the PDS, edit the record, or revert
 * back to local (delete the record).
 *
 * Used in two places, both of them inside the admin shell:
 *   - embedded atop a backing collection's record list (self-fetches status)
 *   - the standalone Site-pages studio (status seeded via the `exists` prop
 *     from one batched listRecords, so it skips the per-panel getRecord)
 */
export default function PageContentPanel({ agent, did, slug, exists: initialExists }) {
  const { go } = useAdminShell();
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
        <span
          className={`admin-badge ${
            checking ? '' : exists ? 'admin-badge-pds' : 'admin-badge-local'
          }`}
        >
          {checking ? (
            <Skeleton width="1.75rem" height="0.7rem" />
          ) : exists ? (
            'PDS'
          ) : (
            'Local'
          )}
        </span>
      </div>
      <p className="admin-page-panel-desc">
        {checking ? (
          <Skeleton width="70%" height="0.85em" />
        ) : exists ? (
          <span className="reveal">
            Title &amp; intro are served from <code>is.dame.page/{slug}</code> on your PDS.
          </span>
        ) : (
          <span className="reveal">
            Title &amp; intro are hardcoded in the site. Migrate to edit them on your PDS.
          </span>
        )}
      </p>
      <div className="admin-page-panel-actions">
        {exists ? (
          <>
            <Link className="admin-gate-button admin-gate-button-tight" {...pageRecordLink(go, slug)}>
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
