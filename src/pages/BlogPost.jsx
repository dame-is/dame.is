import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import Comments from '../components/Comments.jsx';
import { fetchSnapshot } from '../lib/snapshot.js';
import { renderMarkdown } from '../lib/markdown.js';
import { formatDateLong, relativeTime } from '../lib/time.js';
import { dayOfLife } from '../lib/dayOfLife.js';
import { findLeafletCommentsPost } from '../lib/leafletComments.js';
import { getPostThread } from '../lib/atproto.js';
import './Blogging.css';

/**
 * Single blog-post page. The same URL — `/blogging/:id` — fronts two
 * lexicons:
 *
 *   - is.dame.blogging.post  — looked up by the record's `slug` field
 *   - pub.leaflet.document   — looked up by rkey (leaflet has no slug)
 *
 * Resolution order is slug-first so existing links keep working; only if
 * no slug match is found do we treat `:id` as an rkey and search the
 * leaflet snapshot. The result drives a per-kind renderer below.
 */
export default function BlogPost() {
  const { slug: id } = useParams();
  const [resolution, setResolution] = useState({ status: 'loading', kind: null, record: null });
  const [commentsUri, setCommentsUri] = useState(null);
  const [replies, setReplies] = useState([]);
  const [repliesStatus, setRepliesStatus] = useState('idle');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [blogs, leaflets] = await Promise.all([
        fetchSnapshot('blogs').then((s) => (Array.isArray(s) ? s : [])),
        fetchSnapshot('leaflets').then((s) => (Array.isArray(s) ? s : [])),
      ]);
      if (cancelled) return;
      const bySlug = blogs.find((r) => r?.value?.slug === id);
      if (bySlug) {
        setResolution({ status: 'found', kind: 'blog', record: bySlug });
        return;
      }
      const byRkey = leaflets.find((r) => endsWithRkey(r?.uri, id));
      if (byRkey) {
        setResolution({ status: 'found', kind: 'leaflet', record: byRkey });
        return;
      }
      setResolution({ status: 'missing', kind: null, record: null });
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Comments resolution. For is.dame.blogging.post we honor an optional
  // `commentsUri` field. For leaflet docs we follow the convention of
  // looking up an authored Bluesky post whose link facets point at the
  // doc's rkey, then anchor replies to that post.
  useEffect(() => {
    let cancelled = false;
    if (resolution.status !== 'found') return;
    async function resolveCommentsUri() {
      if (resolution.kind === 'blog') {
        return resolution.record?.value?.commentsUri || null;
      }
      if (resolution.kind === 'leaflet') {
        const rkey = endsWithRkey(resolution.record?.uri, id) ? id : null;
        if (!rkey) return null;
        return findLeafletCommentsPost(rkey);
      }
      return null;
    }
    resolveCommentsUri().then((uri) => {
      if (!cancelled) setCommentsUri(uri || null);
    });
    return () => {
      cancelled = true;
    };
  }, [resolution, id]);

  useEffect(() => {
    let cancelled = false;
    if (!commentsUri) {
      setReplies([]);
      setRepliesStatus('idle');
      return;
    }
    setRepliesStatus('loading');
    (async () => {
      try {
        const thread = await getPostThread(commentsUri, { depth: 6, parentHeight: 0 });
        if (cancelled) return;
        const childReplies = Array.isArray(thread?.thread?.replies)
          ? thread.thread.replies
          : [];
        setReplies(childReplies);
        setRepliesStatus('ready');
      } catch {
        if (!cancelled) setRepliesStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commentsUri]);

  if (resolution.status === 'loading') {
    return (
      <PageShell title={id} headTitle={`${id} — Dame is…`}>
        <p className="feed-empty">Loading post…</p>
      </PageShell>
    );
  }

  if (resolution.status === 'missing') {
    return (
      <PageShell title="Post not found" headTitle="Not found — Dame is…">
        <p>
          No blog post with id <code>{id}</code>.{' '}
          <Link to="/blogging">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  if (resolution.kind === 'leaflet') {
    return (
      <LeafletPostBody
        record={resolution.record}
        id={id}
        commentsUri={commentsUri}
        replies={replies}
        repliesStatus={repliesStatus}
      />
    );
  }

  return (
    <BlogPostBody
      record={resolution.record}
      id={id}
      commentsUri={commentsUri}
      replies={replies}
      repliesStatus={repliesStatus}
    />
  );
}

function BlogPostBody({ record, id, commentsUri, replies, repliesStatus }) {
  const value = record?.value;
  const html = useMemo(() => {
    if (!value?.body) return '';
    return renderMarkdown(value.body, value.bodyFormat || 'markdown');
  }, [value]);
  const created = value?.createdAt;
  const updated = value?.updatedAt || created;
  const dayNum = created ? dayOfLife(created) : null;

  return (
    <PageShell
      title={value?.title || id}
      atUri={record?.uri}
      cid={record?.cid}
      headTitle={value?.title ? `${value.title} — Dame is…` : `${id} — Dame is…`}
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
        {commentsUri && (
          <Comments
            atUri={commentsUri}
            replies={replies}
            status={repliesStatus}
          />
        )}
      </article>
    </PageShell>
  );
}

function LeafletPostBody({ record, id, commentsUri, replies, repliesStatus }) {
  const value = record?.value || {};
  const created = value.publishedAt || value.createdAt;
  const dayNum = created ? dayOfLife(created) : null;
  const title = value.title || id;
  const description = value.description;
  return (
    <PageShell
      title={title}
      atUri={record?.uri}
      cid={record?.cid}
      headTitle={`${title} — Dame is…`}
    >
      <article className="blog-article">
        <div className="blog-article-meta">
          {created && <span>{formatDateLong(created)}</span>}
          {dayNum && <span>· Day {dayNum.toLocaleString()}</span>}
          {created && <span>· {relativeTime(created)}</span>}
          <span className="blog-article-tag">leaflet</span>
        </div>
        {description && <p className="blog-article-description">{description}</p>}
        <LeafletDocument doc={value} />
        {commentsUri && (
          <Comments
            atUri={commentsUri}
            replies={replies}
            status={repliesStatus}
          />
        )}
      </article>
    </PageShell>
  );
}

function endsWithRkey(uri, rkey) {
  if (!uri || !rkey) return false;
  const m = String(uri).match(/\/([^/]+)$/);
  return m && m[1] === rkey;
}
