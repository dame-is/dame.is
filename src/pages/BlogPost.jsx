import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import Comments from '../components/Comments.jsx';
import DocumentMeta from '../components/DocumentMeta.jsx';
import ReadingMarker from '../components/ReadingMarker.jsx';
import SequenceFoot, { countWord } from '../components/SequenceFoot.jsx';
import Fleuron from '../components/Fleuron.jsx';
import NewsletterSignup from '../components/NewsletterSignup.jsx';
import { InspectMargin } from '../components/XraySubstrate.jsx';
import Time from '../components/Time.jsx';
import { DocumentSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, getRecord, isRecordNotFound, explorerPathFromAtUri } from '../lib/atproto.js';
import { getPostThread } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { showOnBlog, isDraft } from '../lib/publications.js';
import { smartenText } from '../lib/smartPunctuation.js';
import { formatDateFull, formatDateShort, recentDay } from '../lib/time.js';
import { documentWords, readingMinutes } from '../lib/readingTime.js';
import { shortenCid } from '../lib/xray.js';
import { hasSignupBlock, SUBSCRIBE_ID } from '../lib/newsletter.js';
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
      // One getRecord, not the whole collection: `:id` is the rkey, and
      // resolveById matches on nothing else.
      let record;
      try {
        record = await getRecord(pds, {
          repo: ME_DID,
          collection: COLLECTIONS.blogging,
          rkey: id,
        });
      } catch (err) {
        // A PDS that says the record isn't there is an answer — an empty list,
        // which resolves to "Post not found". Anything else (a timeout, a 5xx)
        // is rethrown, so the snapshot stands or the page offers a refresh.
        if (isRecordNotFound(err)) return [];
        throw err;
      }
      const records = record?.value ? [record] : [];
      // Bake `_url` onto image/cover blob refs (and a summary) so live-fetched
      // posts — ones not yet in the prefetched snapshot — render their images.
      // The snapshot path already does this at build time via transformRecords.
      transformRecords(records, COLLECTIONS.blogging, pds, ME_DID);
      if (!records.length) return records;
      // The essay's place in the blog ("Essay 3 of 7", the earlier and later
      // essays) needs the rest of the blog, which one record can't say. The
      // build's copy supplies it, with this live record in place of its own
      // entry, or added when it was published after the build.
      const snapshot = await fetchSnapshot('blogs').catch(() => null);
      const others = Array.isArray(snapshot)
        ? snapshot.filter((r) => r?.uri !== records[0].uri)
        : [];
      return [...others, ...records];
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
        <DocumentSkeleton kind="essay" />
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

  const index = essays.findIndex((r) => r?.uri === record?.uri);
  const total = essays.length;
  const earlier = index > 0 ? essays[index - 1] : null;
  const later = index >= 0 && index < total - 1 ? essays[index + 1] : null;

  // The colophon, a band under the title: when the essay was published, as
  // "today", "yesterday" or "3d ago" for its first week (the date on hover)
  // and as the date after that; how long it takes to read; and its edition,
  // the record's CID ("this exact version" in x-ray's words), linked to the
  // record in the explorer. Where it sits in the blog is the earlier/later
  // foot's to say.
  // Where the author placed signup blocks, those are the post's forms; a post
  // without one gets the newsletter after its last line.
  const endSignup = !hasSignupBlock(value.content?.pages);
  const edition = record?.cid ? <Edition atUri={record.uri} cid={record.cid} /> : null;
  const minutes = readingMinutes(documentWords(value.content));
  const recent = created ? recentDay(created) : '';
  const recently = recent ? <PublishedRecently date={created} recent={recent} /> : null;
  const columns = created
    ? [
        {
          key: 'date',
          label: 'Published',
          long: recently || formatDateFull(created),
          short: recently || formatDateShort(created),
        },
        ...(minutes
          ? [{ key: 'reading', label: 'Reading time', long: `${minutes} minute${minutes === 1 ? '' : 's'}`, short: `${minutes} min` }]
          : []),
        ...(edition ? [{ key: 'edition', label: 'Edition', long: edition, short: edition }] : []),
      ]
    : null;

  return (
    <PageShell atUri={record?.uri} cid={record?.cid} headTitle={`${title} — dame.is`}>
      {/* A book page on the page grid: the title across the type area, the
          text in the text column, and beside it in the note column the facts
          and, under them, the reading marker that keeps the reader's place
          (Blogging.css .doc-body). On a phone the facts are a band under the
          title again. */}
      <article className="blog-article blog-book reveal">
        <h1 className="page-title blog-title">{title}</h1>
        <InspectMargin atUri={record?.uri} cid={record?.cid} />
        <div className="doc-body">
          <aside className="blog-margin">
            {columns && <DocumentMeta columns={columns} />}
            <ReadingMarker minutes={minutes} />
          </aside>
          {/* The `description` field is intentionally not rendered here — it's
              the open-graph / feed-summary blurb, and on the post itself it
              just duplicated the opening lines of the body. */}
          <LeafletDocument doc={value.content} quotable />
        </div>
        <footer className="blog-end">
          <p className="blog-end-mark" aria-hidden="true">
            <Fleuron />
          </p>
          {endSignup && <NewsletterSignup id={SUBSCRIBE_ID} />}
          {total > 1 && index >= 0 && (
            <SequenceFoot
              label="Other posts"
              earlierLabel="Earlier post"
              laterLabel="Later post"
              earlier={essayEntry(earlier)}
              later={essayEntry(later)}
              earlierNone={`None. This is the first of ${countWord(total)}.`}
              laterNone={`None yet. This is the latest of ${countWord(total)}.`}
              all={{ to: '/blogging', label: `All ${total} posts in blogging` }}
            />
          )}
        </footer>
        <PrintColophon
          created={created}
          atUri={record?.uri}
          replyCount={metrics?.replyCount}
        />
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

/**
 * A first-week essay's "today", "yesterday" or "3d ago", with its date on
 * hover. Paper gets the date instead, since "today" is wrong by the time
 * anyone reads a printout.
 */
function PublishedRecently({ date, recent }) {
  return (
    <>
      <Time value={date} title={formatDateShort(date)} className="blog-published-recent">
        {recent}
      </Time>
      <span className="blog-published-print">{formatDateFull(date)}</span>
    </>
  );
}

/**
 * The record's CID, shortened, linking to the record in the explorer, which
 * shows it whole. The full CID rides in the title for a hover.
 */
function Edition({ atUri, cid }) {
  const path = explorerPathFromAtUri(atUri);
  const short = shortenCid(cid);
  if (!path) return <code className="blog-edition-cid">{short}</code>;
  return (
    <Link to={path} className="blog-edition-cid" title={cid}>
      {short}
    </Link>
  );
}

/**
 * What a printed essay carries instead of the screen's furniture (GAP-08):
 * where it lives, when it was published and printed, the record it was set
 * from, and how many replies it has, since the replies themselves don't go
 * onto paper. Hidden on screen; Blogging.css shows it under @media print.
 * Dates are absolute because a relative one is wrong a week after printing.
 */
function PrintColophon({ created, atUri, replyCount }) {
  const { pathname } = useLocation();
  return (
    <footer className="blog-print-colophon">
      <p>dame.is{pathname}</p>
      <p>
        {created ? `Published ${formatDateFull(created)}. ` : ''}
        Printed {formatDateFull(new Date())}.
        {replyCount ? ` ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} on Bluesky.` : ''}
      </p>
      {atUri && (
        <p>
          <code>{atUri}</code>
        </p>
      )}
    </footer>
  );
}

function endsWithRkey(uri, rkey) {
  if (!uri || !rkey) return false;
  const m = String(uri).match(/\/([^/]+)$/);
  return m && m[1] === rkey;
}
