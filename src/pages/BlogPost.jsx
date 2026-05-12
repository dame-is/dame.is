import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { renderMarkdown } from '../lib/markdown.js';
import { formatDateLong, relativeTime } from '../lib/time.js';
import { dayOfLife } from '../lib/dayOfLife.js';
import Comments from '../components/Comments.jsx';
import './Blogging.css';

export default function BlogPost() {
  const { slug } = useParams();
  const [record, setRecord] = useState(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('blogs').then((snap) => {
      if (cancelled) return;
      if (!Array.isArray(snap)) {
        setMissing(true);
        return;
      }
      const found = snap.find((r) => r?.value?.slug === slug) || null;
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
      <PageShell verb="blogging" title="Post not found" headTitle="Not found — Dame is…">
        <p>
          No <code>is.dame.blogging.post</code> with slug <code>{slug}</code>.{' '}
          <Link to="/blogging">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  const value = record?.value;
  const created = value?.createdAt;
  const updated = value?.updatedAt || created;
  const dayNum = created ? dayOfLife(created) : null;

  return (
    <PageShell
      verb="blogging"
      title={value?.title || slug}
      atUri={record?.uri}
      cid={record?.cid}
      headTitle={value?.title ? `${value.title} — Dame is…` : `${slug} — Dame is…`}
    >
      <article className="blog-article">
        {created && (
          <div className="blog-article-meta">
            <span>{formatDateLong(created)}</span>
            {dayNum && <span>· Day {dayNum.toLocaleString()}</span>}
            <span>· {relativeTime(updated)}</span>
            {Array.isArray(value?.tags) && value.tags.length > 0 && (
              <span className="blog-article-tags">
                {value.tags.map((t) => (
                  <span key={t} className="blog-article-tag">{t}</span>
                ))}
              </span>
            )}
          </div>
        )}
        {html ? (
          <div className="blog-prose" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="feed-empty">This post has no body yet.</p>
        )}
        {value?.commentsUri && (
          <Comments atUri={value.commentsUri} />
        )}
      </article>
    </PageShell>
  );
}
