import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy } from 'lucide-react';
import { ME_HANDLE } from '../config.js';
import {
  describeRepo,
  getLatestCommit,
  getPlcAuditLog,
  tidToTimestamp,
} from '../lib/atproto.js';
import { flattenSources, getBacklinkSources } from '../lib/constellation.js';
import { formatDateFull, relativeTime } from '../lib/time.js';
import './ExploringHome.css';

/**
 * The personal landing for dame's repository, rendered at the bare
 * `/exploring` route (see Exploring.jsx). The generic explorer treats every
 * repo the same; this one is dame's: a plain-language tour of what a
 * repository is, the stats, the custom `is.dame.*` record types, and every
 * collection. Each row links into the generic browser at
 * `/exploring/dame.is/...` for the record-level view.
 *
 * `identity` ({ did, handle, pds }) is already resolved by the parent.
 */

// Hand-written descriptions of the record types I designed. I write them here
// rather than pull from the bundled lexicon schemas, whose `description` fields
// are terse. `route` is the site page a type feeds, when it has one.
const CUSTOM_LEXICONS = [
  { nsid: 'is.dame.now', title: 'now', blurb: 'A one-line status. The latest one reads something like “dame is hiking.”', route: '/logging' },
  { nsid: 'is.dame.hero.phrase', title: 'hero phrase', blurb: 'The “dame is…” lines on the home page come from these records.', route: '/' },
  { nsid: 'is.dame.profile', title: 'profile', blurb: 'My long-form bio. My Bluesky description holds the short version; this record holds the rest.', route: '/themself' },
  { nsid: 'is.dame.page', title: 'page', blurb: 'The title and intro text for each page of this site. I edit the record to change the page.' },
  { nsid: 'is.dame.creating.work', title: 'creating', blurb: 'Things I’ve made: art, software, writing. Each record gets its own page.', route: '/creating' },
  { nsid: 'is.dame.resume', title: 'resume', blurb: 'My work history and education, as records instead of a PDF.', route: '/available' },
  { nsid: 'is.dame.mothing', title: 'mothing', blurb: 'Moths I’ve logged on iNaturalist, mirrored here. No location is stored.', route: '/mothing' },
  { nsid: 'is.dame.observing', title: 'observing', blurb: 'Everything I’ve logged on iNaturalist that isn’t a moth: birds, plants, fungi.' },
  { nsid: 'is.dame.guestbook', title: 'guestbook', blurb: 'A guestbook you sign from your own repository. Your entry stays in your repo and links back to mine.', route: '/welcoming' },
  { nsid: 'is.dame.arena.channel', title: 'arena channel', blurb: 'The are.na channels I curate, mirrored from are.na into my repo.', route: '/curating' },
  { nsid: 'is.dame.annotating', title: 'annotating', blurb: 'Margin notes attached to another record by its AT URI.' },
];

const OWNER = ME_HANDLE;

/**
 * Best collection to link into for a lexicon "family". Prefers the exact NSID;
 * falls back to the shortest sub-collection that exists (e.g. `is.dame.resume`
 * → `is.dame.resume.job`). Returns the base NSID as a best-effort guess when
 * the collection list failed to load, or `null` when the family is genuinely
 * absent from the repo.
 */
function browsableCollection(baseNsid, collections) {
  if (!collections) return baseNsid; // describeRepo failed; best-effort link
  if (collections.includes(baseNsid)) return baseNsid;
  const sub = collections
    .filter((c) => c.startsWith(`${baseNsid}.`))
    .sort((a, b) => a.length - b.length);
  return sub[0] || null;
}

export default function ExploringHome({ identity }) {
  const { did, handle, pds } = identity;
  const isPlc = did.startsWith('did:plc:');

  // Core facts (collections, account age and operation count, last-active) all
  // come from fast, cached endpoints and load together. Constellation backlinks
  // load separately (below) so a slow or offline index never holds up the rest
  // of the page.
  const [core, setCore] = useState({ loading: true });
  const [inbound, setInbound] = useState(undefined); // undefined=loading · null=unavailable · number

  useEffect(() => {
    let cancelled = false;
    setCore({ loading: true });
    Promise.allSettled([
      describeRepo(pds, did),
      isPlc ? getPlcAuditLog(did) : Promise.resolve(null),
      getLatestCommit(pds, did),
    ]).then(([descR, auditR, commitR]) => {
      if (cancelled) return;
      const collections =
        descR.status === 'fulfilled' && Array.isArray(descR.value?.collections)
          ? [...descR.value.collections].sort()
          : null;
      const audit =
        auditR.status === 'fulfilled' && Array.isArray(auditR.value) ? auditR.value : null;
      const created = audit?.[0]?.createdAt || null; // audit log is oldest → newest
      const ops = audit ? audit.length : null;
      const rev = commitR.status === 'fulfilled' ? commitR.value?.rev : null;
      const lastActive = rev ? tidToTimestamp(rev) : null;
      setCore({ loading: false, collections, created, ops, lastActive });
    });
    return () => {
      cancelled = true;
    };
  }, [pds, did, isPlc]);

  useEffect(() => {
    let cancelled = false;
    setInbound(undefined);
    getBacklinkSources(did).then((raw) => {
      if (cancelled) return;
      const flat = flattenSources(raw);
      if (!flat) {
        setInbound(null);
        return;
      }
      setInbound(flat.reduce((sum, s) => sum + (s.count || 0), 0));
    });
    return () => {
      cancelled = true;
    };
  }, [did]);

  const { loading, collections, created, ops, lastActive } = core;

  const lexicons = useMemo(
    () =>
      CUSTOM_LEXICONS.map((lex) => ({
        ...lex,
        browse: browsableCollection(lex.nsid, collections),
      })).filter((lex) => (collections ? lex.browse : true)),
    [collections],
  );

  const mine = useMemo(
    () => (collections || []).filter((c) => c.startsWith('is.dame.')),
    [collections],
  );
  const external = useMemo(
    () => (collections || []).filter((c) => !c.startsWith('is.dame.')),
    [collections],
  );

  const dash = loading ? '…' : '—';

  return (
    <div className="exploring-home">
      <p className="exploring-home-lead dropcap">
        A repository is a collection of records stored on a personal data server, or PDS,
        and signed by my account’s key. This site reads from mine and renders it as pages.
        Below are its stats, the record types I wrote, and every collection, each one
        linking into a browser you can open yourself.
      </p>

      {/* Identity -------------------------------------------------------- */}
      <section className="exploring-home-section">
        <h2 className="exploring-home-section-title small-caps">Identity</h2>
        <dl className="exploring-home-identity">
          <IdentityRow label="handle" value={handle ? `@${handle}` : '—'} copy={handle ? `@${handle}` : null} />
          <IdentityRow label="did" value={did} copy={did} mono />
          <IdentityRow label="pds" value={pds} copy={pds} mono />
        </dl>
        {isPlc && (
          <div className="exploring-home-identity-links">
            <Link to={`/exploring/${OWNER}?tab=identity`} className="exploring-home-textlink">
              identity document →
            </Link>
            <Link to={`/exploring/${OWNER}?tab=audit`} className="exploring-home-textlink">
              audit log →
            </Link>
          </div>
        )}
      </section>

      {/* Stats ----------------------------------------------------------- */}
      <section className="exploring-home-section">
        <h2 className="exploring-home-section-title small-caps">Stats</h2>
        <dl className="exploring-home-stats">
          <Stat label="Collections" value={collections ? collections.length : dash} />
          <Stat
            label="Created"
            value={created ? formatDateFull(created) : dash}
            sub={created ? relativeTime(created) : null}
          />
          <Stat label="Identity ops" value={ops != null ? ops : dash} />
          <Stat
            label="Last active"
            value={lastActive ? relativeTime(lastActive) : dash}
            sub={lastActive ? formatDateFull(lastActive) : null}
          />
          <Stat
            label="Inbound links"
            value={
              inbound === undefined
                ? '…'
                : inbound === null
                  ? 'unavailable'
                  : inbound.toLocaleString()
            }
            to={inbound ? `/exploring/${OWNER}?tab=backlinks` : null}
          />
        </dl>
      </section>

      {/* Custom lexicons ------------------------------------------------- */}
      <section className="exploring-home-section">
        <h2 className="exploring-home-section-title small-caps">Record types I made</h2>
        <p className="exploring-home-section-note">
          Most of these use custom <code>is.dame.*</code> lexicons, schemas I wrote for
          records the standard lexicons don’t define.
        </p>
        <ul className="exploring-home-lexicons">
          {lexicons.map((lex) => (
            <li key={lex.nsid} className="exploring-home-lexicon">
              <div className="exploring-home-lexicon-head">
                <h3 className="exploring-home-lexicon-title">{lex.title}</h3>
                <code className="exploring-home-lexicon-nsid gutter">{lex.nsid}</code>
              </div>
              <p className="exploring-home-lexicon-blurb">{lex.blurb}</p>
              <div className="exploring-home-lexicon-links">
                {lex.browse && (
                  <Link to={`/exploring/${OWNER}/${lex.browse}`} className="exploring-home-textlink">
                    browse records →
                  </Link>
                )}
                {lex.route && (
                  <Link to={lex.route} className="exploring-home-textlink exploring-home-textlink-muted">
                    on the site: {lex.route}
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Collections directory ------------------------------------------ */}
      <section className="exploring-home-section">
        <div className="exploring-home-collections-head">
          <h2 className="exploring-home-section-title small-caps">Collections</h2>
          <Link to={`/exploring/${OWNER}`} className="exploring-home-textlink">
            browse the whole repo →
          </Link>
        </div>
        {collections === null && !loading && (
          <p className="exploring-muted">Couldn’t load the collections.</p>
        )}
        {loading && <p className="placeholder-card">Loading collections…</p>}
        {collections && (
          <div className="exploring-home-collection-groups">
            <CollectionGroup title="mine" nsids={mine} />
            <CollectionGroup title="from elsewhere" nsids={external} />
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, sub, to }) {
  const body = (
    <>
      <dt className="exploring-home-stat-label small-caps">{label}</dt>
      <dd className="exploring-home-stat-value">
        {value}
        {sub && <span className="exploring-home-stat-sub">{sub}</span>}
      </dd>
    </>
  );
  return (
    <div className={`exploring-home-stat${to ? ' is-link' : ''}`}>
      {to ? (
        <Link to={to} className="exploring-home-stat-inner">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

function IdentityRow({ label, value, copy, mono }) {
  return (
    <div className="exploring-home-identity-row">
      <dt className="small-caps">{label}</dt>
      <dd>
        <span className={mono ? 'exploring-home-identity-mono' : undefined}>{value}</span>
        {copy && <CopyButton text={copy} label={label} />}
      </dd>
    </div>
  );
}

function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => {
        if (mounted.current) setCopied(false);
      }, 1200);
    } catch {
      // Clipboard blocked (insecure context / permissions); no-op.
    }
  }

  return (
    <button
      type="button"
      className="exploring-home-copy"
      onClick={onClick}
      aria-label={`Copy ${label}`}
      title={copied ? 'Copied' : `Copy ${label}`}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
    </button>
  );
}

function CollectionGroup({ title, nsids }) {
  if (!nsids || nsids.length === 0) return null;
  return (
    <section className="exploring-home-collection-group">
      <h3 className="exploring-home-collection-group-title small-caps">
        {title} <span className="exploring-home-collection-count">{nsids.length}</span>
      </h3>
      <ul className="exploring-home-collection-list">
        {nsids.map((nsid) => (
          <li key={nsid} className="exploring-home-collection-row">
            <Link to={`/exploring/${OWNER}/${nsid}`} className="exploring-home-collection-link">
              <code>{nsid}</code>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
