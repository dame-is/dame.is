import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { CreatingWorkSkeleton } from '../components/Skeleton.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { renderMarkdown } from '../lib/markdown.js';
import { formatDateLong } from '../lib/time.js';
import { isPortfolioDoc, workSlug, workCategory } from '../lib/publications.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Creating.css';
import './Blogging.css';

const STANDARD_DOC = 'site.standard.document';

export default function CreatingWork() {
  const { slug } = useParams();

  const { items: record, status } = useLiveFeed({
    strategy: 'snapshot-first',
    fetchSnapshotOverride: async () => {
      const [creations, blogs] = await Promise.all([
        fetchSnapshot('creations'),
        fetchSnapshot('blogs'),
      ]);
      const std = Array.isArray(blogs) ? blogs.filter((r) => isPortfolioDoc(r?.value)) : [];
      return [...std, ...(Array.isArray(creations) ? creations : [])];
    },
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const [stdDocs, legacy] = await Promise.all([
        listRecords(pds, { repo: ME_DID, collection: STANDARD_DOC, max: 200 }),
        listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 }),
      ]);
      transformRecords(stdDocs, STANDARD_DOC, pds, ME_DID);
      transformRecords(legacy, COLLECTIONS.creating, pds, ME_DID);
      return [...stdDocs.filter((r) => isPortfolioDoc(r?.value)), ...legacy];
    },
    mapItems: (snap) => {
      if (!Array.isArray(snap)) return null;
      return (
        snap.find((r) => r?.value && workSlug(r.value) === slug) ||
        // Fall back to the rkey so URI-derived links resolve too.
        snap.find((r) => rkeyFromAtUri(r?.uri) === slug) ||
        null
      );
    },
    deps: [slug],
  });

  // Legacy fallback: only for records that haven't been migrated yet (no
  // `content`) but still have a markdown `body`. New records render
  // entirely through LeafletDocument.
  const legacyHtml = useMemo(() => {
    const v = record?.value;
    if (v?.content || !v?.body) return '';
    return renderMarkdown(v.body, v.bodyFormat || 'markdown');
  }, [record]);

  if (status === 'loading') {
    return (
      <PageShell headTitle={`${slug} — dame.is`}>
        <article className="creating-work-page">
          <CreatingWorkSkeleton />
        </article>
      </PageShell>
    );
  }

  if (!record) {
    return (
      <PageShell title="Work not found" headTitle="Not found — dame.is">
        <p>
          No creative work with slug <code>{slug}</code>.{' '}
          <Link to="/creating">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  const v = record?.value;

  return (
    <PageShell
      title={v?.title || slug}
      atUri={record?.uri}
      cid={record?.cid}
      headTitle={v?.title ? `${v.title} — dame.is` : `${slug} — dame.is`}
      eyebrow={
        <Link to="/creating" className="page-back small-caps">
          ← Portfolio
        </Link>
      }
    >
      <article className="creating-work-page reveal">
        <div className="blog-article-meta">
          {workCategory(v) && (
            <span className="blog-article-tag">{workCategory(v)}</span>
          )}
          {v?.createdAt && <span>· {formatDateLong(v.createdAt)}</span>}
        </div>
        {/* Only the legacy `summary` shows as an on-page intro. The standard.site
            `description` is the open-graph / feed-summary blurb and isn't
            rendered on the work itself. */}
        {v?.summary && (
          <p className="page-intro">{v.summary}</p>
        )}
        {v?.content?.pages ? (
          <LeafletDocument doc={v.content} />
        ) : (
          <>
            {Array.isArray(v?.media) && v.media.length > 0 && (
              <div className="creating-work-media">
                {v.media.map((m, i) =>
                  m?.kind === 'image' && m.url ? (
                    <img key={m.url + i} src={m.url} alt={m.alt || ''} loading="lazy" />
                  ) : null,
                )}
              </div>
            )}
            {legacyHtml && (
              <div className="blog-prose" dangerouslySetInnerHTML={{ __html: legacyHtml }} />
            )}
            {Array.isArray(v?.links) && v.links.length > 0 && (
              <ul className="creating-work-links about-links">
                {v.links.map((l) => (
                  <li key={l.url}>
                    <a href={l.url} target="_blank" rel="noreferrer noopener">
                      {l.label || l.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </article>
    </PageShell>
  );
}
