import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { CreatingWorkSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
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
      return listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.creating, max: 200 });
    },
    mapItems: (snap) => {
      if (!Array.isArray(snap)) return null;
      return snap.find((r) => r?.value?.slug === slug) || null;
    },
    deps: [slug],
  });

  const html = useMemo(() => {
    const v = record?.value;
    if (!v?.body) return '';
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
          {v?.kind && <span className="blog-article-tag">{v.kind}</span>}
          {v?.createdAt && <span>· {formatDateLong(v.createdAt)}</span>}
        </div>
        {v?.summary && <p className="page-intro">{v.summary}</p>}
        {Array.isArray(v?.media) && v.media.length > 0 && (
          <div className="creating-work-media">
            {v.media.map((m, i) =>
              m?.kind === 'image' && m.url ? (
                <img key={m.url + i} src={m.url} alt={m.alt || ''} loading="lazy" />
              ) : null,
            )}
          </div>
        )}
        {html && <div className="blog-prose" dangerouslySetInnerHTML={{ __html: html }} />}
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
      </article>
    </PageShell>
  );
}
