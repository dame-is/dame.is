// What a SLICE of the network is talking about, over a window of time.
//
// `get_trends` already answers this for the whole network, and the whole
// network is the one slice dame has the least use for. "What is Bluesky talking
// about" is a question about a population she is not in. "What are the people I
// actually follow talking about since yesterday" is a question about hers, and
// nothing in this system could answer it.
//
// So: a slice, a window, and the posts inside both. The model does the reading.
// This module does the fetching, the windowing and the selection, and it is
// deliberately the boring half — every judgement about what a slice MEANS is
// left to the analyst, and every judgement about who anyone IS stays in
// score.js where it can be replayed.
//
// WHY FAN-OUT AND NOT A TIMELINE. `app.bsky.feed.getTimeline` would answer
// "people I follow" in one call, and it answers it AS THE VIEWER — it needs
// dame's session, and the moderator account is not dame. The circle is a couple
// of hundred public follows, so reading their author feeds gets the same answer
// from public data with no credential at all. That is the same reasoning that put
// `followsOf` in precompute.js on the unauthenticated AppView.
//
// WHAT IS NOT HERE, ON PURPOSE. A personalised For You feed. It is a real
// atproto feed generator (`did:web:foryou.club`) and it personalises off the
// requester's DID in a service JWT, so the only way to read DAME's version is
// to hold dame's identity. Unauthenticated `getFeed` against it answers 200
// with a generic feed, which is the dangerous outcome: a plausible answer to a
// question nobody asked. Approximating it and calling it hers would be exactly
// the kind of claim the rest of this system exists to refuse, so there is no
// `foryou` slice until there is an honest way to fetch one.

import { APPVIEW } from '../../config.js';
import { resolveActor } from './target.js';
import { postWebUrl } from './links.js';

export const DEFAULT_WINDOW_HOURS = 24;

/**
 * The longest window that can be asked for.
 *
 * Not a rate-limit number. Past about a week the fan-out stops being a window
 * on a conversation and becomes an archive read: every author needs several
 * pages, the post count runs to five figures, and the selection below is
 * throwing away more than it keeps. A question that genuinely wants a month
 * wants a different tool.
 */
export const MAX_WINDOW_HOURS = 168;

/** How many author feeds to read at once. Matches precompute's fan-out. */
const CONCURRENCY = 8;

/** Later pages, once we know an author is prolific enough to need one. */
const PAGE = 100;

/** Author-feed pages to read before giving up and reporting the author cut. */
const MAX_PAGES_PER_AUTHOR = 4;

/** Pages of a feed or list before the same. Those are one shared stream. */
const MAX_FEED_PAGES = 12;

/**
 * Size the FIRST page to the window rather than always asking for 100.
 *
 * Bandwidth is the real cost on the box this runs on, and an author feed is fat
 * -- about 2.9 KB of JSON per post once embeds, labels and viewer state are in
 * it. MEASURED against the circle on 2026-09-20, over a 24h window:
 *
 *   limit=36  24.0 MB  10.6s  0 accounts needed a second page
 *   limit=25  16.8 MB   9.8s  1 account  needed a second page
 *   limit=15  10.2 MB   8.8s  8 accounts needed a second page
 *
 * The circle averages 3.4 posts per account per day, so a page sized for the
 * average plus headroom is right and a page sized for the busiest account is
 * 14 MB of posts nobody reads. Fifteen, and the eight accounts that post more
 * than that pay for a second request -- about 2.3 MB between them, which still
 * lands the whole refresh at half the cost of never paging at all.
 *
 * The 0.6-per-hour rate is that measured average, rounded up. It is a number
 * about DAME'S CIRCLE, not about Bluesky, and a slice of louder accounts will
 * page more often. That is the failure mode to want: paging is correct and
 * merely costs a request, where a first page too small to notice would just
 * quietly report less.
 */
function firstPageSize(hours) {
  return Math.min(PAGE, Math.max(15, Math.ceil(hours * 0.6)));
}

/**
 * Fetch JSON, distinguishing a failure that will never succeed from one that
 * might. Lifted from precompute.js for the same reason it exists there: a
 * deactivated account answers 400 from getAuthorFeed and always will, and
 * retrying it is how a fan-out spends its budget on the one member who cannot
 * be read.
 */
async function getJson(url, fetchImpl, signal, tries = 3) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetchImpl(url, {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (res.ok) return { body: await res.json(), permanent: false };
      if (![429, 502, 503, 504].includes(res.status)) {
        return { body: null, permanent: true };
      }
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
    }
    await new Promise((r) => setTimeout(r, 500 * (i + 1)));
  }
  return { body: null, permanent: false };
}

const BSKY_FEED =
  /^https?:\/\/[^/]*bsky\.app\/profile\/([^/]+)\/feed\/([^/?#]+)/i;
const BSKY_LIST =
  /^https?:\/\/[^/]*bsky\.app\/profile\/([^/]+)\/lists\/([^/?#]+)/i;
const AT_URI = /^at:\/\/([^/]+)\/([^/]+)\/([^/?#]+)/;

/**
 * Turn whatever dame pasted into a slice this module can fetch.
 *
 * Accepts the word `circle`, an `at://` URI, or a bsky.app link to a feed or a
 * list. The KIND is read off the collection rather than off the URL shape, so
 * an at:// URI pointing at a list is fetched with getListFeed even when it
 * arrived where a feed was expected — the two endpoints take different
 * parameter names and guessing wrong produces an empty result rather than an
 * error, which is the worst way to be wrong here.
 *
 * @returns {Promise<{kind: 'circle'|'feed'|'list', uri?: string}>}
 */
export async function resolveSlice(
  spec,
  { fetchImpl = fetch, signal, appview = APPVIEW } = {},
) {
  const raw = String(spec ?? '').trim();
  if (!raw || /^(circle|follows|following|my circle)$/i.test(raw)) {
    return { kind: 'circle' };
  }

  let did = null;
  let collection = null;
  let rkey = null;

  const at = raw.match(AT_URI);
  if (at) {
    [, did, collection, rkey] = at;
  } else {
    const feed = raw.match(BSKY_FEED);
    const list = raw.match(BSKY_LIST);
    const m = feed || list;
    if (!m) {
      throw new Error(
        `"${raw}" is not a slice I can read. Use "circle", an at:// URI, or a bsky.app feed or list link.`,
      );
    }
    collection = feed ? 'app.bsky.feed.generator' : 'app.bsky.graph.list';
    rkey = m[2];
    did = m[1];
  }

  if (!did.startsWith('did:')) {
    did = await resolveActor(did, { fetchImpl, signal, appview });
  }
  const uri = `at://${did}/${collection}/${rkey}`;

  if (collection === 'app.bsky.feed.generator') return { kind: 'feed', uri };
  if (collection === 'app.bsky.graph.list') return { kind: 'list', uri };
  throw new Error(
    `${collection} is not a feed or a list, so there is no stream of posts to read.`,
  );
}

/** Links a post carries, from its facets and from an external embed. */
function linksIn(record, embed) {
  const out = [];
  for (const facet of record?.facets || []) {
    for (const f of facet?.features || []) {
      if (f?.$type === 'app.bsky.richtext.facet#link' && f.uri) out.push(f.uri);
    }
  }
  const ext = embed?.external?.uri || embed?.media?.external?.uri;
  if (ext) out.push(ext);
  return [...new Set(out)];
}

/** The registrable-ish host of a URL, for counting what a slice is linking to. */
export function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/**
 * One feed item, flattened to the fields a digest actually reads.
 *
 * `reason` is what marks a repost, and it is read here rather than inferred
 * from the author DID: an author feed legitimately contains posts by other
 * people, and telling "they said this" from "they amplified this" is the whole
 * difference between two very different sentences in the answer.
 */
export function normalisePost(item) {
  const post = item?.post;
  const record = post?.record;
  if (!post?.uri || typeof record?.text !== 'string') return null;
  const embed = post.embed || {};
  const type = String(embed.$type || '');
  const reposter = item?.reason?.by;
  return {
    uri: post.uri,
    did: post.author?.did || '',
    handle: post.author?.handle || post.author?.did || '',
    displayName: post.author?.displayName || '',
    text: record.text,
    createdAt: record.createdAt || post.indexedAt || null,
    at: Date.parse(record.createdAt || post.indexedAt || 0) || 0,
    likes: post.likeCount ?? 0,
    reposts: post.repostCount ?? 0,
    replies: post.replyCount ?? 0,
    quotes: post.quoteCount ?? 0,
    isReply: Boolean(record.reply),
    // Whether THIS COPY arrived as a repost, and who by. A post can reach the
    // fan-out several times -- once from its author and once from every member
    // who reposted it -- so these are properties of the copy, and `mergeCopy`
    // below folds them into one post with a list of amplifiers.
    viaRepost: Boolean(reposter),
    repostedBy: reposter?.handle || reposter?.did || null,
    amplifiedBy: reposter?.handle ? [reposter.handle] : [],
    said: !reposter,
    hasImage: type.includes('images') || type.includes('recordWithMedia'),
    hasVideo: type.includes('video'),
    isQuote: type.includes('record'),
    langs: record.langs || [],
    links: linksIn(record, embed),
  };
}

/** Total deliberate engagement. Used for ordering, never for judging anyone. */
export function engagementOf(p) {
  return (p.likes || 0) + (p.reposts || 0) + (p.replies || 0) + (p.quotes || 0);
}

/**
 * Fold a second sighting of the same post into the first.
 *
 * THE FAN-OUT SEES POSTS MORE THAN ONCE, and the first run of this against the
 * real circle made that obvious: one post arrived from two members who had both
 * reposted it and took two of the three sample slots its author was allowed,
 * and the post count read 705 when the circle had written rather fewer than
 * that. Counting a post once per member who touched it measures reposting, not
 * conversation.
 *
 * The duplicate is not noise, though, so it is not simply dropped. How many of
 * the circle amplified something is the single most useful number in a digest
 * of a follow graph -- much more useful than the like count, which is a fact
 * about Bluesky rather than about dame's circle. So the copies collapse into
 * one post carrying the list of who amplified it.
 *
 * `said` wins over amplified on merge: if ANY copy came straight from its
 * author's feed, a member wrote it, whoever else passed it on.
 */
export function mergeCopy(existing, incoming) {
  if (!existing) return incoming;
  existing.said = existing.said || incoming.said;
  for (const who of incoming.amplifiedBy) {
    if (!existing.amplifiedBy.includes(who)) existing.amplifiedBy.push(who);
  }
  existing.viaRepost = existing.viaRepost && incoming.viaRepost;
  return existing;
}

/**
 * How many of the slice amplified a post. The local signal, as against the
 * like count, which is the network's.
 */
export function ampOf(p) {
  return p.amplifiedBy?.length || 0;
}

/**
 * Every post one account made inside the window.
 *
 * Pages only while the page it just read is still inside the window, so a quiet
 * account costs one small request and a loud one costs as many as it earns.
 * `complete: false` means the author was cut by the page cap, which the caller
 * reports rather than swallows: a digest that silently saw half of the busiest
 * account in the circle is a digest that is wrong about what the circle is
 * talking about.
 */
export async function authorWindow(
  did,
  {
    sinceMs,
    hours = DEFAULT_WINDOW_HOURS,
    fetchImpl = fetch,
    signal,
    appview = APPVIEW,
    includeReplies = false,
    deadline = Infinity,
  } = {},
) {
  const filter = includeReplies ? 'posts_with_replies' : 'posts_no_replies';
  const out = [];
  let cursor;
  for (let page = 0; page < MAX_PAGES_PER_AUTHOR; page += 1) {
    if (Date.now() >= deadline) {
      return { posts: out, complete: false, aborted: true, permanent: false };
    }
    const limit = page === 0 ? firstPageSize(hours) : PAGE;
    const url =
      `${appview}/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(did)}` +
      `&limit=${limit}&filter=${filter}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const { body, permanent } = await getJson(url, fetchImpl, signal);
    if (!body) {
      return { posts: out, complete: false, aborted: false, permanent };
    }

    let oldest = Infinity;
    for (const item of body.feed || []) {
      const p = normalisePost(item);
      if (!p) continue;
      oldest = Math.min(oldest, p.at);
      if (p.at >= sinceMs) out.push(p);
    }

    cursor = body.cursor;
    // Out of posts, or already past the far edge of the window. Either way
    // there is nothing older worth asking for.
    if (!cursor || oldest < sinceMs) {
      return { posts: out, complete: true, aborted: false, permanent: false };
    }
  }
  return { posts: out, complete: false, aborted: false, permanent: false };
}

/**
 * The circle's posts inside the window, read one author feed at a time.
 *
 * Unreadable members are counted, not thrown: an account dame follows that has
 * since been deactivated answers 400 forever, and one of those must not take
 * the other 231 down with it. The count goes into `coverage` so the answer can
 * say how much of the circle it actually saw.
 */
export async function circleWindow({
  dids,
  sinceMs,
  hours = DEFAULT_WINDOW_HOURS,
  fetchImpl = fetch,
  signal,
  appview = APPVIEW,
  includeReplies = false,
  concurrency = CONCURRENCY,
  budgetMs = 60_000,
  onProgress,
}) {
  const queue = [...new Set(dids || [])];
  const total = queue.length;
  const byUri = new Map();
  const cut = [];
  let unreadable = 0;
  let read = 0;
  const deadline = Date.now() + budgetMs;
  let stopped = false;

  async function worker() {
    while (!stopped) {
      const did = queue.shift();
      if (!did) return;
      if (Date.now() >= deadline) {
        stopped = true;
        return;
      }
      const r = await authorWindow(did, {
        sinceMs,
        hours,
        fetchImpl,
        signal,
        appview,
        includeReplies,
        deadline,
      });
      if (r.aborted) {
        stopped = true;
        return;
      }
      if (!r.complete && r.posts.length === 0) {
        unreadable += 1;
        continue;
      }
      if (!r.complete) cut.push(did);
      for (const p of r.posts) byUri.set(p.uri, mergeCopy(byUri.get(p.uri), p));
      read += 1;
      onProgress?.({ read, remaining: queue.length });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total || 1) }, worker),
  );

  return {
    posts: [...byUri.values()],
    coverage: {
      accounts: total,
      read,
      unreadable,
      // Ran out of budget with members still queued. Reported because a
      // digest built from 140 of 232 accounts is a different claim from one
      // built from all of them, and only one of them is "what my circle said".
      unread: queue.length,
      truncatedAuthors: cut.length,
    },
  };
}

/**
 * A custom feed or a list, read as one stream until it leaves the window.
 *
 * Unauthenticated on purpose, and that has a consequence worth stating: a feed
 * that personalises off the requester answers this call as NOBODY, not as dame.
 * For a list feed and for a non-personalised generator that is the same stream
 * everyone else sees, which is what makes it honest to report. For a
 * personalised one it is not dame's feed and this module must never present it
 * as though it were — see the note at the top about For You.
 */
export async function feedWindow({
  uri,
  kind = 'feed',
  sinceMs,
  fetchImpl = fetch,
  signal,
  appview = APPVIEW,
  includeReplies = true,
}) {
  const method =
    kind === 'list' ? 'app.bsky.feed.getListFeed' : 'app.bsky.feed.getFeed';
  const param = kind === 'list' ? 'list' : 'feed';
  const posts = [];
  const seen = new Map();
  let cursor;
  let complete = false;

  for (let page = 0; page < MAX_FEED_PAGES; page += 1) {
    const url =
      `${appview}/xrpc/${method}?${param}=${encodeURIComponent(uri)}&limit=${PAGE}` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    const { body } = await getJson(url, fetchImpl, signal);
    if (!body) break;

    let oldest = Infinity;
    for (const item of body.feed || []) {
      const p = normalisePost(item);
      if (!p) continue;
      oldest = Math.min(oldest, p.at);
      if (p.at < sinceMs) continue;
      if (!includeReplies && p.isReply) continue;
      // A feed can serve the same post twice across pages as its ranking
      // shifts underneath the cursor. Counting it twice would overstate how
      // much of the window one post is.
      const first = seen.get(p.uri);
      if (first) {
        mergeCopy(first, p);
        continue;
      }
      seen.set(p.uri, p);
      posts.push(p);
    }

    cursor = body.cursor;
    if (!cursor || oldest < sinceMs) {
      complete = true;
      break;
    }
  }

  return {
    posts,
    coverage: { stream: uri, pagesCapped: !complete, posts: posts.length },
  };
}

/**
 * Counts over the window, computed rather than asked of the model.
 *
 * Everything here is arithmetic on public numbers. It is separate from the post
 * sample below because the model reading eighty posts should not also be the
 * thing that tells dame how many there were -- it would get it approximately
 * right, which is the worst kind of right for a count.
 *
 * SAID AND AMPLIFIED ARE COUNTED APART. A member writing something and a member
 * reposting a stranger are both things the slice did, and they are not the same
 * thing: the first is the circle talking and the second is the circle passing
 * on the network. Summing them produces one number that answers neither
 * question. `topAuthors` counts only what members wrote, because an author
 * ranking built from reposts ranks strangers.
 */
export function summariseWindow(
  posts,
  { topAuthors = 8, topDomains = 8 } = {},
) {
  const byAuthor = new Map();
  const byDomain = new Map();
  let said = 0;
  let amplified = 0;
  let replies = 0;
  let withLinks = 0;
  let withMedia = 0;
  let engagement = 0;

  for (const p of posts) {
    if (p.said) {
      said += 1;
      const key = p.handle || p.did;
      const a = byAuthor.get(key) || { handle: key, posts: 0, engagement: 0 };
      a.posts += 1;
      a.engagement += engagementOf(p);
      byAuthor.set(key, a);
    } else {
      amplified += 1;
    }

    if (p.isReply) replies += 1;
    if (p.links.length) withLinks += 1;
    if (p.hasImage || p.hasVideo) withMedia += 1;
    engagement += engagementOf(p);

    for (const d of new Set(p.links.map(domainOf).filter(Boolean))) {
      byDomain.set(d, (byDomain.get(d) || 0) + 1);
    }
  }

  return {
    posts: posts.length,
    said,
    amplified,
    authors: byAuthor.size,
    replies,
    withLinks,
    withMedia,
    engagement,
    topAuthors: [...byAuthor.values()]
      .sort((a, b) => b.posts - a.posts)
      .slice(0, topAuthors),
    topDomains: [...byDomain.entries()]
      .map(([domain, count]) => ({ domain, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topDomains),
  };
}

/**
 * Which posts the model actually reads.
 *
 * THREE RULES, AND THE FIRST TWO ARE WHAT KEEP THIS FROM BEING TRENDING AGAIN.
 *
 * Said and amplified are selected SEPARATELY. Run against the real circle with
 * one ranking over both, the top of the digest was four reposts of posts with
 * thirteen thousand likes each, by people outside the circle. That is a
 * correct ranking of the wrong thing: a like count is a fact about Bluesky, and
 * ordering a follow-graph digest by it rebuilds the network-wide answer dame
 * already has and calls it her circle.
 *
 * So amplified posts are ranked by HOW MANY OF THE SLICE amplified them, which
 * is the local signal, and only then by engagement. Six members reposting
 * something modest says more about what the circle is doing than one member
 * reposting something huge.
 *
 * Then a per-account cap, because engagement order alone hands the whole sample
 * to the two loudest accounts and produces a confident answer about 228 people
 * built from the output of three. Breadth is the thing being measured.
 */
export function selectPosts(
  posts,
  { limit = 60, perAuthor = 3, sort = 'engagement', focus = '' } = {},
) {
  const needle = String(focus || '')
    .trim()
    .toLowerCase();
  const pool = needle
    ? posts.filter((p) => p.text.toLowerCase().includes(needle))
    : [...posts];

  const byEngagement = (a, b) => engagementOf(b) - engagementOf(a);
  const byRecency = (a, b) => b.at - a.at;
  const byAmplification = (a, b) => ampOf(b) - ampOf(a) || byEngagement(a, b);

  const take = (list, cap) => {
    const taken = new Map();
    const kept = [];
    for (const p of list) {
      const key = p.handle || p.did;
      const n = taken.get(key) || 0;
      if (n >= perAuthor) continue;
      taken.set(key, n + 1);
      kept.push(p);
      if (kept.length >= cap) break;
    }
    return kept;
  };

  const order = sort === 'recent' ? byRecency : byEngagement;
  const saidPool = pool.filter((p) => p.said).sort(order);
  const ampPool = pool
    .filter((p) => !p.said)
    .sort(sort === 'recent' ? byRecency : byAmplification);

  // The circle's own writing gets the larger share, and whichever group is
  // short hands its unused slots to the other rather than leaving the sample
  // smaller than it was asked to be.
  const saidCap = Math.ceil(limit * 0.65);
  const firstPass = take(saidPool, saidCap);
  const amplified = take(ampPool, limit - firstPass.length);
  const spare = limit - firstPass.length - amplified.length;
  const said = spare > 0 ? take(saidPool, firstPass.length + spare) : firstPass;

  const kept = [...said, ...amplified];
  return {
    said,
    amplified,
    kept,
    matched: pool.length,
    omitted: Math.max(0, pool.length - kept.length),
  };
}

/** Relative age, so the model reads "3h ago" rather than doing date maths. */
function ago(at, now) {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/**
 * What a post IS when it has no words.
 *
 * An image post, a video, a bare quote -- `record.text` is an empty string and
 * the post is still a post. The first live run rendered two of those as blank
 * lines inside the sample, which tells the model nothing and invites it to
 * describe a post it cannot see. Naming the shape is honest and is the most
 * that can be said: nothing here reads images.
 */
function describeEmpty(p) {
  if (p.hasVideo) return '(video, no text)';
  if (p.hasImage) return '(image, no text)';
  if (p.isQuote) return '(quote post, no text of its own)';
  return '(no text)';
}

/**
 * One post as a header line plus its text, with a MARKER the answer can cite.
 *
 * The marker is how a digest points at a specific post without spending its
 * reply budget on a 60-character permalink per item. The model writes `[7]`,
 * and the caller swaps that for the real link -- so the model chooses WHICH
 * post it is talking about and code decides what a marker resolves to. A
 * number that indexes a list the tool returned cannot name a post the digest
 * never saw, which is the property that lets the link be rendered tappable at
 * the other end.
 */
function renderOne(p, now, chars, n) {
  const amp = ampOf(p);
  const head =
    `[${n}] @${p.handle} · ${ago(p.at, now)} · ` +
    `${p.likes}L ${p.reposts}R ${p.replies}C` +
    (amp
      ? ` · amplified by ${amp} of the slice (${p.amplifiedBy
          .slice(0, 4)
          .map((h) => `@${h}`)
          .join(', ')}${amp > 4 ? ', …' : ''})`
      : '') +
    (p.isReply ? ' · reply' : '');
  const trimmed = p.text.trim();
  const body = !trimmed
    ? describeEmpty(p)
    : trimmed.length > chars
      ? `${trimmed.slice(0, chars - 1)}…`
      : trimmed;
  const tail = p.links.length
    ? `\n  links: ${[...new Set(p.links.map(domainOf).filter(Boolean))].join(', ')}`
    : '';
  return `${head}\n  ${body.replace(/\n+/g, ' ')}${tail}`;
}

/**
 * The post sample as one block of text.
 *
 * Returned as a plain string and fenced by the CALLER, because the fence is the
 * analyst's concept and lives in agent.js -- the same split mcp.js uses. Every
 * character of this is written by other people.
 *
 * The two groups are LABELLED rather than interleaved. A model handed one list
 * cannot tell "someone dame follows wrote this" from "someone dame follows
 * passed this on", and those become the same sentence in the reply, which is
 * the specific way a digest of a follow graph turns into a digest of Bluesky.
 *
 * Text is trimmed rather than summarised. A digest tool that pre-summarised
 * each post would be making the editorial call the model is there to make, one
 * post at a time, with no context about the other seventy-nine.
 */
export function renderPosts(
  selection,
  { now = Date.now(), chars = 320, totals = null } = {},
) {
  // Also accepts a plain array, which is what a single-group slice produces.
  const { said, amplified } = Array.isArray(selection)
    ? { said: selection, amplified: [] }
    : selection;

  // Numbered CONTINUOUSLY across both groups, in the same order as `kept`, so
  // marker n is sample[n - 1] with no per-section arithmetic to get wrong.
  let n = 0;
  const section = (title, list, total) => {
    if (!list.length) return '';
    const of = total != null && total > list.length ? ` of ${total}` : '';
    return (
      `${title} (${list.length}${of})\n\n` +
      list
        .map((p) => {
          n += 1;
          return renderOne(p, now, chars, n);
        })
        .join('\n\n')
    );
  };

  return [
    section('WRITTEN BY THE SLICE', said, totals?.said),
    section('AMPLIFIED BY THE SLICE', amplified, totals?.amplified),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/**
 * A tiny TTL cache over the FETCH, not over the answer.
 *
 * Keyed on the slice and the window only, so changing `focus`, `sort` or
 * `limit` re-selects from posts already in hand instead of re-reading 232
 * author feeds. That is the common shape of a follow-up — "what about the AI
 * ones", "show me more" — and it is the difference between a second question
 * costing nothing and costing another fan-out.
 *
 * Bounded at four entries because this runs in a long-lived process on a box
 * with a gigabyte of RAM, next to a 73k-row vouch snapshot.
 */
const CACHE = new Map();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 4;

export function clearPulseCache() {
  CACHE.clear();
}

function cacheGet(key, now) {
  const hit = CACHE.get(key);
  if (!hit || now - hit.at > CACHE_TTL_MS) return null;
  return hit;
}

function cacheSet(key, value, now) {
  CACHE.set(key, { at: now, ...value });
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
}

/**
 * One digest: resolve the slice, read the window, count it, sample it.
 *
 * @param {object} opts
 * @param {string}   [opts.source]          `circle`, an at:// URI, or a bsky.app feed/list link
 * @param {number}   [opts.hours]           window, clamped to MAX_WINDOW_HOURS
 * @param {string[]} [opts.circleDids]      required when the slice is the circle
 * @param {string}   [opts.focus]           only posts containing this text
 * @param {'engagement'|'recent'} [opts.sort]
 */
export async function pulse({
  source = 'circle',
  hours = DEFAULT_WINDOW_HOURS,
  circleDids = [],
  focus = '',
  sort = 'engagement',
  limit = 60,
  perAuthor = 3,
  includeReplies = false,
  fetchImpl = fetch,
  signal,
  appview = APPVIEW,
  budgetMs = 60_000,
  now = Date.now(),
  useCache = true,
} = {}) {
  const window = Math.min(
    MAX_WINDOW_HOURS,
    Math.max(1, Number(hours) || DEFAULT_WINDOW_HOURS),
  );
  const sinceMs = now - window * 3_600_000;

  const slice = await resolveSlice(source, { fetchImpl, signal, appview });
  if (slice.kind === 'circle' && !circleDids.length) {
    throw new Error(
      'the circle is empty in this snapshot, so there is nobody to read. Run /api/mod-precompute.',
    );
  }

  const key = JSON.stringify([
    slice.kind,
    slice.uri || 'circle',
    window,
    includeReplies,
  ]);
  let fetched = useCache ? cacheGet(key, now) : null;
  const cached = Boolean(fetched);

  if (!fetched) {
    fetched =
      slice.kind === 'circle'
        ? await circleWindow({
            dids: circleDids,
            sinceMs,
            hours: window,
            fetchImpl,
            signal,
            appview,
            includeReplies,
            budgetMs,
          })
        : await feedWindow({
            uri: slice.uri,
            kind: slice.kind,
            sinceMs,
            fetchImpl,
            signal,
            appview,
            includeReplies,
          });
    if (useCache) cacheSet(key, fetched, now);
  }

  const totals = summariseWindow(fetched.posts);
  const selection = selectPosts(fetched.posts, {
    limit,
    perAuthor,
    sort,
    focus,
  });

  return {
    slice: {
      kind: slice.kind,
      uri: slice.uri || null,
      label:
        slice.kind === 'circle'
          ? `the ${circleDids.length} accounts dame follows`
          : `${slice.kind} ${slice.uri}`,
    },
    window: {
      hours: window,
      since: new Date(sinceMs).toISOString(),
      until: new Date(now).toISOString(),
    },
    coverage: {
      ...fetched.coverage,
      cached,
      cachedAgeMs: cached ? now - fetched.at : 0,
    },
    totals,
    focus: focus || null,
    sort,
    matched: selection.matched,
    shown: selection.kept.length,
    said: selection.said.length,
    amplified: selection.amplified.length,
    omitted: selection.omitted,
    posts: selection.kept,
    // The marker table. Index n - 1 is what `[n]` in the answer refers to, in
    // the same order the rendered block numbers them. `url` is built here from
    // the at:// URI rather than taken from anything anyone wrote, which is what
    // makes it safe to render as a tappable link later.
    // The marker table. Index n - 1 is what `[n]` in the answer refers to, in
    // the same order the rendered block numbers them.
    //
    // DELIBERATELY JUST THE LINK. Everything else about these posts is already
    // in front of the model inside the fence, and a second unfenced copy of a
    // handle would be the first place in this codebase where one is handed over
    // as bare JSON. The URL is built here from the at:// URI and a
    // shape-checked handle, so it carries who wrote it without carrying
    // anything anyone wrote.
    sample: selection.kept.map((p, i) => ({
      n: i + 1,
      url: postWebUrl(p.uri, { handle: p.handle }),
    })),
    rendered: renderPosts(selection, { now, totals }),
  };
}
