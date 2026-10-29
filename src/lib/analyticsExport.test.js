// The export is the one place archive rows leave the browser, so these pin
// what a downloaded file promises: every store present and counted, the text
// cap named rather than hidden, and a CSV that survives commas, quotes and
// line breaks in the owner's own posts.

import { describe, it, expect } from 'vitest';
import { POST_TEXT_LIMIT } from './analytics.js';
import { EXPORT_FORMAT, EXPORT_VERSION, archiveJson, exportFilename, postsCsv } from './analyticsExport.js';

const DID = 'did:plc:owner';
const OTHER = 'did:plc:someone';

const post = (over = {}) => ({
  uri: `at://${DID}/app.bsky.feed.post/${over.rkey || '3abc'}`,
  rkey: '3abc',
  at: '2026-06-10T12:00:00.000Z',
  text: 'hello',
  replyTo: null,
  quoteOf: null,
  hasMedia: false,
  likes: 0,
  reposts: 0,
  replies: 0,
  quotes: 0,
  ...over,
});

/** Split a CSV into rows of cells, honouring quotes. Enough for these tests. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
    } else cell += c;
  }
  return rows;
}

describe('archiveJson', () => {
  const archive = {
    posts: [post()],
    followers: [{ did: OTHER, followedAt: '2026-01-01T00:00:00Z' }],
    blocks: [],
    inbound: [{ uri: 'at://x/app.bsky.feed.like/1', did: OTHER, kind: 'like', at: '2026-06-11T00:00:00Z' }],
    outbound: [],
    atmosphere: [{ uri: 'at://x/c/1', collection: 'c', at: '2026-06-01T00:00:00Z' }],
    meta: { posts: { syncedAt: 1, complete: true } },
    // Studio state the file has no use for must not leak in.
    loaded: true,
    rev: 7,
  };

  it('carries every store, counted, with the meta and a stamp', () => {
    const now = Date.UTC(2026, 9, 29, 12);
    const doc = JSON.parse(
      archiveJson(archive, { did: DID, handle: 'dame.is', actors: new Map([[OTHER, { did: OTHER, handle: 'x.test' }]]), now }),
    );
    expect(doc.format).toBe(EXPORT_FORMAT);
    expect(doc.version).toBe(EXPORT_VERSION);
    expect(doc.exportedAt).toBe('2026-10-29T12:00:00.000Z');
    expect(doc.did).toBe(DID);
    expect(doc.counts).toEqual({ posts: 1, followers: 1, blocks: 0, inbound: 1, outbound: 0, atmosphere: 1, actors: 1 });
    expect(doc.posts).toEqual(archive.posts);
    expect(doc.atmosphere).toEqual(archive.atmosphere);
    expect(doc.actors).toEqual([{ did: OTHER, handle: 'x.test' }]);
    expect(doc.meta).toEqual(archive.meta);
    expect(doc.loaded).toBeUndefined();
    expect(doc.rev).toBeUndefined();
  });

  it('names the text cap instead of passing snippets off as whole posts', () => {
    const doc = JSON.parse(archiveJson(archive));
    expect(doc.notes.posts).toContain(`first ${POST_TEXT_LIMIT} characters`);
    for (const key of ['posts', 'followers', 'blocks', 'inbound', 'outbound', 'atmosphere', 'actors']) {
      expect(typeof doc.notes[key]).toBe('string');
    }
  });

  it('degrades to empty stores rather than throwing on a bare archive', () => {
    const doc = JSON.parse(archiveJson({}, { actors: null }));
    expect(doc.posts).toEqual([]);
    expect(doc.actors).toEqual([]);
    expect(doc.counts.atmosphere).toBe(0);
  });
});

describe('postsCsv', () => {
  it('starts with a BOM and a header row', () => {
    const csv = postsCsv([]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const [header] = parseCsv(csv.slice(1));
    expect(header).toEqual([
      'created_at',
      'kind',
      'text',
      'likes',
      'reposts',
      'replies',
      'quotes',
      'engagement',
      'has_media',
      'reply_to',
      'quote_of',
      'url',
      'uri',
    ]);
  });

  it('round-trips commas, quotes and line breaks in post text', () => {
    const text = 'one, "two"\nthree\r\nfour';
    const [, row] = parseCsv(postsCsv([post({ text })]).slice(1));
    expect(row[2]).toBe(text);
  });

  it('sorts newest first and sinks undated rows', () => {
    const rows = parseCsv(
      postsCsv([
        post({ rkey: 'old', at: '2026-01-01T00:00:00Z' }),
        post({ rkey: 'none', at: 'not a date' }),
        post({ rkey: 'new', at: '2026-09-01T00:00:00Z' }),
      ]).slice(1),
    );
    expect(rows.slice(1).map((r) => r[0])).toEqual(['2026-09-01T00:00:00Z', '2026-01-01T00:00:00Z', 'not a date']);
  });

  it('tells posts, replies to others and own-thread continuations apart', () => {
    const rows = parseCsv(
      postsCsv(
        [
          post({ rkey: 'a', at: '2026-06-03T00:00:00Z' }),
          post({ rkey: 'b', at: '2026-06-02T00:00:00Z', replyTo: OTHER }),
          post({ rkey: 'c', at: '2026-06-01T00:00:00Z', replyTo: DID }),
        ],
        { did: DID },
      ).slice(1),
    );
    expect(rows.slice(1).map((r) => r[1])).toEqual(['post', 'reply', 'thread']);
  });

  it('totals engagement and links each post by DID', () => {
    const [, row] = parseCsv(
      postsCsv([post({ rkey: '3xyz', likes: 10, reposts: 2, replies: 3, quotes: 1, hasMedia: true })], {
        did: DID,
        handle: 'dame.is',
      }).slice(1),
    );
    expect(row.slice(3, 9)).toEqual(['10', '2', '3', '1', '16', 'true']);
    expect(row[11]).toBe(`https://bsky.app/profile/${DID}/post/3xyz`);
  });

  it('leaves the link empty when there is no one to link to', () => {
    const [, row] = parseCsv(postsCsv([post()]).slice(1));
    expect(row[11]).toBe('');
  });
});

describe('exportFilename', () => {
  it('names the file by handle, contents and local day', () => {
    const now = new Date(2026, 9, 3, 23, 30).getTime();
    expect(exportFilename('dame.is', 'posts', 'csv', now)).toBe('dame.is-posts-2026-10-03.csv');
    expect(exportFilename(null, 'analytics', 'json', now)).toBe('archive-analytics-2026-10-03.json');
  });
});
