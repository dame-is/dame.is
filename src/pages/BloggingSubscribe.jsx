import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Scissors } from 'lucide-react';
import PageShell from '../components/PageShell.jsx';
import NewsletterSignup from '../components/NewsletterSignup.jsx';
import Segmented from '../components/Segmented.jsx';
import Fleuron from '../components/Fleuron.jsx';
import { countWord } from '../components/SequenceFoot.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { resolvePds, listRecords, rkeyFromAtUri } from '../lib/atproto.js';
import { transformRecords } from '../lib/feedBuilder.js';
import {
  compareIsoDesc,
  formatDateFull,
  formatDateShort,
} from '../lib/time.js';
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
 * /blogging/subscribe: the newsletter's own page, the form and a taste of
 * what it sends. Three mockups of it for now, switched with ?mockup=, all
 * drawn from the same `blogs` snapshot the index reads:
 *
 *   stack     the form, over the latest three essays as a fanned pile of
 *             sheets, each showing its opening lines
 *   letter    the page as the email itself: the form is its To: line, and
 *             the body is the latest essay's opening, with earlier ones a
 *             step away
 *   contents  a magazine's subscription page: a nameplate, a clip-out card
 *             holding the form, and the contents of every past issue
 *
 * Each draws one NewsletterSignup at SUBSCRIBE_ID, so the way back from
 * Leaflet thanks the reader here whichever mockup they used.
 */
const MOCKUPS = [
  { value: 'stack', label: 'A · Stack' },
  { value: 'letter', label: 'B · Letter' },
  { value: 'contents', label: 'C · Contents' },
];

export default function BloggingSubscribe() {
  const [params, setParams] = useSearchParams();
  const asked = params.get('mockup');
  const mockup = MOCKUPS.some((m) => m.value === asked)
    ? asked
    : MOCKUPS[0].value;

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
    mapItems: toIssues,
  });
  const issues = useMemo(() => items || [], [items]);
  const facts = useMemo(() => blogFacts(issues), [issues]);
  const ready = status !== 'loading' && issues.length > 0;

  const View =
    mockup === 'letter'
      ? LetterMockup
      : mockup === 'contents'
        ? ContentsMockup
        : StackMockup;

  return (
    <PageShell
      atUri={BLOG_PUBLICATION}
      headTitle="Subscribe to dame.is blogging"
    >
      <div className="sub-mockups">
        <span className="eyebrow">Mockup</span>
        <Segmented
          label="Mockup"
          options={MOCKUPS}
          value={mockup}
          onChange={(value) => {
            const next = new URLSearchParams(params);
            next.set('mockup', value);
            setParams(next, { replace: true });
          }}
        />
      </div>
      <View issues={issues} facts={facts} ready={ready} />
    </PageShell>
  );
}

/* ---- A · Stack ------------------------------------------------------- */

function StackMockup({ issues, facts, ready }) {
  const latest = issues.slice(0, 3);
  return (
    <div className="sub-stack">
      <header className="sub-head">
        <p className="eyebrow">dame.is blogging</p>
        <h1 className="page-title">Get the next essay by email</h1>
        <p className="page-intro">
          Long-form writing about my projects and life, sent to your inbox when
          there&rsquo;s a new one.
        </p>
      </header>
      <NewsletterSignup
        id={SUBSCRIBE_ID}
        title="Subscribe"
        className="newsletter--hero"
      />
      {ready && (
        <figure className="sub-pile">
          <div className="sub-pile-sheets">
            {latest.map((issue) => (
              <Link key={issue.uri} to={issue.href} className="sub-sheet">
                <span className="sub-sheet-line eyebrow">
                  {formatDateShort(issue.date)}
                  {issue.minutes ? ` · ${issue.minutes} min` : ''}
                </span>
                <span className="sub-sheet-title">{issue.title}</span>
                {issue.opening[0] && (
                  <span className="sub-sheet-text dropcap">
                    {issue.opening[0]}
                  </span>
                )}
              </Link>
            ))}
          </div>
          <figcaption className="sub-caption">
            The latest {countWord(latest.length)}.{' '}
            <Link to="/blogging">All {facts.count} essays</Link>
            {facts.since ? `, since ${facts.since}` : ''}.
          </figcaption>
        </figure>
      )}
    </div>
  );
}

/* ---- B · Letter ------------------------------------------------------ */

function LetterMockup({ issues, facts, ready }) {
  const [at, setAt] = useState(0);
  const issue = issues[Math.min(at, issues.length - 1)];
  return (
    <div className="sub-letter">
      <header className="sub-head">
        <p className="eyebrow">dame.is blogging, by email</p>
        <h1 className="page-title">Essays, delivered</h1>
        <p className="page-intro">
          Each new essay comes to your inbox the day it goes up here. Put your
          address on the To line; below is{' '}
          {at === 0 ? 'the latest one' : 'an earlier one'}, as it was sent.
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
          {issue && (
            <>
              <div className="sub-mail-field">
                <dt>Subject</dt>
                <dd className="sub-mail-subject">{issue.title}</dd>
              </div>
              <div className="sub-mail-field">
                <dt>Sent</dt>
                <dd>{formatDateFull(issue.date)}</dd>
              </div>
            </>
          )}
        </dl>
        {ready && issue && (
          <article className="sub-mail-body" aria-live="polite">
            <h2 className="sub-mail-title">{issue.title}</h2>
            {issue.description && (
              <p className="sub-mail-dek">{issue.description}</p>
            )}
            <div className="sub-mail-prose">
              {issue.opening.map((text, i) => (
                <p key={i} className={i === 0 ? 'dropcap' : undefined}>
                  {text}
                </p>
              ))}
            </div>
            <p className="sub-mail-more">
              <Link to={issue.href} className="btn">
                Keep reading{issue.minutes ? `, ${issue.minutes} min` : ''}
              </Link>
            </p>
          </article>
        )}
        {ready && issues.length > 1 && (
          <nav className="sub-mail-nav" aria-label="Past emails">
            <button
              type="button"
              className="btn btn--text"
              onClick={() => setAt((n) => n + 1)}
              disabled={at >= issues.length - 1}
            >
              <ArrowLeft size={14} aria-hidden="true" /> Earlier
            </button>
            <span className="sub-mail-count">
              {at + 1} of {facts.count}
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
  );
}

/* ---- C · Contents ---------------------------------------------------- */

function ContentsMockup({ issues, facts, ready }) {
  return (
    <div className="sub-contents">
      <header className="sub-nameplate">
        <p className="sub-nameplate-folio">
          {facts.since ? <span>Est. {facts.sinceYear}</span> : null}
          {facts.count ? <span>No. {facts.count}</span> : null}
          {facts.latest ? <span>{facts.latest}</span> : null}
        </p>
        <h1 className="sub-nameplate-title">dame.is blogging</h1>
        <p className="sub-nameplate-tag">
          Long-form writing about Dame&rsquo;s projects and life
        </p>
      </header>
      <div className="sub-coupon">
        <Scissors
          className="sub-coupon-scissors"
          size={22}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <NewsletterSignup
          id={SUBSCRIBE_ID}
          title="Subscribe by email"
          className="newsletter--coupon"
        />
      </div>
      {ready && (
        <section className="sub-toc" aria-labelledby="sub-toc-head">
          <h2 className="sub-toc-head" id="sub-toc-head">
            <Fleuron /> In past issues
          </h2>
          <ol className="sub-toc-list">
            {issues.map((issue) => (
              <li key={issue.uri} className="sub-toc-item">
                <span className="sub-toc-no">No. {issue.number}</span>
                <div className="sub-toc-body">
                  <Link to={issue.href} className="sub-toc-title">
                    {issue.title}
                  </Link>
                  {(issue.description || issue.opening[0]) && (
                    <p className="sub-toc-dek">
                      {issue.description || issue.opening[0]}
                    </p>
                  )}
                </div>
                <span className="sub-toc-meta">
                  {formatDateShort(issue.date)}
                  {issue.minutes ? <span>{issue.minutes} min</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

/* ---- the essays, as issues ------------------------------------------- */

/** The blog's essays, newest first, numbered from the oldest as issues are. */
function toIssues(data) {
  const blogs = Array.isArray(data) ? data : [];
  const issues = blogs
    // The index's filter (Blogging.jsx mergeBlogEntries): blog-homed docs and
    // cross-posts, never drafts.
    .filter((r) => r?.value && !isDraft(r.value) && showOnBlog(r.value))
    .map(toIssue)
    .sort((a, b) => compareIsoDesc(a.date, b.date));
  return issues.map((issue, i) => ({ ...issue, number: issues.length - i }));
}

function toIssue(record) {
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
 * An essay's first paragraphs of prose, until about `limit` words: what an
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

function blogFacts(issues) {
  const oldest = issues[issues.length - 1]?.date;
  const newest = issues[0]?.date;
  return {
    count: issues.length,
    since: oldest ? monthYear(oldest) : '',
    sinceYear: oldest ? new Date(oldest).getFullYear() : '',
    latest: newest ? formatDateFull(newest) : '',
  };
}

function monthYear(date) {
  return new Date(date).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}
