import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import RecordEditor, { rkeyFromUri } from '../components/RecordEditor.jsx';
import PageContentPanel from '../components/PageContentPanel.jsx';
import GuestbookModerationPanel from '../components/GuestbookModerationPanel.jsx';
import ResumeStudio from '../components/resume/ResumeStudio.jsx';
import ResumeWorkbench from '../components/resume/ResumeWorkbench.jsx';
import { AdminRecordListSkeleton, AdminPagePanelsSkeleton } from '../components/Skeleton.jsx';
import { VARIANTS_A, VARIANTS_B } from '../components/HeroSentence.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { useEditMode } from '../hooks/useEditMode.jsx';
import { ME_DID, COLLECTIONS, PORTFOLIO_PUBLICATION } from '../config.js';
import { LEXICONS, lexiconFor, knownCollections } from '../lib/lexicons.js';

const STANDARD_DOC = 'site.standard.document';
import { knownPageSlugs, pageSlugForCollection } from '../lib/pageRegistry.js';
import { LEGACY_POSTS, migratedSlugs, migratePost } from '../lib/legacyBlog.js';
import { visibilityModelFor } from '../lib/recordVisibility.js';
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
      <PageShell title="Admin" headTitle="Admin — dame.is">
        <AdminRecordListSkeleton toolbar rows={5} label="Restoring session" />
      </PageShell>
    );
  }

  if (!session) {
    return (
      <PageShell title="Admin" headTitle="Admin — dame.is">
        <SignInGate signIn={signIn} />
      </PageShell>
    );
  }

  if (did !== ME_DID) {
    return (
      <PageShell title="Admin" headTitle="Admin — dame.is">
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
  if (view === 'guestbook') {
    return <GuestbookModerationPanel agent={agent} />;
  }
  if (view === 'listening') {
    return <ListeningManager agent={agent} did={did} />;
  }
  if (view === 'resume') {
    return <ResumeStudio agent={agent} did={did} />;
  }
  if (view === 'resume-tailor' && rkey) {
    return <ResumeWorkbench agent={agent} did={did} rkey={rkey} />;
  }
  if (view === 'blogging') {
    return (
      <RecordList
        agent={agent}
        did={did}
        collection={STANDARD_DOC}
        title="Blogging"
        intro="Long-form blog posts — standard.site documents published to the blog publication."
        pageSlug="blogging"
        newHref={`/admin?c=${encodeURIComponent(STANDARD_DOC)}&mode=new`}
        recordFilter={(v) => v?.site !== PORTFOLIO_PUBLICATION}
      />
    );
  }
  if (view === 'creating') {
    return (
      <RecordList
        agent={agent}
        did={did}
        collection={STANDARD_DOC}
        title="Creating"
        intro="Creative works — standard.site documents published to the portfolio publication, rendered on /creating."
        pageSlug="creating"
        newHref={`/admin?c=${encodeURIComponent(STANDARD_DOC)}&mode=new&for=creating`}
        recordFilter={(v) => v?.site === PORTFOLIO_PUBLICATION}
      />
    );
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

/**
 * Curated navigation for the collection picker. Each entry names a destination
 * with its "proper" page name; `nsid` is shown as a subtle mono caption and,
 * for plain collections, drives the `/admin?c=` link. `to` overrides the
 * destination for the bespoke manager views (Blogging, Creating, Listening,
 * Site pages, Legacy blog migration).
 */
const PICKER_GROUPS = [
  {
    key: 'content',
    heading: 'Content',
    note: 'The gerund surfaces — everything that shows up in the feed.',
    items: [
      { to: '/admin?view=blogging', label: 'Blogging', nsid: STANDARD_DOC,
        summary: 'Long-form blog posts published to the blog publication.' },
      { to: '/admin?view=creating', label: 'Creating', nsid: STANDARD_DOC,
        summary: 'Creative works published to the portfolio publication (rendered on /creating).' },
      { collection: COLLECTIONS.now, label: 'Logging',
        summary: 'Short "what I am doing right now" status updates.' },
      { collection: 'app.bsky.feed.post', label: 'Posting',
        summary: 'Bluesky posts. Embeds are edited as raw JSON.' },
      { to: '/admin?view=listening', label: 'Listening', nsid: COLLECTIONS.listen,
        summary: 'Every play on your PDS — multi-select to bulk-delete, or open one in the editor.' },
      { collection: COLLECTIONS.arenaChannel, label: 'Curating',
        summary: 'Are.na channels published as galleries at /curating.' },
    ],
  },
  {
    key: 'site',
    heading: 'Site',
    note: 'Page chrome and identity records.',
    items: [
      { to: '/admin?view=pages', label: 'Site pages', nsid: COLLECTIONS.page,
        summary: 'Titles, intros, and page bodies — see which serve from the PDS vs local defaults, and edit the raw records.' },
      { to: '/admin?view=guestbook', label: 'Guestbook', nsid: 'is.dame.guestbook.entry',
        summary: 'Visitors\' signatures, gathered from backlinks. Hide/unhide them from public display — their records stay on their signers\' PDSes.' },
      { collection: COLLECTIONS.profile, label: 'About',
        summary: 'The extended profile (rkey "self") that backs /themself.' },
      { collection: COLLECTIONS.heroPhrase, label: 'Hero phrases',
        summary: 'Rotating phrases for the home hero sentence.' },
    ],
  },
  {
    key: 'resume',
    heading: 'Resume',
    note: 'Versions assembled from canonical job and education records.',
    items: [
      { to: '/admin?view=resume', label: 'Resume studio', nsid: COLLECTIONS.resume,
        summary: 'Every version, job, and education record in one place — duplicate a version, then tailor it: pick, reorder, re-word, and fork bullets per version.' },
    ],
  },
];

function CollectionPicker() {
  // Any lexicon flagged legacy, plus the legacy blog migration tool, live in
  // the collapsed-feeling Legacy group at the bottom.
  const legacyNsids = knownCollections().filter((nsid) => LEXICONS[nsid]?.legacy);

  const renderItem = (item) => {
    const nsid = item.nsid || item.collection;
    const to = item.to || `/admin?c=${encodeURIComponent(item.collection)}`;
    return (
      <li key={item.label + nsid} className="admin-collection-row">
        <Link to={to} className="admin-collection-link">
          <span className="admin-collection-label">{item.label}</span>
          {nsid && <code className="admin-collection-nsid">{nsid}</code>}
        </Link>
        {item.summary && <p className="admin-collection-summary">{item.summary}</p>}
      </li>
    );
  };

  return (
    <PageShell
      title="Admin"
      intro="Browse and edit the records that make up the site. Pick a surface below, or start something new."
      headTitle="Admin — dame.is"
    >
      <div className="admin-quick-actions">
        <Link
          className="admin-gate-button"
          to={`/admin?c=${encodeURIComponent(STANDARD_DOC)}&mode=new`}
        >
          New blog post
        </Link>
        <Link
          className="admin-gate-button"
          to={`/admin?c=${encodeURIComponent(STANDARD_DOC)}&mode=new&for=creating`}
        >
          New creative work
        </Link>
        <Link
          className="admin-gate-button"
          to={`/admin?c=${encodeURIComponent(COLLECTIONS.now)}&mode=new`}
        >
          New status
        </Link>
      </div>

      {PICKER_GROUPS.map((group) => (
        <section className="admin-collection-group" key={group.key}>
          <div className="admin-collection-group-head">
            <h2 className="admin-collection-group-heading small-caps">{group.heading}</h2>
            {group.note && <p className="admin-collection-group-note">{group.note}</p>}
          </div>
          <ul className="admin-collection-list">{group.items.map(renderItem)}</ul>
        </section>
      ))}

      <section className="admin-collection-group admin-collection-group-legacy">
        <div className="admin-collection-group-head">
          <h2 className="admin-collection-group-heading small-caps">Legacy</h2>
          <p className="admin-collection-group-note">
            Old record types and one-time migration tools.
          </p>
        </div>
        <ul className="admin-collection-list">
          <li className="admin-collection-row admin-collection-row-legacy">
            <Link to="/admin?view=legacy-blogs" className="admin-collection-link">
              <span className="admin-collection-label">Legacy blog migration</span>
              <code className="admin-collection-nsid">{STANDARD_DOC}</code>
            </Link>
            <p className="admin-collection-summary">
              The old Eleventy markdown blog posts, ready to publish to your PDS as
              standard.site documents with one click.
            </p>
          </li>
          {legacyNsids.map((nsid) => {
            const lex = LEXICONS[nsid];
            return (
              <li key={nsid} className="admin-collection-row admin-collection-row-legacy">
                <Link to={`/admin?c=${encodeURIComponent(nsid)}`} className="admin-collection-link">
                  <span className="admin-collection-label">{lex.label}</span>
                  <code className="admin-collection-nsid">{nsid}</code>
                </Link>
                {lex.summary && <p className="admin-collection-summary">{lex.summary}</p>}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="admin-collection-group">
        <div className="admin-collection-group-head">
          <h2 className="admin-collection-group-heading small-caps">Other</h2>
        </div>
        <ul className="admin-collection-list">
          <li className="admin-collection-row admin-collection-row-custom">
            <CustomCollectionInput />
          </li>
        </ul>
      </section>
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

function RecordList({
  agent,
  did,
  collection,
  title,
  intro,
  recordFilter,
  newHref,
  pageSlug: pageSlugOverride,
}) {
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Multi-select bulk editing: off by default so the list reads as plain
  // navigable rows; toggling it on turns each row into a checkbox and reveals
  // the bulk hide / unhide / delete bar.
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState(() => new Set()); // rkeys
  const [busy, setBusy] = useState(false);
  const lex = lexiconFor(collection);
  const visModel = visibilityModelFor(collection);
  const pageSlug =
    pageSlugOverride !== undefined ? pageSlugOverride : pageSlugForCollection(collection);
  const isHero = collection === COLLECTIONS.heroPhrase;
  const heading = title || lex?.label || collection;
  const newRecordHref = newHref || `/admin?c=${encodeURIComponent(collection)}&mode=new`;

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
    setSelected(new Set());
    loadPage(undefined);
  }, [loadPage]);

  useEffect(() => {
    reload();
  }, [reload]);

  const visibleRecords = recordFilter
    ? records.filter((rec) => recordFilter(rec.value))
    : records;

  const toggle = useCallback((rkey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rkey)) next.delete(rkey);
      else next.add(rkey);
      return next;
    });
  }, []);

  const visibleRkeys = visibleRecords.map((rec) => rkeyFromUri(rec.uri));
  const allSelected =
    visibleRkeys.length > 0 && visibleRkeys.every((k) => selected.has(k));

  function toggleAll() {
    setSelected((prev) => {
      if (visibleRkeys.length > 0 && visibleRkeys.every((k) => prev.has(k))) return new Set();
      return new Set(visibleRkeys);
    });
  }

  // Selected records whose hidden state would actually change — the set the
  // Hide / Unhide buttons operate on (and count).
  const selectedRecords = visibleRecords.filter((rec) => selected.has(rkeyFromUri(rec.uri)));

  async function bulkSetHidden(hidden) {
    if (!visModel) return;
    const targets = selectedRecords.filter((rec) => visModel.isHidden(rec.value) !== hidden);
    if (targets.length === 0) return;
    setBusy(true);
    setError(null);
    const updated = new Map(); // rkey -> new value
    try {
      for (const rec of targets) {
        const r = rkeyFromUri(rec.uri);
        // JSON round-trip first so any BlobRef instances (e.g. a document's
        // coverImage) collapse to their plain wire form before we re-put them.
        const plain = JSON.parse(JSON.stringify(rec.value ?? {}));
        const next = stampAutoTimestamps(lex, visModel.setHidden(plain, hidden));
        // eslint-disable-next-line no-await-in-loop
        await agent.com.atproto.repo.putRecord({ repo: did, collection, rkey: r, record: next });
        updated.set(r, next);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      if (updated.size) {
        setRecords((prev) =>
          prev.map((rec) => {
            const r = rkeyFromUri(rec.uri);
            return updated.has(r) ? { ...rec, value: updated.get(r) } : rec;
          }),
        );
      }
      setBusy(false);
    }
  }

  async function bulkDelete() {
    const rkeys = selectedRecords.map((rec) => rkeyFromUri(rec.uri));
    if (rkeys.length === 0) return;
    const noun = rkeys.length === 1 ? 'record' : 'records';
    if (!window.confirm(`Delete ${rkeys.length} ${noun}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    const deleted = new Set();
    try {
      for (const rkey of rkeys) {
        // eslint-disable-next-line no-await-in-loop
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
        deleted.add(rkey);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setRecords((prev) => prev.filter((rec) => !deleted.has(rkeyFromUri(rec.uri))));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of deleted) next.delete(k);
        return next;
      });
      setBusy(false);
    }
  }

  return (
    <PageShell
      title={heading}
      intro={intro}
      headTitle={`${heading} — Admin — dame.is`}
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{collection}</code>
        <Link
          to={newRecordHref}
          className="admin-gate-button admin-gate-button-tight"
        >
          New record
        </Link>
        {isHero && (
          <HeroSeedButton agent={agent} did={did} existingCount={records.length} onSeeded={reload} />
        )}
        {visibleRecords.length > 0 && (
          <button
            type="button"
            className="admin-link-subtle admin-select-toggle"
            onClick={() =>
              setSelectMode((on) => {
                if (on) setSelected(new Set());
                return !on;
              })
            }
          >
            {selectMode ? 'Done' : 'Select'}
          </button>
        )}
      </div>

      {pageSlug && <PageContentPanel agent={agent} did={did} slug={pageSlug} />}

      {collection === COLLECTIONS.resume && records.length > 0 && (
        <ResumeActiveSelector agent={agent} did={did} records={records} onChanged={reload} />
      )}

      {error && <p className="admin-error">{error}</p>}

      {selectMode && (
        <div className="admin-multiselect-toolbar">
          <label className="admin-checkbox">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={visibleRecords.length === 0}
            />
            <span>{allSelected ? 'Deselect all' : 'Select all loaded'}</span>
          </label>
          <span className="admin-multiselect-count">
            {selected.size > 0 ? `${selected.size} selected` : `${visibleRecords.length} loaded`}
          </span>
          <div className="admin-multiselect-actions">
            {visModel && (
              <>
                <button
                  type="button"
                  className="admin-gate-button admin-gate-button-tight"
                  onClick={() => bulkSetHidden(true)}
                  disabled={busy || selected.size === 0}
                >
                  Hide
                </button>
                <button
                  type="button"
                  className="admin-gate-button admin-gate-button-tight"
                  onClick={() => bulkSetHidden(false)}
                  disabled={busy || selected.size === 0}
                >
                  Unhide
                </button>
              </>
            )}
            <button
              type="button"
              className="admin-gate-button admin-gate-button-tight admin-danger"
              onClick={bulkDelete}
              disabled={busy || selected.size === 0}
            >
              {busy ? 'Working…' : `Delete${selected.size ? ` (${selected.size})` : ''}`}
            </button>
          </div>
        </div>
      )}

      {loading && records.length === 0 ? (
        <AdminRecordListSkeleton rows={8} />
      ) : visibleRecords.length === 0 && !error ? (
        <p className="placeholder-card">No records yet in this collection.</p>
      ) : (
        <ul className="admin-record-list reveal-stagger">
          {visibleRecords.map((rec) => {
            const r = rkeyFromUri(rec.uri);
            const hidden = visModel ? visModel.isHidden(rec.value) : false;
            const chip = hidden ? visModel.chipLabel(rec.value) || 'hidden' : null;
            const instant = recordInstant(rec.value);
            if (selectMode) {
              const checked = selected.has(r);
              return (
                <li
                  key={rec.uri}
                  className={`admin-record-row admin-multiselect-row${checked ? ' is-selected' : ''}`}
                >
                  <label className="admin-checkbox admin-multiselect-check">
                    <input type="checkbox" checked={checked} onChange={() => toggle(r)} />
                    <RecordRowBody rkey={r} preview={previewFor(rec.value, lex)} chip={chip} instant={instant} />
                  </label>
                </li>
              );
            }
            return (
              <li key={rec.uri} className="admin-record-row">
                <Link
                  to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(r)}`}
                  className="admin-record-link"
                >
                  <RecordRowBody rkey={r} preview={previewFor(rec.value, lex)} chip={chip} instant={instant} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

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
    </PageShell>
  );
}

/**
 * Shared record-row content: rkey, preview text with an optional "hidden"
 * status chip, and the record's timestamp on the far right. Rendered inside a
 * link (browse mode) or a checkbox label (select mode).
 */
function RecordRowBody({ rkey, preview, chip, instant }) {
  return (
    <>
      <code className="admin-record-rkey">{rkey}</code>
      <span className="admin-record-main">
        <span className="admin-record-preview">{preview}</span>
        {chip && <span className="admin-record-chip small-caps">{chip}</span>}
      </span>
      {instant && (
        <time className="admin-record-time small-caps" dateTime={instant} title={instant}>
          {formatDateLong(instant)}
        </time>
      )}
    </>
  );
}

/**
 * The record's own timestamp for display. Different lexicons name their primary
 * instant differently — standard docs use `publishedAt`, is.dame.* records use
 * `createdAt`, teal.fm plays use `playedTime` — so prefer a "published" instant,
 * then creation, then last-update.
 */
function recordInstant(value) {
  if (!value || typeof value !== 'object') return null;
  return (
    value.publishedAt || value.createdAt || value.playedTime || value.updatedAt || null
  );
}

/**
 * Stamp any `autoOnEdit` datetime fields (e.g. `updatedAt`) to now, mirroring
 * what the full record editor does on save so a bulk visibility flip records
 * the same freshness bump.
 */
function stampAutoTimestamps(lex, value) {
  if (!lex?.fields) return value;
  const next = { ...value };
  const nowIso = new Date().toISOString();
  for (const f of lex.fields) {
    if (f.autoOnEdit && f.type === 'datetime') next[f.key] = nowIso;
  }
  return next;
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
/* Active resume selector                                               */
/* ------------------------------------------------------------------ */

/**
 * Picks which resume version is "active" — the single one shown at /for-hire.
 * Active-ness is stored as the `featured` flag on the resume record; choosing
 * one here sets `featured: true` on it and clears it on every other version,
 * so at most one is ever active.
 */
function ResumeActiveSelector({ agent, did, records, onChanged }) {
  const [busy, setBusy] = useState(null); // rkey currently being set
  const [error, setError] = useState(null);

  const activeRkey = useMemo(() => {
    const found = records.find((rec) => rec.value?.featured);
    return found ? rkeyFromUri(found.uri) : null;
  }, [records]);

  async function setActive(rkey) {
    if (busy) return;
    setBusy(rkey);
    setError(null);
    try {
      // Flip only the records whose featured flag needs to change.
      for (const rec of records) {
        const r = rkeyFromUri(rec.uri);
        const shouldBeActive = r === rkey;
        const isActive = !!rec.value?.featured;
        if (shouldBeActive === isActive) continue;
        await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: COLLECTIONS.resume,
          rkey: r,
          record: {
            ...rec.value,
            featured: shouldBeActive,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      onChanged?.();
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="admin-active-resume">
      <p className="admin-active-resume-label small-caps">Active version</p>
      <p className="admin-active-resume-note">
        The one version shown on <code>/for-hire</code>.
      </p>
      <ul className="admin-active-resume-list">
        {records.map((rec) => {
          const r = rkeyFromUri(rec.uri);
          const isActive = r === activeRkey;
          const label = rec.value?.title || rec.value?.slug || r;
          const vis = rec.value?.visibility || 'private';
          return (
            <li key={rec.uri} className="admin-active-resume-item">
              <button
                type="button"
                className={`admin-active-resume-btn ${isActive ? 'is-active' : ''}`}
                onClick={() => !isActive && setActive(r)}
                disabled={!!busy || isActive}
                aria-pressed={isActive}
              >
                <span className="admin-active-resume-radio" aria-hidden="true" />
                <span className="admin-active-resume-name">{label}</span>
                {vis !== 'public' && (
                  <span className="admin-active-resume-vis">{vis}</span>
                )}
                {busy === r && <span className="admin-active-resume-vis">saving…</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {error && <p className="admin-error">{error}</p>}
    </div>
  );
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
    <PageShell
      title="Site pages"
      intro="Each page's title and intro can live in the site (Local) or as an is.dame.page record on your PDS. Manage that split here, then edit the raw records below."
      headTitle="Site pages — Admin — dame.is"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{COLLECTIONS.page}</code>
        <Link
          to={`/admin?c=${encodeURIComponent(COLLECTIONS.page)}&mode=new`}
          className="admin-gate-button admin-gate-button-tight"
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
                  <Link
                    to={`/admin?c=${encodeURIComponent(COLLECTIONS.page)}&r=${encodeURIComponent(r)}`}
                    className="admin-record-link"
                  >
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
      headTitle="Legacy blog migration — Admin — dame.is"
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
/* Listening manager (multi-select bulk edit / delete)                  */
/* ------------------------------------------------------------------ */

/** Short human label for a play record value: "Track · Artist". */
function playLabel(value) {
  if (!value || typeof value !== 'object') return '';
  const track = value.trackName || value.track || '';
  const artist = Array.isArray(value.artists)
    ? value.artists.map((a) => a?.artistName).filter(Boolean).join(', ')
    : value.artist || '';
  return [track, artist].filter(Boolean).join(' · ') || '(untitled play)';
}

function ListeningManager({ agent, did }) {
  const collection = COLLECTIONS.listen;
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // Set of selected rkeys.
  const [selected, setSelected] = useState(() => new Set());
  const [deleting, setDeleting] = useState(false);

  const loadPage = useCallback(
    async (after) => {
      setLoading(true);
      setError(null);
      try {
        const res = await agent.com.atproto.repo.listRecords({
          repo: did,
          collection,
          limit: 100,
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

  useEffect(() => {
    setRecords([]);
    setCursor(undefined);
    setDone(false);
    setSelected(new Set());
    loadPage(undefined);
  }, [loadPage]);

  const toggle = useCallback((rkey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rkey)) next.delete(rkey);
      else next.add(rkey);
      return next;
    });
  }, []);

  const allRkeys = useMemo(() => records.map((r) => rkeyFromUri(r.uri)), [records]);
  const allSelected = allRkeys.length > 0 && allRkeys.every((k) => selected.has(k));

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allRkeys.length > 0 && allRkeys.every((k) => prev.has(k))) return new Set();
      return new Set(allRkeys);
    });
  }, [allRkeys]);

  async function bulkDelete() {
    const rkeys = Array.from(selected);
    if (rkeys.length === 0) return;
    const noun = rkeys.length === 1 ? 'play' : 'plays';
    if (!window.confirm(`Delete ${rkeys.length} ${noun}? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    const deleted = new Set();
    try {
      for (const rkey of rkeys) {
        // eslint-disable-next-line no-await-in-loop
        await agent.com.atproto.repo.deleteRecord({ repo: did, collection, rkey });
        deleted.add(rkey);
      }
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setRecords((prev) => prev.filter((r) => !deleted.has(rkeyFromUri(r.uri))));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const k of deleted) next.delete(k);
        return next;
      });
      setDeleting(false);
    }
  }

  return (
    <PageShell
      title="Listening"
      intro="Every play on your PDS. Select rows to bulk-delete, or open one in the record editor."
      headTitle="Listening — Admin — dame.is"
    >
      <div className="admin-toolbar">
        <Link to="/admin" className="admin-link-subtle">← All collections</Link>
        <code className="admin-collection-nsid">{collection}</code>
      </div>

      {error && <p className="admin-error">{error}</p>}

      <div className="admin-multiselect-toolbar">
        <label className="admin-checkbox">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleAll}
            disabled={records.length === 0}
          />
          <span>{allSelected ? 'Deselect all' : 'Select all loaded'}</span>
        </label>
        <span className="admin-multiselect-count">
          {selected.size > 0 ? `${selected.size} selected` : `${records.length} loaded`}
        </span>
        <button
          type="button"
          className="admin-gate-button admin-gate-button-tight admin-danger"
          onClick={bulkDelete}
          disabled={deleting || selected.size === 0}
        >
          {deleting ? 'Deleting…' : `Delete${selected.size ? ` (${selected.size})` : ''}`}
        </button>
      </div>

      {loading && records.length === 0 ? (
        <AdminRecordListSkeleton rows={8} label="Loading plays" />
      ) : records.length === 0 && !error ? (
        <p className="placeholder-card">No plays yet.</p>
      ) : (
        <ul className="admin-record-list reveal-stagger">
          {records.map((rec) => {
            const rkey = rkeyFromUri(rec.uri);
            const checked = selected.has(rkey);
            return (
              <li
                key={rec.uri}
                className={`admin-record-row admin-multiselect-row${checked ? ' is-selected' : ''}`}
              >
                <label className="admin-checkbox admin-multiselect-check">
                  <input type="checkbox" checked={checked} onChange={() => toggle(rkey)} />
                  <span className="admin-record-preview">{playLabel(rec.value)}</span>
                </label>
                <Link
                  to={`/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(rkey)}`}
                  className="admin-link-subtle admin-multiselect-edit"
                >
                  Edit →
                </Link>
              </li>
            );
          })}
        </ul>
      )}

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
  const headTitle = `${title} — Admin — dame.is`;
  const listHref = `/admin?c=${encodeURIComponent(collection)}`;
  const navigate = useNavigate();

  // The editor's Save / Delete / Close ride in the bottom-chrome edit action
  // bar (EditModeBar) rather than at the foot of the page — mirroring the
  // quick-edit sheet. Drive the editor imperatively via a ref and publish its
  // live status so the bar can label + disable its controls.
  const editorRef = useRef(null);
  const { setPageEditor } = useEditMode();
  const [status, setStatus] = useState({
    saving: false,
    deleting: false,
    loading: !isNew,
    isNew,
  });
  const handleStatus = useCallback((s) => setStatus(s), []);

  useEffect(() => {
    setPageEditor({
      save: () => editorRef.current?.save(),
      remove: () => editorRef.current?.remove(),
      close: () => navigate(listHref),
      saving: status.saving,
      deleting: status.deleting,
      loading: status.loading,
      canDelete: !status.isNew,
      isNew: status.isNew,
    });
    return () => setPageEditor(null);
  }, [setPageEditor, status, listHref, navigate]);

  return (
    <PageShell title={title} headTitle={headTitle}>
      <div className="admin-toolbar">
        <Link to={listHref} className="admin-link-subtle">
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
        ref={editorRef}
        agent={agent}
        did={did}
        collection={collection}
        rkey={rkey}
        initialValue={initialValue}
        hideActions
        onStatus={handleStatus}
        onCreated={({ rkey: newRkey }) => {
          window.location.assign(
            `/admin?c=${encodeURIComponent(collection)}&r=${encodeURIComponent(newRkey)}`,
          );
        }}
        onDeleted={() => {
          window.location.assign(listHref);
        }}
      />
    </PageShell>
  );
}

