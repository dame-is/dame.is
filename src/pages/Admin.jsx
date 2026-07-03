import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import RecordEditor, { rkeyFromUri } from '../components/RecordEditor.jsx';
import PageContentPanel from '../components/PageContentPanel.jsx';
import { VARIANTS_A, VARIANTS_B } from '../components/HeroSentence.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_DID, COLLECTIONS, PORTFOLIO_PUBLICATION } from '../config.js';
import { LEXICONS, lexiconFor, knownCollections } from '../lib/lexicons.js';

const STANDARD_DOC = 'site.standard.document';
import { knownPageSlugs, pageSlugForCollection } from '../lib/pageRegistry.js';
import { LEGACY_POSTS, migratedSlugs, migratePost } from '../lib/legacyBlog.js';
import { formatDateLong } from '../lib/time.js';
import './Admin.css';

/**
 * Admin / CRUD editor. Single route — internal mode is driven by query params:
 *
 *   /admin                                  → collection picker
 *   /admin?c=<nsid>                         → record list for that collection
 *   /admin?c=<nsid>&r=<rkey>                → edit existing record
 *   /admin?c=<nsid>&mode=new                → create new record
 *
 * Using query params (not path segments) sidesteps the dot-in-path issue
 * with the SPA rewrite rule and keeps NSIDs like `app.bsky.feed.post` clean.
 */
export default function Admin() {
  const { session, agent, did, loading, signIn } = useAtprotoSession();
  const [params] = useSearchParams();
  const collection = params.get('c');
  const rkey = params.get('r');
  const mode = params.get('mode');
  const view = params.get('view');

  if (loading) {
    return (
      <PageShell title="Admin" headTitle="Admin — Dame is…">
        <p className="placeholder-card">Restoring session…</p>
      </PageShell>
    );
  }

  if (!session) {
    return (
      <PageShell title="Admin" headTitle="Admin — Dame is…">
        <SignInGate signIn={signIn} />
      </PageShell>
    );
  }

  if (did !== ME_DID) {
    return (
      <PageShell title="Admin" headTitle="Admin — Dame is…">
        <p className="placeholder-card">
          Signed in as <code>{did}</code>, but this editor is restricted to{' '}
          <code>{ME_DID}</code>.
        </p>
      </PageShell>
    );
  }

  if (view === 'pages') {
    return <PagesOverview agent={agent} did={did} />;
  }
  if (view === 'legacy-blogs') {
    return <LegacyBlogMigration agent={agent} did={did} />;
  }
  if (!collection) {
    return <CollectionPicker />;
  }
  if (mode === 'new') {
    return (
      <RecordEditorPage
        agent={agent}
        did={did}
        collection={collection}
        rkey={null}
        preset={params.get('for')}
      />
    );
  }
  if (rkey) {
    return <RecordEditorPage agent={agent} did={did} collection={collection} rkey={rkey} />;
  }
  return <RecordList agent={agent} did={did} collection={collection} />;
}

/* ------------------------------------------------------------------ */
/* Gates                                                                */
/* ------------------------------------------------------------------ */

function SignInGate({ signIn }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function onSubmit(event) {
    event.preventDefault();
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(input.trim());
    } catch (err) {
      setBusy(false);
      setError(err?.message || String(err));
    }
  }

  return (
    <form className="admin-gate" onSubmit={onSubmit}>
      <p className="admin-gate-intro">
        Sign in with your ATProto handle to edit records on your PDS.
      </p>
      <input
        className="admin-gate-input"
        placeholder="handle, DID, or PDS URL"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        autoFocus
        spellCheck={false}
      />
      <button type="submit" className="admin-gate-button" disabled={busy || !input.trim()}>
        {busy ? 'Redirecting…' : 'Sign in'}
      </button>
      {error && <p className="admin-error">{error}</p>}
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Collection picker                                                    */
/* ------------------------------------------------------------------ */

function CollectionPicker() {
  const all = knownCollections();
  const primary = all.filter((nsid) => !LEXICONS[nsid]?.legacy);
  const legacy = all.filter((nsid) => LEXICONS[nsid]?.legacy);

  const renderRow = (nsid) => {
    const lex = LEXICONS[nsid];
    return (
      <li key={nsid} className={`admin-collection-row${lex.legacy ? ' admin-collection-row-legacy' : ''}`}>
        <Link to={`/admin?c=${encodeURIComponent(nsid)}`} className="admin-collection-link">
          <span className="admin-collection-label">{lex.label}</span>
          <code className="admin-collection-nsid">{nsid}</code>
        </Link>
        {lex.summary && <p className="admin-collection-summary">{lex.summary}</p>}
      </li>
    );
  };

  return (
    <PageShell
      title="Collections"
      intro="Pick a collection to browse and edit records on your PDS."
      headTitle="Admin — Dame is…"
    >
      <div className="admin-quick-actions">
        <Link
          className="admin-gate-button"
          to={`/admin?c=${encodeURIComponent(STANDARD_DOC)}&mode=new&for=creating`}
        >
          New creative work
        </Link>
        <Link
          className="admin-gate-button"
          to={`/admin?c=${encodeURIComponent(STANDARD_DOC)}&mode=new`}
        >
          New blog post
        </Link>
      </div>

      <ul className="admin-collection-list">
        <li className="admin-collection-row">
          <Link to="/admin?view=pages" className="admin-collection-link">
            <span className="admin-collection-label">Site pages (Local vs PDS)</span>
            <code className="admin-collection-nsid">is.dame.page</code>
          </Link>
          <p className="admin-collection-summary">
            See which pages serve their title &amp; intro from the PDS vs hardcoded
            defaults, and migrate or revert them.
          </p>
        </li>
        <li className="admin-collection-row">
          <Link to="/admin?view=legacy-blogs" className="admin-collection-link">
            <span className="admin-collection-label">Legacy blog migration</span>
            <code className="admin-collection-nsid">{STANDARD_DOC}</code>
          </Link>
          <p className="admin-collection-summary">
            The old Eleventy markdown blog posts, ready to publish to your PDS as
            standard.site documents with one click.
          </p>
        </li>
        {primary.map(renderRow)}
        <li className="admin-collection-row admin-collection-row-custom">
          <CustomCollectionInput />
        </li>
      </ul>

      {legacy.length > 0 && (
        <>
          <div className="admin-collection-legacy-heading small-caps">Legacy</div>
          <ul className="admin-collection-list">{legacy.map(renderRow)}</ul>
        </>
      )}
    </PageShell>
  );
}

function CustomCollectionInput() {
  const [value, setValue] = useState('');
  return (
    <form
      className="admin-custom-row"
      onSubmit={(e) => {
        e.preventDefault();
        const nsid = value.trim();
        if (!nsid) return;
        window.location.assign(`/admin?c=${encodeURIComponent(nsid)}`);
      }}
    >
      <label className="admin-collection-label">Other collection</label>
      <input
        className="admin-gate-input"
        placeholder="e.g. fm.teal.alpha.feed.play"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="admin-gate-button">Browse</button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Record list                                                          */
/* ------------------------------------------------------------------ */

function RecordList({ agent, did, collection }) {
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lex = lexiconFor(collection);
  const pageSlug = pageSlugForCollection(collection);
  const isHero = collection === COLLECTIONS.heroPhrase;

  const loadPage = useCallback(
    async (after) => {
      setLoading(true);
      setError(null);
      try {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection,
          limit: 50,
          cursor: after || undefined,
        });
        const next = res?.data || res;
        const batch = next?.records || [];
        setRecords((prev) => (after ? [...prev, ...batch] : batch));
        setCursor(next?.cursor);
        if (!next?.cursor || batch.length === 0) setDone(true);
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    },
    [agent, did, collection],
  );

  const reload = useCallback(() => {
    setRecords([]);
    setCursor(undefined);
    setDone(false);
    loadPage(undefined);
  }, [loadPage]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <PageShell
      title={lex?.label || collection}
      headTitle={`${lex?.label || collection} — Admin — Dame is…`}
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{collection}</code>
        <Link
          to={`/admin?c=${encodeURIComponent(collection)}&mode=new`}
          className="admin-gate-button admin-gate-button-tight"
        >
          New record
        </Link>
        {isHero && (
          <HeroSeedButton agent={agent} did={did} existingCount={records.length} onSeeded={reload} />
        )}
      </div>

      {pageSlug && <PageContentPanel agent={agent} did={did} slug={pageSlug} />}

      {error && <p className="admin-error">{error}</p>}

      {records.length === 0 && !loading && !error && (
        <p className="placeholder-card">No records yet in this collection.</p>
      )}

      <ul className="admin-record-list">
        {records.map((rec) => {
          const r = rkeyFromUri(rec.uri);
          return (
            <li key={rec.uri} className="admin-record-row">
              <Link
                to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(r)}`}
                className="admin-record-link"
              >
                <code className="admin-record-rkey">{r}</code>
                <span className="admin-record-preview">{previewFor(rec.value, lex)}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {!done && records.length > 0 && (
        <button
          type="button"
          className="admin-gate-button admin-gate-button-tight"
          disabled={loading}
          onClick={() => loadPage(cursor)}
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
      {loading && records.length === 0 && <p className="placeholder-card">Loading records…</p>}
    </PageShell>
  );
}

function previewFor(value, lex) {
  if (!value || typeof value !== 'object') return '';
  if (lex?.fields) {
    for (const f of lex.fields) {
      const v = value[f.key];
      if (typeof v === 'string' && v.trim()) {
        return f.key === 'createdAt' || f.key === 'updatedAt' ? '' : truncate(v, 120);
      }
    }
  }
  for (const k of ['title', 'status', 'text', 'name']) {
    if (typeof value[k] === 'string' && value[k].trim()) return truncate(value[k], 120);
  }
  return '';
}

function truncate(s, n) {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

/* ------------------------------------------------------------------ */
/* Hero phrase seeding                                                  */
/* ------------------------------------------------------------------ */

function HeroSeedButton({ agent, did, existingCount, onSeeded }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function seed() {
    if (existingCount > 0) {
      if (
        !window.confirm(
          `This collection already has ${existingCount} record(s). Seed the built-in defaults anyway? This may create duplicates.`,
        )
      ) {
        return;
      }
    } else if (!window.confirm('Create the built-in hero phrases as records on your PDS?')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const seedPart = async (part, list) => {
        for (const text of list) {
          await agent.com.atproto.repo.createRecord({
            repo: did,
            collection: COLLECTIONS.heroPhrase,
            record: {
              $type: COLLECTIONS.heroPhrase,
              part,
              text,
              enabled: true,
              createdAt: new Date().toISOString(),
            },
          });
        }
      };
      await seedPart('role', VARIANTS_A);
      await seedPart('clause', VARIANTS_B);
      onSeeded?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="admin-gate-button admin-gate-button-tight"
        onClick={seed}
        disabled={busy}
      >
        {busy ? 'Seeding…' : 'Seed defaults'}
      </button>
      {error && <p className="admin-error">{error}</p>}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Site pages overview                                                  */
/* ------------------------------------------------------------------ */

function PagesOverview({ agent, did }) {
  const [existing, setExisting] = useState(null); // Set of slugs that have a record
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    agent.com.atproto.repo
      .listRecords({ repo: did, collection: COLLECTIONS.page, limit: 100 })
      .then((res) => {
        const next = res?.data || res;
        const set = new Set((next?.records || []).map((r) => rkeyFromUri(r.uri)));
        if (!cancelled) setExisting(set);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || String(err));
          setExisting(new Set());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agent, did]);

  return (
    <PageShell
      title="Site pages"
      intro="Each page's title and intro can live in the site (Local) or as an is.dame.page record on your PDS."
      headTitle="Site pages — Admin — Dame is…"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
      </div>

      {error && <p className="admin-error">{error}</p>}

      {existing === null ? (
        <p className="placeholder-card">Loading pages…</p>
      ) : (
        <div className="admin-page-panels">
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
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Legacy blog migration                                                */
/* ------------------------------------------------------------------ */

function LegacyBlogMigration({ agent, did }) {
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
        return true;
      } catch (err) {
        setState((s) => ({
          ...s,
          [post.slug]: { status: 'error', message: err?.message || String(err) },
        }));
        return false;
      }
    },
    [agent, did],
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
    <PageShell
      title="Legacy blog migration"
      intro="Publish the pre-rewrite Eleventy markdown posts to your PDS as standard.site blog documents. Images are uploaded as blobs and each post keeps its original slug, so old /blog links keep working. Re-running a migration overwrites the existing record rather than duplicating it."
      headTitle="Legacy blog migration — Admin — Dame is…"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
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
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Record editor page wrapper                                           */
/* ------------------------------------------------------------------ */

function RecordEditorPage({ agent, did, collection, rkey, preset = null }) {
  const lex = lexiconFor(collection);
  const isNew = !rkey;
  const isCreatingPreset = preset === 'creating' && collection === STANDARD_DOC;
  // A "New creative work" preset pre-selects the portfolio publication so the
  // doc lands on /creating. (No-op until PORTFOLIO_PUBLICATION is set.)
  const initialValue = useMemo(
    () => (isCreatingPreset && PORTFOLIO_PUBLICATION ? { site: PORTFOLIO_PUBLICATION } : null),
    [isCreatingPreset],
  );
  const newLabel = isCreatingPreset
    ? 'creative work'
    : collection === STANDARD_DOC
      ? 'blog post'
      : lex?.label || collection;
  const title = isNew ? `New ${newLabel}` : `${lex?.label || collection}`;
  const headTitle = `${title} — Admin — Dame is…`;

  return (
    <PageShell title={title} headTitle={headTitle}>
      <div className="admin-toolbar">
        <Link to={`/admin?c=${encodeURIComponent(collection)}`} className="admin-link-subtle">
          ← Back to list
        </Link>
        <code className="admin-collection-nsid">{collection}</code>
        {!isNew && <code className="admin-record-rkey">{rkey}</code>}
      </div>
      {isCreatingPreset && !PORTFOLIO_PUBLICATION && (
        <p className="admin-field-hint">
          No portfolio publication is configured yet — set <code>PORTFOLIO_PUBLICATION</code> in
          config, or pick the publication manually below.
        </p>
      )}
      <RecordEditor
        agent={agent}
        did={did}
        collection={collection}
        rkey={rkey}
        initialValue={initialValue}
        onCreated={({ rkey: newRkey }) => {
          window.location.assign(
            `/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(newRkey)}`,
          );
        }}
        onDeleted={() => {
          window.location.assign(`/admin?c=${encodeURIComponent(collection)}`);
        }}
      />
    </PageShell>
  );
}

