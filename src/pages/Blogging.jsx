import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import FlatLedger from '../components/FlatLedger.jsx';
import NewsletterSignup from '../components/NewsletterSignup.jsx';
import { matchesQuery } from '../components/FeedSearch.jsx';
import { BloggingTocSkeleton } from '../components/Skeleton.jsx';
import Time from '../components/Time.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { compareIsoDesc } from '../lib/time.js';
import { showOnBlog, isDraft } from '../lib/publications.js';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import { smartenText } from '../lib/smartPunctuation.js';
import { SUBSCRIBE_ID } from '../lib/newsletter.js';
import { ME_DID, COLLECTIONS } from '../config.js';
import '../components/Feed.css';
import './Blogging.css';

/**
 * The blog index. Backed by `site.standard.document` records (in the
 * `blogs` snapshot), addressed by rkey. Portfolio-homed standard-docs are
 * filtered out — they live on /creating — unless one opts back in with a
 * `blog` cross-post tag (see `showOnBlog`). (pub.leaflet.document is
 * deprecated and no longer fetched.)
 */
export default function Blogging() {
  const [params] = useSearchParams();
  const q = params.get('q') || '';
  const { title, intro } = usePageContent('blogging');

  const { items: entries, status } = useLiveFeed({
    name: 'blogs',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const records = await listRecords(pds, {
        repo: ME_DID,
        collection: COLLECTIONS.blogging,
        max: 200,
      });
      // Match the snapshot path: bake blob `_url`s (and a summary fallback) so
      // live-fetched posts render consistently with prefetched ones.
      transformRecords(records, COLLECTIONS.blogging, pds, ME_DID);
      return records;
    },
    mapItems: mergeBlogEntries,
  });

  const loading = status === 'loading';
  const safeEntries = useMemo(() => entries || [], [entries]);
  const filtered = useMemo(
    () =>
      safeEntries.filter((e) =>
        matchesQuery([e.title, e.summary, e.id].filter(Boolean).join(' '), q),
      ),
    [safeEntries, q],
  );

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/blogging`}
      headTitle="dame.is blogging"
    >
      {/* SUBSCRIBE_URL lands here: the address a post's "subscribe" link
          gives everywhere the post's own forms aren't (email, feeds). */}
      <NewsletterSignup id={SUBSCRIBE_ID} />
      {loading ? (
        <BloggingTocSkeleton rows={5} />
      ) : status === 'error' ? (
        // Neither the snapshot nor the PDS answered. That is not an empty blog,
        // and saying "No blog posts yet." told readers it was.
        <p className="feed-empty">
          Couldn&rsquo;t load the blog right now.{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </p>
      ) : filtered.length === 0 ? (
        <p className="feed-empty">
          {q ? 'No blog posts match that search.' : 'No blog posts yet.'}
        </p>
      ) : (
        <FlatLedger
          rows={filtered.map((e, i) => ({
            key: e.uri || i,
            href: e.href,
            title: e.title,
            time: e.createdAt ? <Time value={e.createdAt} variant="relative" /> : null,
            nsid: nsidFromAtUri(e.uri),
            atUri: e.uri || null,
            cid: e.cid || null,
          }))}
        />
      )}
    </PageShell>
  );
}

function mergeBlogEntries(data) {
  // `data` is the `blogs` snapshot/live array of site.standard.document
  // records. (pub.leaflet.document is deprecated and no longer fetched.)
  const blogs = Array.isArray(data) ? data : [];
  return blogs
    // Blog-homed docs plus any portfolio doc cross-posted with a `blog` tag.
    // Portfolio-only docs live on /creating. Drafts stay hidden — the live PDS
    // fetch returns them, so filter here where snapshot and live both pass.
    .filter((r) => r?.value && !isDraft(r.value) && showOnBlog(r.value))
    .map(normalizeStandard)
    .sort((a, b) => compareIsoDesc(a.createdAt, b.createdAt));
}

function normalizeStandard(record) {
  const v = record.value || {};
  const rkey = rkeyFromAtUri(record.uri);
  return {
    kind: 'standard',
    uri: record.uri,
    id: rkey,
    // Typeset for display, as the essay page sets its own title.
    title: smartenText(v.title || rkey || 'Untitled'),
    summary: smartenText(v.description || ''),
    createdAt: v.publishedAt || v.createdAt || '',
    href: `/blogging/${rkey}`,
  };
}
