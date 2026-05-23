import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import RecordEditor, { rkeyFromUri } from '../components/RecordEditor.jsx';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { ME_HANDLE } from '../config.js';
import {
  describeRepo,
  getPlcAuditLog,
  getPlcDocument,
  getRecord,
  listRecordsPage,
  resolveIdentifier,
} from '../lib/atproto.js';
import {
  flattenSources,
  getBacklinkSources,
} from '../lib/constellation.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import './Exploring.css';

/**
 * Atmosphere PDS explorer.
 *
 * Routes (registered in App.jsx) all resolve here; we branch on params:
 *   /exploring                             → defaults to ME_HANDLE
 *   /exploring/:repo                       → repo overview (tabs)
 *   /exploring/:repo/:collection           → record list
 *   /exploring/:repo/:collection/:rkey     → record detail
 */
export default function Exploring() {
  const params = useParams();
  const repoInput = params.repo || ME_HANDLE;
  const { collection, rkey } = params;

  const [identity, setIdentity] = useState(null); // { did, handle, pds }
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    setError(null);
    resolveIdentifier(repoInput)
      .then((res) => {
        if (!cancelled) setIdentity(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [repoInput]);

  const title = collection
    ? rkey
      ? `${rkey} — ${collection}`
      : collection
    : identity?.handle || repoInput;

  return (
    <PageShell
      title="Exploring"
      headTitle={`${title} — Exploring — Dame is…`}
    >
      <SearchBox initial={repoInput} />

      {error && (
        <div className="exploring-error">
          <p className="admin-error">{error}</p>
          <p className="exploring-hint">
            Try a handle (<code>dame.is</code>) or a DID (<code>did:plc:…</code>).
          </p>
        </div>
      )}

      {!identity && !error && (
        <p className="placeholder-card">Resolving <code>{repoInput}</code>…</p>
      )}

      {identity && (
        <RepoBreadcrumb
          identity={identity}
          collection={collection}
          rkey={rkey}
        />
      )}

      {identity && !collection && <RepoOverview identity={identity} />}
      {identity && collection && !rkey && (
        <CollectionView identity={identity} collection={collection} />
      )}
      {identity && collection && rkey && (
        <RecordView identity={identity} collection={collection} rkey={rkey} />
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */
/* Search box + breadcrumb                                              */
/* ------------------------------------------------------------------ */

function SearchBox({ initial }) {
  const [value, setValue] = useState(initial || '');
  const navigate = useNavigate();

  useEffect(() => {
    setValue(initial || '');
  }, [initial]);

  function onSubmit(e) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    // Paste-an-at-uri shortcut: route straight to the record.
    if (v.startsWith('at://')) {
      const m = v.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/);
      if (m) {
        navigate(`/exploring/${encodeRepo(m[1])}/${m[2]}/${m[3]}`);
        return;
      }
    }
    navigate(`/exploring/${encodeRepo(v)}`);
  }

  return (
    <form className="exploring-search" onSubmit={onSubmit}>
      <label className="exploring-search-label small-caps" htmlFor="exploring-search-input">
        repo
      </label>
      <input
        id="exploring-search-input"
        className="admin-input exploring-search-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="handle, DID, or at://… URI"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="admin-gate-button admin-gate-button-tight">
        Look up
      </button>
    </form>
  );
}

function RepoBreadcrumb({ identity, collection, rkey }) {
  const { handle, did } = identity;
  return (
    <nav className="exploring-crumbs" aria-label="Breadcrumb">
      <Link to={`/exploring/${encodeRepo(handle || did)}`} className="exploring-crumb">
        <span className="exploring-crumb-handle">{handle ? `@${handle}` : did}</span>
      </Link>
      {collection && (
        <>
          <span className="exploring-crumb-sep" aria-hidden>/</span>
          <Link
            to={`/exploring/${encodeRepo(handle || did)}/${collection}`}
            className="exploring-crumb"
          >
            <code className="exploring-crumb-nsid">{collection}</code>
          </Link>
        </>
      )}
      {rkey && (
        <>
          <span className="exploring-crumb-sep" aria-hidden>/</span>
          <code className="exploring-crumb-rkey">{rkey}</code>
        </>
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Repo overview                                                        */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: 'collections', label: 'Collections' },
  { id: 'identity', label: 'Identity' },
  { id: 'audit', label: 'Audit log' },
  { id: 'backlinks', label: 'Backlinks' },
];

function RepoOverview({ identity }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') || 'collections';

  function selectTab(id) {
    const next = new URLSearchParams(searchParams);
    if (id === 'collections') next.delete('tab');
    else next.set('tab', id);
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="exploring-repo">
      <RepoIdentityRow identity={identity} />

      <div className="exploring-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`exploring-tab ${tab === t.id ? 'is-active' : ''}`}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'collections' && <CollectionsTab identity={identity} />}
      {tab === 'identity' && <IdentityTab identity={identity} />}
      {tab === 'audit' && <AuditTab identity={identity} />}
      {tab === 'backlinks' && <BacklinksTab target={identity.did} />}
    </div>
  );
}

function RepoIdentityRow({ identity }) {
  const { did, handle, pds } = identity;
  return (
    <dl className="exploring-identity-row">
      <div>
        <dt className="small-caps">handle</dt>
        <dd>{handle ? `@${handle}` : <span className="exploring-muted">unknown</span>}</dd>
      </div>
      <div>
        <dt className="small-caps">did</dt>
        <dd><code>{did}</code></dd>
      </div>
      <div>
        <dt className="small-caps">pds</dt>
        <dd><code>{pds}</code></dd>
      </div>
    </dl>
  );
}

/* ------------------------------------------------------------------ */
/* Collections tab — grouped, filterable, collapsible                  */
/* ------------------------------------------------------------------ */

function CollectionsTab({ identity }) {
  const [collections, setCollections] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState({}); // { groupKey: bool }

  useEffect(() => {
    let cancelled = false;
    setCollections(null);
    setError(null);
    describeRepo(identity.pds, identity.did)
      .then((res) => {
        if (cancelled) return;
        const list = Array.isArray(res?.collections) ? res.collections : [];
        list.sort();
        setCollections(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [identity.pds, identity.did]);

  const groups = useMemo(() => groupByNamespace(collections || [], filter), [collections, filter]);

  if (error) return <p className="admin-error">{error}</p>;
  if (!collections) return <p className="placeholder-card">Loading collections…</p>;
  if (collections.length === 0) {
    return <p className="placeholder-card">No collections on this repo.</p>;
  }

  return (
    <div className="exploring-collections">
      <input
        className="admin-input exploring-filter"
        type="text"
        placeholder="Filter collections…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {groups.length === 0 ? (
        <p className="placeholder-card">No collections match <code>{filter}</code>.</p>
      ) : (
        groups.map((g) => {
          const open = collapsed[g.key] !== true;
          return (
            <section key={g.key} className="exploring-collection-group">
              <button
                type="button"
                className="exploring-group-header"
                onClick={() =>
                  setCollapsed((prev) => ({ ...prev, [g.key]: !prev[g.key] ? true : false }))
                }
                aria-expanded={open}
              >
                <span className="exploring-group-caret" aria-hidden>{open ? '▾' : '▸'}</span>
                <code className="exploring-group-prefix">{g.key}</code>
                <span className="exploring-group-count">{g.items.length}</span>
              </button>
              {open && (
                <ul className="exploring-collection-list">
                  {g.items.map((nsid) => (
                    <li key={nsid} className="exploring-collection-row">
                      <Link
                        to={`/exploring/${encodeRepo(identity.handle || identity.did)}/${nsid}`}
                        className="exploring-collection-link"
                      >
                        <code>{nsid}</code>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}

function groupByNamespace(list, filterStr) {
  const f = filterStr.trim().toLowerCase();
  const filtered = f ? list.filter((nsid) => nsid.toLowerCase().includes(f)) : list;
  // Group by everything before the last segment (e.g. `app.bsky.feed`).
  const map = new Map();
  for (const nsid of filtered) {
    const lastDot = nsid.lastIndexOf('.');
    const key = lastDot > 0 ? nsid.slice(0, lastDot) : nsid;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(nsid);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, items: items.sort() }));
}

/* ------------------------------------------------------------------ */
/* Identity tab                                                         */
/* ------------------------------------------------------------------ */

function IdentityTab({ identity }) {
  const { did } = identity;
  const isPlc = did.startsWith('did:plc:');
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isPlc) return undefined;
    let cancelled = false;
    setDoc(null);
    setError(null);
    getPlcDocument(did)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [did, isPlc]);

  if (!isPlc) {
    return (
      <p className="placeholder-card">
        <code>{did}</code> isn&rsquo;t a <code>did:plc:</code> — PLC directory data
        isn&rsquo;t available for this method.
      </p>
    );
  }
  if (error) return <p className="admin-error">{error}</p>;
  if (!doc) return <p className="placeholder-card">Loading identity…</p>;

  const akas = doc.alsoKnownAs || [];
  const services = doc.service || [];
  const verifications = doc.verificationMethod || [];

  return (
    <div className="exploring-identity">
      <section className="exploring-identity-section">
        <h3 className="small-caps">Also known as</h3>
        <ul className="exploring-identity-list">
          {akas.length === 0 && <li className="exploring-muted">—</li>}
          {akas.map((a) => (
            <li key={a}><code>{a}</code></li>
          ))}
        </ul>
      </section>

      <section className="exploring-identity-section">
        <h3 className="small-caps">Services</h3>
        <ul className="exploring-identity-list">
          {services.length === 0 && <li className="exploring-muted">—</li>}
          {services.map((s) => (
            <li key={s.id || s.type}>
              <div className="exploring-id-label"><code>{s.id}</code></div>
              <div className="exploring-id-value">
                <span className="small-caps">type</span> <code>{s.type}</code>
              </div>
              <div className="exploring-id-value">
                <span className="small-caps">endpoint</span> <code>{s.serviceEndpoint}</code>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="exploring-identity-section">
        <h3 className="small-caps">Verification methods</h3>
        <ul className="exploring-identity-list">
          {verifications.length === 0 && <li className="exploring-muted">—</li>}
          {verifications.map((v) => (
            <li key={v.id || v.publicKeyMultibase}>
              <div className="exploring-id-label"><code>{v.id}</code></div>
              <div className="exploring-id-value">
                <span className="small-caps">type</span> <code>{v.type}</code>
              </div>
              {v.publicKeyMultibase && (
                <div className="exploring-id-value">
                  <span className="small-caps">key</span>{' '}
                  <code className="exploring-id-key">{v.publicKeyMultibase}</code>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <details className="exploring-raw-details">
        <summary>Raw DID document</summary>
        <pre className="exploring-json">{JSON.stringify(doc, null, 2)}</pre>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audit log tab                                                        */
/* ------------------------------------------------------------------ */

function AuditTab({ identity }) {
  const { did } = identity;
  const isPlc = did.startsWith('did:plc:');
  const [log, setLog] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isPlc) return undefined;
    let cancelled = false;
    setLog(null);
    setError(null);
    getPlcAuditLog(did)
      .then((l) => {
        if (!cancelled) setLog(Array.isArray(l) ? l : []);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [did, isPlc]);

  if (!isPlc) {
    return (
      <p className="placeholder-card">
        Audit log only available for <code>did:plc:</code> DIDs.
      </p>
    );
  }
  if (error) return <p className="admin-error">{error}</p>;
  if (!log) return <p className="placeholder-card">Loading audit log…</p>;
  if (log.length === 0) return <p className="placeholder-card">No PLC operations recorded.</p>;

  // Newest first.
  const ordered = [...log].reverse();

  return (
    <ol className="exploring-audit">
      {ordered.map((entry, i) => (
        <AuditEntry key={entry.cid || i} entry={entry} prev={log[log.length - i - 2]} />
      ))}
    </ol>
  );
}

function AuditEntry({ entry, prev }) {
  const op = entry.operation || {};
  const created = entry.createdAt;
  const type = op.type || (op.prev === null ? 'create' : 'update');
  const changes = diffOps(prev?.operation, op);

  return (
    <li className="exploring-audit-entry">
      <div className="exploring-audit-head">
        <span className="exploring-audit-type small-caps">{type}</span>
        <time className="exploring-audit-time">{formatPlcTime(created)}</time>
      </div>
      {changes.length > 0 && (
        <ul className="exploring-audit-changes">
          {changes.map((c, idx) => (
            <li key={idx}>{c}</li>
          ))}
        </ul>
      )}
      <details className="exploring-raw-details">
        <summary>Raw operation</summary>
        <pre className="exploring-json">{JSON.stringify(entry, null, 2)}</pre>
      </details>
    </li>
  );
}

function diffOps(prev, next) {
  if (!next) return [];
  const changes = [];
  const prevAka = prev?.alsoKnownAs || [];
  const nextAka = next.alsoKnownAs || [];
  const addedAka = nextAka.filter((h) => !prevAka.includes(h));
  const removedAka = prevAka.filter((h) => !nextAka.includes(h));
  for (const h of addedAka) changes.push(`+ handle ${h}`);
  for (const h of removedAka) changes.push(`− handle ${h}`);

  const prevSvc = JSON.stringify(prev?.services || {});
  const nextSvc = JSON.stringify(next?.services || {});
  if (prevSvc !== nextSvc) changes.push('services updated');

  const prevKeys = JSON.stringify(prev?.rotationKeys || prev?.verificationMethods || {});
  const nextKeys = JSON.stringify(next?.rotationKeys || next?.verificationMethods || {});
  if (prevKeys !== nextKeys) changes.push('keys rotated');

  return changes;
}

function formatPlcTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/* ------------------------------------------------------------------ */
/* Backlinks panel (shared between repo tab and per-record view)        */
/* ------------------------------------------------------------------ */

function BacklinksTab({ target }) {
  return <BacklinksPanel target={target} />;
}

function BacklinksPanel({ target }) {
  const [sources, setSources] = useState(undefined); // undefined=loading, null=unavailable, []=empty
  useEffect(() => {
    let cancelled = false;
    setSources(undefined);
    getBacklinkSources(target).then((raw) => {
      if (cancelled) return;
      if (raw === null) {
        setSources(null);
        return;
      }
      setSources(flattenSources(raw) || []);
    });
    return () => {
      cancelled = true;
    };
  }, [target]);

  if (sources === undefined) return <p className="placeholder-card">Loading backlinks…</p>;
  if (sources === null) {
    return (
      <p className="exploring-muted">
        Backlinks unavailable (
        <a href="https://constellation.microcosm.blue" target="_blank" rel="noreferrer noopener">
          constellation
        </a>
        ).
      </p>
    );
  }
  if (sources.length === 0) {
    return <p className="placeholder-card">No inbound links found.</p>;
  }

  return (
    <ul className="exploring-backlinks">
      {sources.map((s) => (
        <li key={s.source} className="exploring-backlink-row">
          <code className="exploring-backlink-collection">{s.collection}</code>
          <code className="exploring-backlink-path">{s.path}</code>
          <span className="exploring-backlink-count">{s.count.toLocaleString()}</span>
          {s.distinctDids != null && (
            <span className="exploring-backlink-distinct">
              {s.distinctDids.toLocaleString()} accounts
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Collection view                                                      */
/* ------------------------------------------------------------------ */

function CollectionView({ identity, collection }) {
  const [records, setRecords] = useState([]);
  const [cursor, setCursor] = useState(undefined);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadPage = useCallback(
    async (after) => {
      setLoading(true);
      setError(null);
      try {
        const res = await listRecordsPage(identity.pds, {
          repo: identity.did,
          collection,
          limit: 50,
          cursor: after || undefined,
        });
        const batch = res?.records || [];
        setRecords((prev) => (after ? [...prev, ...batch] : batch));
        setCursor(res?.cursor);
        if (!res?.cursor || batch.length === 0) setDone(true);
      } catch (err) {
        setError(err?.message || String(err));
      } finally {
        setLoading(false);
      }
    },
    [identity.pds, identity.did, collection],
  );

  useEffect(() => {
    setRecords([]);
    setCursor(undefined);
    setDone(false);
    loadPage(undefined);
  }, [loadPage]);

  return (
    <div className="exploring-collection">
      {error && <p className="admin-error">{error}</p>}
      {records.length === 0 && !loading && !error && (
        <p className="placeholder-card">No records in this collection.</p>
      )}
      {loading && records.length === 0 && (
        <p className="placeholder-card">Loading records…</p>
      )}

      <ul className="exploring-record-list">
        {records.map((rec) => {
          const r = rkeyFromUri(rec.uri);
          return (
            <li key={rec.uri} className="exploring-record-row">
              <Link
                to={`/exploring/${encodeRepo(identity.handle || identity.did)}/${collection}/${encodeURIComponent(r)}`}
                className="exploring-record-link"
              >
                <code className="exploring-record-rkey">{r}</code>
                <span className="exploring-record-preview">{previewFor(rec.value)}</span>
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
    </div>
  );
}

function previewFor(value) {
  if (!value || typeof value !== 'object') return '';
  for (const k of ['title', 'status', 'text', 'name', 'displayName', 'subject']) {
    const v = value[k];
    if (typeof v === 'string' && v.trim()) return truncate(v, 140);
    if (k === 'subject' && v && typeof v === 'object' && typeof v.uri === 'string') {
      return truncate(v.uri, 140);
    }
  }
  if (typeof value.createdAt === 'string') return value.createdAt;
  return '';
}

function truncate(s, n) {
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

/* ------------------------------------------------------------------ */
/* Record view                                                          */
/* ------------------------------------------------------------------ */

function RecordView({ identity, collection, rkey }) {
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const { agent, did: signedInDid, session, signIn } = useAtprotoSession();

  const atUri = `at://${identity.did}/${collection}/${rkey}`;
  const decodedRkey = useMemo(() => {
    try { return decodeURIComponent(rkey); } catch { return rkey; }
  }, [rkey]);

  useEffect(() => {
    let cancelled = false;
    setRecord(null);
    setError(null);
    getRecord(identity.pds, { repo: identity.did, collection, rkey: decodedRkey })
      .then((r) => {
        if (!cancelled) setRecord(r);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [identity.pds, identity.did, collection, decodedRkey]);

  const canEdit = Boolean(agent && signedInDid && signedInDid === identity.did);
  const ownerLabel = identity.handle || identity.did;
  const sitePath = recordPathFromAtUri(atUri);

  return (
    <div className="exploring-record">
      <RecordMetaRow atUri={atUri} cid={record?.cid} />

      {error && <p className="admin-error">{error}</p>}
      {!record && !error && <p className="placeholder-card">Loading record…</p>}

      <div className="exploring-record-actions">
        <a
          href={`https://atproto-browser.vercel.app/at?u=${encodeURIComponent(atUri)}`}
          target="_blank"
          rel="noreferrer noopener"
        >
          Open in atproto browser
        </a>
        {sitePath && (
          <Link to={sitePath} className="exploring-record-site-link">
            View on dame.is
          </Link>
        )}
        {canEdit && !editing && (
          <button
            type="button"
            className="admin-link-subtle"
            onClick={() => setEditing(true)}
          >
            Edit record
          </button>
        )}
        {canEdit && editing && (
          <button
            type="button"
            className="admin-link-subtle"
            onClick={() => setEditing(false)}
          >
            Close editor
          </button>
        )}
        {!session && (
          <SignInToEditButton
            signIn={signIn}
            target={identity.handle || identity.did}
          />
        )}
      </div>

      {editing && canEdit && (
        <div className="exploring-editor">
          <RecordEditor
            agent={agent}
            did={identity.did}
            collection={collection}
            rkey={decodedRkey}
            onDeleted={() => {
              setEditing(false);
              window.location.assign(
                `/exploring/${encodeRepo(ownerLabel)}/${collection}`,
              );
            }}
            onSaved={(next) => {
              setRecord((prev) => ({ ...(prev || {}), value: next }));
            }}
          />
        </div>
      )}

      {record && !editing && (
        <pre className="exploring-json">{JSON.stringify(record, null, 2)}</pre>
      )}

      <details className="exploring-section">
        <summary>Backlinks</summary>
        <BacklinksPanel target={atUri} />
      </details>
    </div>
  );
}

function RecordMetaRow({ atUri, cid }) {
  return (
    <dl className="exploring-record-meta">
      <div>
        <dt className="small-caps">at uri</dt>
        <dd><code>{atUri}</code></dd>
      </div>
      {cid && (
        <div>
          <dt className="small-caps">cid</dt>
          <dd><code>{cid}</code></dd>
        </div>
      )}
    </dl>
  );
}

function SignInToEditButton({ signIn, target }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="admin-link-subtle"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await signIn(target);
        } catch {
          setBusy(false);
        }
      }}
    >
      {busy ? 'Redirecting…' : 'Sign in to edit'}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

// Repo path-segments contain colons (DIDs) and dots (handles). Both are
// URL-safe in path segments without encoding, and encoding `:` breaks the
// readability of DID URLs. We leave them raw and only encode the truly
// reserved characters.
function encodeRepo(input) {
  return String(input || '').replace(/[?#]/g, encodeURIComponent);
}
