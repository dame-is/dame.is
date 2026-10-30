import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import NewsletterSignup from '../components/NewsletterSignup.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import { compareIsoDesc, formatDateFull } from '../lib/time.js';
import { showOnBlog, isDraft } from '../lib/publications.js';
import { smartenText } from '../lib/smartPunctuation.js';
import {
  countWords,
  documentWords,
  readingMinutes,
} from '../lib/readingTime.js';
import { SUBSCRIBE_ID } from '../lib/newsletter.js';
import { ME_DID, COLLECTIONS, BLOG_PUBLICATION } from '../config.js';
import './BloggingSubscribe.css';

/**
 * /blogging/subscribe: the newsletter's own page, drawn as the email itself.
 * A ruled header of From / To / Subject / Date whose To line is the form,
 * then the latest post's opening as the body, fading out above a link to the
 * rest, with earlier posts a step away. The posts come from the same `blogs`
 * snapshot the index reads.
 *
 * The newsletter carries more than the blog (updates, roundups,
 * announcements), but the posts are what exists to show, so the copy says
 * so and the body is a post.
 */
export default function BloggingSubscribe() {
  const { items, status } = useLiveFeed({
    name: 'blogs',
    strategy: 'snapshot-first',
    fetchLive: async () => {
      const pds = await resolvePds(ME_DID);
      const records = await listRecords(pds, {
        repo: ME_DID,
        collection: COLLECTIONS.blogging,
        max: 200,
      });
      transformRecords(records, COLLECTIONS.blogging, pds, ME_DID);
      return records;
    },
    mapItems: toPosts,
  });
  const posts = useMemo(() => items || [], [items]);
  const ready = status !== 'loading' && posts.length > 0;
  const [at, setAt] = useState(0);
  const post = posts[Math.min(at, posts.length - 1)];

  return (
    <PageShell
      atUri={BLOG_PUBLICATION}
      headTitle="Subscribe to the dame.is newsletter"
    >
      <div className="sub-letter">
        <header className="sub-head">
          <p className="eyebrow">The dame.is newsletter</p>
          <h1 className="page-title">Letters from dame.is</h1>
          <p className="page-intro">
            New blog posts, along with updates, roundups and announcements when
            there&rsquo;s something to share, sent to your inbox. Put your
            address on the To line; below is{' '}
            {at === 0 ? 'the latest post' : 'an earlier post'}, the way it would
            arrive.
          </p>
        </header>
        <div className="sub-mail">
          <dl className="sub-mail-head">
            <div className="sub-mail-field">
              <dt>From</dt>
              <dd>
                dame.is blogging{' '}
                <span className="sub-mail-muted">via Leaflet</span>
              </dd>
            </div>
            <div className="sub-mail-field sub-mail-to">
              <dt>To</dt>
              <dd>
                <NewsletterSignup
                  id={SUBSCRIBE_ID}
                  title="Subscribe"
                  className="newsletter--inline"
                />
              </dd>
            </div>
            {post && (
              <>
                <div className="sub-mail-field">
                  <dt>Subject</dt>
                  <dd className="sub-mail-subject">{post.title}</dd>
                </div>
                <div className="sub-mail-field">
                  <dt>Date</dt>
                  <dd>{formatDateFull(post.date)}</dd>
                </div>
              </>
            )}
          </dl>
          {ready && post && (
            <article className="sub-mail-body" aria-live="polite">
              <h2 className="sub-mail-title">{post.title}</h2>
              {post.description && (
                <p className="sub-mail-dek">{post.description}</p>
              )}
              <div className="sub-mail-prose">
                {post.opening.map((text, i) => (
                  <p key={i} className={i === 0 ? 'dropcap' : undefined}>
                    {text}
                  </p>
                ))}
              </div>
              <p className="sub-mail-more">
                <Link to={post.href} className="btn">
                  Keep reading{post.minutes ? `, ${post.minutes} min` : ''}
                </Link>
              </p>
            </article>
          )}
          {ready && posts.length > 1 && (
            <nav className="sub-mail-nav" aria-label="Earlier posts">
              <button
                type="button"
                className="btn btn--text"
                onClick={() => setAt((n) => n + 1)}
                disabled={at >= posts.length - 1}
              >
                <ArrowLeft size={14} aria-hidden="true" /> Earlier
              </button>
              <span className="sub-mail-count">
                {at + 1} of {posts.length}
              </span>
              <button
                type="button"
                className="btn btn--text"
                onClick={() => setAt((n) => n - 1)}
                disabled={at === 0}
              >
                Later <ArrowRight size={14} aria-hidden="true" />
              </button>
            </nav>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/** The blog's posts, newest first. */
function toPosts(data) {
  const blogs = Array.isArray(data) ? data : [];
  return (
    blogs
      // The index's filter (Blogging.jsx mergeBlogEntries): blog-homed docs
      // and cross-posts, never drafts.
      .filter((r) => r?.value && !isDraft(r.value) && showOnBlog(r.value))
      .map(toPost)
      .sort((a, b) => compareIsoDesc(a.date, b.date))
  );
}

function toPost(record) {
  const v = record.value || {};
  const rkey = rkeyFromAtUri(record.uri);
  return {
    uri: record.uri,
    href: `/blogging/${rkey}`,
    title: smartenText(v.title || rkey || 'Untitled'),
    description: smartenText(v.description || ''),
    date: v.publishedAt || v.createdAt || '',
    minutes: readingMinutes(documentWords(v.content)),
    opening: openingParagraphs(v.content, 110),
  };
}

/**
 * A post's first paragraphs of prose, until about `limit` words: what an
 * email shows before the fold. Headings, pictures and embeds are passed over.
 */
function openingParagraphs(content, limit) {
  const out = [];
  let words = 0;
  for (const page of Array.isArray(content?.pages) ? content.pages : []) {
    for (const wrap of Array.isArray(page?.blocks) ? page.blocks : []) {
      const block = wrap?.block;
      if (block?.$type !== 'pub.leaflet.blocks.text') continue;
      const text = String(block.plaintext || '').trim();
      if (!text) continue;
      out.push(smartenText(text));
      words += countWords(text);
      if (words >= limit) return out;
    }
  }
  return out;
}
