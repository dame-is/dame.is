// Legacy blog migration: publish the pre-rewrite Eleventy markdown posts to the
// PDS as standard.site blog documents, images and all.
//
// Lifted verbatim out of src/pages/Admin.jsx. Behaviour is unchanged; the only
// edits are the studio contract — the workbench pane draws the title and the
// blurb and the rail is the way back, so there is no PageShell and no
// "← All collections" link here. "Migrate all" stays: it is this tool's own
// action, not a record save, and nothing about it belongs on the shell's status
// strip.
//
// Note for anyone reading the counts elsewhere: the migrated-set read below is a
// single un-paginated `limit: 100` page of `site.standard.document`, so "already
// migrated" is only exact while that collection fits in one page.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { LEGACY_POSTS, migratedSlugs, migratePost } from '../lib/legacyBlog.js';
import { formatDateLong } from '../lib/time.js';

const STANDARD_DOC = 'site.standard.document';

export default function LegacyBlogMigration({ agent, did }) {
  // This tool writes site.standard.document, which is what the Front Desk's
  // "Documents published" tile counts and what the Blogging and Creating lists
  // read. Without telling the shell, a migration of eight posts would leave both
  // reporting the pre-migration number for up to the counts cache's 60s TTL.
  const { invalidate } = useAdminShell();
  // Per-slug migration state: { status, message, href }.
  const [state, setState] = useState({});
  const [migrated, setMigrated] = useState(null); // Set of already-migrated slugs
  const [loadError, setLoadError] = useState(null);
  const [runningAll, setRunningAll] = useState(false);

  const refreshMigrated = useCallback(async () => {
    try {
      const slugs = LEGACY_POSTS.map((p) => p.slug);
      const res = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: STANDARD_DOC,
        limit: 100,
      });
      const records = (res?.data || res)?.records || [];
      setMigrated(migratedSlugs(records, slugs));
    } catch (err) {
      setLoadError(err?.message || String(err));
      setMigrated(new Set());
    }
  }, [agent, did]);

  useEffect(() => {
    refreshMigrated();
  }, [refreshMigrated]);

  const runOne = useCallback(
    async (post) => {
      setState((s) => ({ ...s, [post.slug]: { status: 'running', message: 'Starting…' } }));
      try {
        const result = await migratePost({
          agent,
          did,
          post,
          onProgress: (message) =>
            setState((s) => ({ ...s, [post.slug]: { status: 'running', message } })),
        });
        setState((s) => ({
          ...s,
          [post.slug]: { status: 'done', message: 'Migrated.', href: result.href },
        }));
        setMigrated((prev) => new Set(prev).add(post.slug));
        // Scoped to the one collection a migration touches, and placed on the
        // single write rather than on the "Migrate all" wrapper, so a per-post
        // Migrate is covered too. Cheap even in the eight-post loop: nothing
        // that reads counts is mounted on a studio surface, so this drops a
        // cache entry rather than firing a re-read.
        invalidate(STANDARD_DOC);
        return true;
      } catch (err) {
        setState((s) => ({
          ...s,
          [post.slug]: { status: 'error', message: err?.message || String(err) },
        }));
        return false;
      }
    },
    [agent, did, invalidate],
  );

  const runAll = useCallback(async () => {
    setRunningAll(true);
    // Sequential — image uploads are the bottleneck and this keeps the PDS
    // write load gentle and the progress readable.
    for (const post of LEGACY_POSTS) {
      if (migrated?.has(post.slug)) continue;
      // eslint-disable-next-line no-await-in-loop
      await runOne(post);
    }
    setRunningAll(false);
  }, [migrated, runOne]);

  const pendingCount = LEGACY_POSTS.filter((p) => !migrated?.has(p.slug)).length;

  return (
    <>
      <div className="admin-toolbar">
        <button
          type="button"
          className="admin-gate-button admin-gate-button-tight"
          onClick={runAll}
          disabled={runningAll || migrated == null || pendingCount === 0}
        >
          {runningAll
            ? 'Migrating…'
            : pendingCount === 0
              ? 'All migrated'
              : `Migrate all (${pendingCount})`}
        </button>
      </div>

      {loadError && <p className="admin-error">Couldn’t check existing posts: {loadError}</p>}

      <ul className="admin-record-list legacy-blog-list">
        {LEGACY_POSTS.map((post) => {
          const st = state[post.slug];
          const isMigrated = migrated?.has(post.slug);
          const busy = st?.status === 'running' || runningAll;
          return (
            <li key={post.slug} className="admin-record-row legacy-blog-row">
              <div className="legacy-blog-main">
                <div className="legacy-blog-head">
                  <span className="legacy-blog-title">{post.title}</span>
                  {isMigrated && <span className="small-caps legacy-blog-badge">migrated</span>}
                </div>
                <div className="legacy-blog-meta small-caps">
                  {formatDateLong(post.publishedAt)}
                  <span className="legacy-blog-dot">·</span>
                  <code className="admin-record-rkey">/blogging/{post.slug}</code>
                  {post.images.length > 0 && (
                    <>
                      <span className="legacy-blog-dot">·</span>
                      {post.images.length} image{post.images.length === 1 ? '' : 's'}
                    </>
                  )}
                </div>
                {post.description && (
                  <p className="legacy-blog-excerpt">{post.description}</p>
                )}
                {st?.message && (
                  <p
                    className={`legacy-blog-status${st.status === 'error' ? ' admin-error-inline' : ''}${
                      st.status === 'done' ? ' admin-success' : ''
                    }`}
                  >
                    {st.message}{' '}
                    {st.status === 'done' && st.href && (
                      <Link to={st.href} className="admin-link-subtle">View →</Link>
                    )}
                  </p>
                )}
              </div>
              <div className="legacy-blog-actions">
                <button
                  type="button"
                  className="admin-gate-button admin-gate-button-tight"
                  onClick={() => runOne(post)}
                  disabled={busy}
                >
                  {st?.status === 'running'
                    ? 'Migrating…'
                    : isMigrated
                      ? 'Re-migrate'
                      : 'Migrate'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
