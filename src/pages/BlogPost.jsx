import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import Comments from '../components/Comments.jsx';
import DocumentMeta from '../components/DocumentMeta.jsx';
import SequenceFoot, { countWord } from '../components/SequenceFoot.jsx';
import { InspectMargin } from '../components/XraySubstrate.jsx';
import { BlogPostSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, listRecords } from '../lib/atproto.js';
import { getPostThread } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { showOnBlog, isDraft, primaryTag } from '../lib/publications.js';
import { smartenText } from '../lib/smartPunctuation.js';
import { formatDateFull, formatDateShort, relativeDay, relativeDayShort } from '../lib/time.js';
import { shortenCid } from '../lib/xray.js';
import { useXray } from '../hooks/useXray.jsx';
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
    name: 'blogs',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const records = await listRecords(pds, {
        repo: ME_DID,
        collection: COLLECTIONS.blogging,
        max: 200,
      });
      // Bake `_url` onto image/cover blob refs (and a summary) so live-fetched
      // posts — ones not yet in the prefetched snapshot — render their images.
      // The snapshot path already does this at build time via transformRecords.
      transformRecords(records, COLLECTIONS.blogging, pds, ME_DID);
      return records;
    },
    mapItems: (data) => resolveById(data, id),
    deps: [id],
  });

  const [commentsUri, setCommentsUri] = useState(null);
  const [replies, setReplies] = useState([]);
  const [repliesStatus, setRepliesStatus] = useState('idle');
  const [metrics, setMetrics] = useState(null);

  // Comments resolution. Standard docs may carry an optional `commentsUri`
  // field pointing at a Bluesky post thread.
  useEffect(() => {
    let cancelled = false;
    if (!resolution || !resolution.record) return;
    async function resolveCommentsUri() {
      if (resolution.kind === 'standard') {
        return resolution.record?.value?.commentsUri || null;
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
      setMetrics(null);
      return;
    }
    setRepliesStatus('loading');
    (async () => {
      try {
        const thread = await getPostThread(commentsUri, { depth: 6, parentHeight: 0 });
        if (cancelled) return;
        // The anchor post view carries the thread's engagement tallies —
        // surface them above the replies so the post's reach on Bluesky is
        // visible without leaving the page.
        setMetrics(deriveMetrics(thread?.thread?.post));
        const childReplies = Array.isArray(thread?.thread?.replies)
          ? thread.thread.replies
          : [];
        setReplies(childReplies);
        setRepliesStatus('ready');
      } catch {
        if (!cancelled) {
          setRepliesStatus('error');
          setMetrics(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [commentsUri]);

  if (feedStatus === 'loading') {
    return (
      <PageShell headTitle={`${id} — dame.is`}>
        <article className="blog-article">
          <BlogPostSkeleton paragraphs={4} />
        </article>
      </PageShell>
    );
  }

  // A transient load failure (both snapshot and live fetch failed) must not read
  // as "not found" — that breaks shared/OG links. Keep the URL and offer a
  // refresh. Only a resolved-but-absent record below is a true 404. See §4.1.
  if (feedStatus === 'error') {
    return (
      <PageShell title="Couldn’t load this right now" headTitle="Couldn’t load — dame.is">
        <p>Couldn&rsquo;t load this post right now — refresh to try again.</p>
        <p>
          <button type="button" onClick={() => window.location.reload()}>
            Refresh
          </button>{' '}
          <Link to="/blogging">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  if (!resolution || !resolution.record) {
    return (
      <PageShell title="Post not found" headTitle="Not found — dame.is">
        <p>
          No blog post with id <code>{id}</code>.{' '}
          <Link to="/blogging">Back to the index.</Link>
        </p>
      </PageShell>
    );
  }

  return (
    <StandardPostBody
      record={resolution.record}
      essays={resolution.essays}
      id={id}
      commentsUri={commentsUri}
      replies={replies}
      repliesStatus={repliesStatus}
      metrics={metrics}
    />
  );
}

/**
 * Distill an `app.bsky.feed.getPostThread` anchor post view into the four
 * engagement tallies the comments header renders. The "Reply" action there
 * works off the thread's `at://` URI directly (via the waypoints picker), so
 * no link needs to be derived here.
 */
function deriveMetrics(post) {
  if (!post) return null;
  return {
    likeCount: post.likeCount || 0,
    repostCount: post.repostCount || 0,
    quoteCount: post.quoteCount || 0,
    replyCount: post.replyCount || 0,
  };
}

function resolveById(data, id) {
  // `data` is the `blogs` array of site.standard.document records.
  const blogs = Array.isArray(data) ? data : [];
  // Blog-homed docs, plus any portfolio doc cross-posted to the blog with a
  // `blog` tag — so a dual-listed work resolves at /blogging/:rkey too. Drafts
  // stay hidden even by direct URL (the live fetch would otherwise find them).
  const listed = blogs.filter((r) => !isDraft(r?.value) && showOnBlog(r?.value));
  const standard = listed.find((r) => endsWithRkey(r?.uri, id));
  if (!standard) return null;
  // The blog in reading order, oldest first, for "Essay 3 of 7" and the
  // earlier / later foot.
  const essays = listed
    .slice()
    .sort((a, b) => String(dateOf(a)).localeCompare(String(dateOf(b))));
  return { kind: 'standard', record: standard, essays };
}

const dateOf = (r) => r?.value?.publishedAt || r?.value?.createdAt || '';
const rkeyOf = (uri) => String(uri || '').split('/').pop();

/** One neighbour, shaped for SequenceFoot. */
function essayEntry(r) {
  if (!r) return null;
  return {
    to: `/blogging/${rkeyOf(r.uri)}`,
    title: smartenText(r.value?.title || rkeyOf(r.uri)),
    meta: dateOf(r) ? formatDateFull(dateOf(r)) : null,
  };
}

function StandardPostBody({ record, essays = [], id, commentsUri, replies, repliesStatus, metrics }) {
  const value = record?.value || {};
  const created = value.publishedAt || value.createdAt;
  // The record keeps the title as typed; the page sets it (curly quotes,
  // real apostrophes), including in the tab.
  const title = smartenText(value.title || id);
  const { toggle: toggleXray } = useXray();

  const index = essays.findIndex((r) => r?.uri === record?.uri);
  const total = essays.length;
  const earlier = index > 0 ? essays[index - 1] : null;
  const later = index >= 0 && index < total - 1 ? essays[index + 1] : null;

  // The colophon. In the margin on a wide screen, folded back into the band
  // under the title below that, where the edition (the record's CID, "this
  // exact version" in x-ray's words) drops out to keep three columns.
  // `primaryTag`, not `workCategory`: a post's tags name subjects, and the
  // medium inference behind `workCategory` would caption a cross-posted post
  // "case study", a value its record never carries.
  const tag = primaryTag(value);
  const columns = created
    ? [
        { key: 'date', label: 'Published', long: formatDateFull(created), short: formatDateShort(created) },
        { key: 'elapsed', label: 'Elapsed', long: relativeDay(created), short: relativeDayShort(created) },
        ...(index >= 0 && total > 1
          ? [{ key: 'essay', label: 'Essay', long: `${index + 1} of ${total} in blogging`, short: `${index + 1} of ${total}` }]
          : []),
        ...(tag ? [{ key: 'tag', label: 'Tagged', long: tag, short: tag }] : []),
        ...(record?.cid
          ? [
              {
                key: 'edition',
                label: 'Edition',
                long: (
                  <>
                    <code className="blog-edition-cid">{shortenCid(record.cid)}</code>{' '}
                    <button type="button" className="blog-edition-inspect" onClick={toggleXray}>
                      inspect
                    </button>
                  </>
                ),
                short: null,
              },
            ]
          : []),
      ]
    : null;

  return (
    <PageShell atUri={record?.uri} cid={record?.cid} headTitle={`${title} — dame.is`}>
      {/* A book page: the title and the text hang from the chrome's left edge
          in one 28em column, and the facts sit in the margin beside them
          (Blogging.css .blog-book). */}
      <article className="blog-article blog-book reveal">
        <h1 className="page-title blog-title">{title}</h1>
        <aside className="blog-margin">
          {columns && <DocumentMeta columns={columns.map((c) => ({ ...c, short: c.short ?? c.long }))} />}
        </aside>
        <InspectMargin atUri={record?.uri} cid={record?.cid} />
        {/* The `description` field is intentionally not rendered here — it's the
            open-graph / feed-summary blurb, and on the post itself it just
            duplicated the opening lines of the body. */}
        <LeafletDocument doc={value.content} />
        <footer className="blog-end">
          <p className="blog-end-mark" aria-hidden="true">
            &#x2767;
          </p>
          {total > 1 && index >= 0 && (
            <SequenceFoot
              label="Other essays"
              earlierLabel="Earlier essay"
              laterLabel="Later essay"
              earlier={essayEntry(earlier)}
              later={essayEntry(later)}
              earlierNone={`None. This is the first of ${countWord(total)}.`}
              laterNone={`None yet. This is the latest of ${countWord(total)}.`}
              all={{ to: '/blogging', label: `All ${total} essays in blogging` }}
            />
          )}
        </footer>
        {commentsUri && (
          <Comments
            atUri={commentsUri}
            replies={replies}
            status={repliesStatus}
            metrics={metrics}
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
