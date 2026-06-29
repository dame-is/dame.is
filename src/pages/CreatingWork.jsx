import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { CreatingWorkSkeleton } from '../components/Skeleton.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { renderMarkdown } from '../lib/markdown.js';
import { formatDateLong } from '../lib/time.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Creating.css';
import './Blogging.css';

export default function CreatingWork() {
  const { slug } = useParams();

  const { items: record, status } = useLiveFeed({
    name: 'creations',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const records = await listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 });
      transformRecords(records, COLLECTIONS.creating, pds, ME_DID);
      return records;
    },
    mapItems: (snap) => {
      if (!Array.isArray(snap)) return null;
      return snap.find((r) => r?.value?.slug === slug) || null;
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
      <PageShell headTitle={`${slug} — Dame is…`}>
        <article className="creating-work-page">
          <CreatingWorkSkeleton />
        </article>
      </PageShell>
    );
  }

  if (!record) {
    return (
      <PageShell title="Work not found" headTitle="Not found — Dame is…">
        <p>
          No <code>is.dame.creating.work</code> with slug <code>{slug}</code>.{' '}
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
      headTitle={v?.title ? `${v.title} — Dame is…` : `${slug} — Dame is…`}
    >
      <article className="creating-work-page reveal">
        <div className="blog-article-meta">
          {(v?.category || v?.kind) && (
            <span className="blog-article-tag">{v.category || v.kind}</span>
          )}
          {v?.createdAt && <span>· {formatDateLong(v.createdAt)}</span>}
        </div>
        {v?.summary && <p className="page-intro">{v.summary}</p>}
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
