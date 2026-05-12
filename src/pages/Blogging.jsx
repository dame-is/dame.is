import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { relativeTime } from '../lib/time.js';
import { ME_DID } from '../config.js';
import '../components/Feed.css';
import './Blogging.css';

export default function Blogging() {
  const [posts, setPosts] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchSnapshot('blogs').then((snap) => {
      if (cancelled || !Array.isArray(snap)) return;
      setPosts(
        snap
          .filter((r) => r?.value)
          .sort((a, b) => {
            const ax = a.value?.createdAt || '';
            const bx = b.value?.createdAt || '';
            return ax < bx ? 1 : -1;
          }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageShell
      verb="blogging"
      title="Blogging"
      intro="A book of long-form posts. Each entry is an is.dame.blogging.post record."
      atUri={`at://${ME_DID}/is.dame.page/blogging`}
      headTitle="Blogging — Dame is&hellip;"
    >
      {posts.length === 0 ? (
        <p className="feed-empty">No blog posts yet.</p>
      ) : (
        <ol className="blogging-toc">
          {posts.map((r, i) => {
            const v = r.value || {};
            const slug = v.slug;
            const title = v.title || slug || 'Untitled';
            const summary = v.summary;
            return (
              <li key={r.uri || i} className="blogging-toc-entry">
                <Link to={`/blogging/${slug}`} className="blogging-toc-link">
                  <span className="blogging-toc-num gutter">{String(i + 1).padStart(2, '0')}</span>
                  <span className="blogging-toc-body">
                    <h3 className="blogging-toc-title">{title}</h3>
                    {summary && <p className="blogging-toc-summary">{summary}</p>}
                  </span>
                  <span className="blogging-toc-meta gutter">
                    {v.createdAt ? relativeTime(v.createdAt) : ''}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </PageShell>
  );
}
