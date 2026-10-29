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
import Button from './Button.jsx';
import Tag from './Tag.jsx';
import Time from './Time.jsx';
import './siteStudios.css';
import './LegacyBlogMigration.css';

const STANDARD_DOC = 'site.standard.document';

export default function LegacyBlogMigration({ agent, did }) {
  // This tool writes site.standard.document, which is what the Front Desk's
  // "Documents published" tile counts and what the Blogging and Creating lists
  // read. Without telling the shell, a migration of eight posts would leave both
  // reporting the pre-migration number for up to the counts cache's 60s TTL.
  const { invalidate, stacked } = useAdminShell();
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
      await runOne(post);
    }
    setRunningAll(false);
  }, [migrated, runOne]);

  const pendingCount = LEGACY_POSTS.filter((p) => !migrated?.has(p.slug)).length;

  // Desktop only, and stated rather than degraded (§6 of the mobile design).
  // This tool reads markdown out of the repo and writes records with their
  // images; it is a one-time job whose rows are 45–60-character slugs beside a
  // per-row button, and there is no version of that which is a phone screen.
  // The count is the part worth carrying — "is there anything left to do" is a
  // question you can answer from anywhere.
  if (stacked) {
    return (
      <>
        {loadError && <p className="ss-error">Couldn’t check existing posts: {loadError}</p>}
        <p className="ss-hint">
          {LEGACY_POSTS.length === 0
            ? 'No legacy posts are bundled in this build.'
            : migrated == null
              ? 'Checking what has already been migrated…'
              : pendingCount === 0
                ? `All ${LEGACY_POSTS.length} legacy posts are migrated.`
                : `${pendingCount} of ${LEGACY_POSTS.length} legacy posts still to migrate.`}
        </p>
        <p className="ss-empty">Migration runs from a desktop.</p>
      </>
    );
  }

  return (
    <>
      {/* The tool's one commit, so the view's one primary. */}
      <div className="ss-actions">
        <Button
          variant="primary"
          onClick={runAll}
          disabled={runningAll || migrated == null || pendingCount === 0}
        >
          {runningAll
            ? 'Migrating…'
            : pendingCount === 0
              ? 'All migrated'
              : `Migrate all (${pendingCount})`}
        </Button>
      </div>

      {loadError && <p className="ss-error">Couldn’t check existing posts: {loadError}</p>}

      <ul className="ss-rows lbm-list">
        {LEGACY_POSTS.map((post) => {
          const st = state[post.slug];
          const isMigrated = migrated?.has(post.slug);
          const busy = st?.status === 'running' || runningAll;
          return (
            <li key={post.slug} className="ss-row lbm-row">
              <div className="lbm-main">
                <div className="lbm-head">
                  <span className="lbm-title">{post.title}</span>
                  {isMigrated && <Tag on>migrated</Tag>}
                </div>
                {/* The slug is an identifier and wraps like one; a real
                    45–60-character slug in a fixed key column used to stack
                    6–8 lines tall and drag the row to 260px. */}
                <div className="lbm-meta">
                  <Time value={post.publishedAt} variant="dateShort" />
                  <span className="ident">/blogging/{post.slug}</span>
                  {post.images.length > 0 && (
                    <span>
                      {post.images.length} image{post.images.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                {post.description && <p className="lbm-excerpt">{post.description}</p>}
                {st?.message && (
                  <p
                    className={`lbm-status${st.status === 'error' ? ' ss-error' : ''}${
                      st.status === 'done' ? ' ss-saved' : ''
                    }`}
                  >
                    {st.message}{' '}
                    {st.status === 'done' && st.href && (
                      <Button as={Link} to={st.href} variant="text" size="sm">
                        View →
                      </Button>
                    )}
                  </p>
                )}
              </div>
              <div className="lbm-actions">
                {/* Re-migrating writes over every edit made since, so it wears
                    the danger tier; a first migration is an everyday action. */}
                <Button
                  size="sm"
                  variant={isMigrated ? 'danger' : 'quiet'}
                  onClick={() => {
                    // A second migration writes the same rkey (migratePost
                    // overwrites rather than duplicating), so on a post that is
                    // already there it puts the original markdown conversion
                    // back over every edit since — a typo fix, a linked comments
                    // thread. One click was all that took.
                    if (
                      isMigrated &&
                      !window.confirm(
                        `Re-import “${post.title}” from the legacy markdown? Any edits made to it since it was migrated will be overwritten.`,
                      )
                    ) {
                      return;
                    }
                    runOne(post);
                  }}
                  disabled={busy}
                >
                  {st?.status === 'running'
                    ? 'Migrating…'
                    : isMigrated
                      ? 'Re-migrate'
                      : 'Migrate'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
