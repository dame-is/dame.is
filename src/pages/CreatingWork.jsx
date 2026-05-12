import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { renderMarkdown } from '../lib/markdown.js';
import { formatDateLong } from '../lib/time.js';
import './Creating.css';
import './Blogging.css';

export default function CreatingWork() {
  const { slug } = useParams();
  const [record, setRecord] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('creations').then((snap) => {
      if (cancelled) return;
      if (!Array.isArray(snap)) {
        setMissing(true);
        return;
      }
      const found = snap.find((r) => r?.value?.slug === slug);
      if (found) setRecord(found);
      else setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const html = useMemo(() => {
    const v = record?.value;
    if (!v?.body) return '';
    return renderMarkdown(v.body, v.bodyFormat || 'markdown');
  }, [record]);

  if (missing && !record) {
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
      <article className="creating-work-page">
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
