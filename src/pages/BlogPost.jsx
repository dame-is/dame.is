import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import Comments from '../components/Comments.jsx';
import { BlogPostSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { formatDateLong, relativeTime } from '../lib/time.js';
import { dayOfLife } from '../lib/dayOfLife.js';
import { findLeafletCommentsPost } from '../lib/leafletComments.js';
import { getPostThread } from '../lib/atproto.js';
import { isPortfolioDoc } from '../lib/publications.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import './Blogging.css';

/**
 * Single blog-post page. The same URL — `/blogging/:id` — fronts two
 * lexicons, both addressed by rkey and both storing leaflet-format block
 * content:
 *
 *   - site.standard.document — standard.site docs
 *   - pub.leaflet.document   — leaflet.pub docs
 *
 * `:id` is matched as an rkey against the standard-doc snapshot first, then
 * the leaflet snapshot. The result drives a per-kind renderer below.
 */
export default function BlogPost() {
  const { slug: id } = useParams();

  const { items: resolution, status: feedStatus } = useLiveFeed({
    strategy: 'snapshot-first',
    fetchSnapshotOverride: async () => {
      const [blogs, leaflets] = await Promise.all([
        fetchSnapshot('blogs'),
        fetchSnapshot('leaflets'),
      ]);
      return { blogs, leaflets };
    },
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const [blogs, leaflets] = await Promise.all([
        listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.blogging, max: 200 }),
        listRecords(pds, { repo: ME_DID, collection: COLLECTIONS.leaflet, max: 200 }),
      ]);
      return { blogs, leaflets };
    },
    mapItems: (data) => resolveById(data, id),
    deps: [id],
  });

  const [commentsUri, setCommentsUri] = useState(null);
  const [replies, setReplies] = useState([]);
  const [repliesStatus, setRepliesStatus] = useState('idle');

  // Comments resolution. Standard docs may carry an optional `commentsUri`
  // field. For leaflet docs we follow the convention of looking up an
  // authored Bluesky post whose link facets point at the doc's rkey, then
  // anchor replies to that post.
  useEffect(() => {
    let cancelled = false;
    if (!resolution || !resolution.record) return;
    async function resolveCommentsUri() {
      if (resolution.kind === 'standard') {
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

  if (feedStatus === 'loading') {
    return (
      <PageShell headTitle={`${id} — Dame is…`}>
        <article className="blog-article">
          <BlogPostSkeleton paragraphs={4} />
        </article>
      </PageShell>
    );
  }

  if (!resolution || !resolution.record) {
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
    <StandardPostBody
      record={resolution.record}
      id={id}
      commentsUri={commentsUri}
      replies={replies}
      repliesStatus={repliesStatus}
    />
  );
}

function resolveById(data, id) {
  if (!data) return null;
  const blogs = Array.isArray(data.blogs) ? data.blogs : [];
  const leaflets = Array.isArray(data.leaflets) ? data.leaflets : [];
  // Portfolio standard-docs are creative works, not blog posts.
  const standard = blogs.find((r) => endsWithRkey(r?.uri, id) && !isPortfolioDoc(r?.value));
  if (standard) return { kind: 'standard', record: standard };
  const byRkey = leaflets.find((r) => endsWithRkey(r?.uri, id));
  if (byRkey) return { kind: 'leaflet', record: byRkey };
  return null;
}

function StandardPostBody({ record, id, commentsUri, replies, repliesStatus }) {
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
      <article className="blog-article reveal">
        <div className="blog-article-meta">
          {created && <span>{formatDateLong(created)}</span>}
          {dayNum && <span>· Day {dayNum.toLocaleString()}</span>}
          {created && <span>· {relativeTime(created)}</span>}
          <span className="blog-article-tag">standard.site</span>
        </div>
        {description && <p className="blog-article-description">{description}</p>}
        <LeafletDocument doc={value.content} />
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
      <article className="blog-article reveal">
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
