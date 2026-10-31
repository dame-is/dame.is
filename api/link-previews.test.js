// The live previews endpoint fetches pages on a server, so what matters is
// what it refuses: documents that aren't the owner's, collections that don't
// render as documents, and versions that aren't the record's current one. The
// PDS and the lookups themselves are stood in for.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME_DID } from '../src/config.js';

const getRecord = vi.fn();
const resolveLinks = vi.fn();

vi.mock('../src/lib/atproto.js', () => ({
  resolvePds: async () => 'https://pds.example',
  getRecord: (...args) => getRecord(...args),
}));
vi.mock('./_lib/linkPreviews.js', () => ({
  liveMedia: () => ({ small: true }),
  resolveLinks: (...args) => resolveLinks(...args),
}));

const { default: handler, parseDocumentUri } = await import('./link-previews.js');

function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

const DOC = `at://${ME_DID}/site.standard.document/3mz4bbmjphc2l`;
const CID = 'bafyreidvexample';
const call = async (query) => {
  const res = mockRes();
  await handler({ query, headers: {} }, res);
  return res;
};

const record = {
  uri: DOC,
  cid: CID,
  value: {
    content: {
      pages: [
        {
          blocks: [
            {
              block: {
                facets: [{ features: [{ $type: 'pub.leaflet.richtext.facet#link', uri: 'https://attie.ai' }] }],
              },
            },
          ],
        },
      ],
    },
  },
};

beforeEach(() => {
  getRecord.mockReset();
  resolveLinks.mockReset();
});

describe('parseDocumentUri', () => {
  it('takes only the owner’s documents, in the collections that render as documents', () => {
    expect(parseDocumentUri(DOC)).toEqual({ collection: 'site.standard.document', rkey: '3mz4bbmjphc2l' });
    expect(parseDocumentUri(`at://${ME_DID}/is.dame.profile/self`)).toEqual({ collection: 'is.dame.profile', rkey: 'self' });
    expect(parseDocumentUri('at://did:plc:someoneelse/site.standard.document/3mz4bbmjphc2l')).toBeNull();
    expect(parseDocumentUri(`at://${ME_DID}/app.bsky.feed.post/3mz4bbmjphc2l`)).toBeNull();
    expect(parseDocumentUri('https://dame.is/blogging/3mz4bbmjphc2l')).toBeNull();
  });
});

describe('GET /api/link-previews', () => {
  it('refuses a document that isn’t one of the site’s, or no version', async () => {
    expect((await call({ uri: 'at://did:plc:x/site.standard.document/a', cid: CID })).statusCode).toBe(400);
    expect((await call({ uri: DOC })).statusCode).toBe(400);
    expect(getRecord).not.toHaveBeenCalled();
  });

  it('looks nothing up for a version that isn’t the current one', async () => {
    getRecord.mockResolvedValue({ ...record, cid: 'bafyreinewer' });
    const res = await call({ uri: DOC, cid: CID });
    expect(res.statusCode).toBe(409);
    expect(res.body.cid).toBe('bafyreinewer');
    expect(resolveLinks).not.toHaveBeenCalled();
  });

  it('answers 404 for a document that isn’t there', async () => {
    getRecord.mockRejectedValue(Object.assign(new Error('RecordNotFound'), { status: 400 }));
    const res = await call({ uri: DOC, cid: CID });
    expect(res.statusCode).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('looks up the record’s own links, and lets the CDN keep a whole answer for a week', async () => {
    getRecord.mockResolvedValue(record);
    resolveLinks.mockResolvedValue({ previews: { 'https://attie.ai': { kind: 'website' } }, icons: {}, failed: [] });
    const res = await call({ uri: DOC, cid: CID });
    expect(res.statusCode).toBe(200);
    expect(resolveLinks.mock.calls[0][0]).toEqual(['https://attie.ai']);
    expect(res.body).toMatchObject({ uri: DOC, cid: CID, live: true, failed: [] });
    expect(res.headers['cache-control']).toContain('s-maxage=604800');
  });

  it('keeps an answer with gaps only briefly', async () => {
    getRecord.mockResolvedValue(record);
    resolveLinks.mockResolvedValue({ previews: {}, icons: {}, failed: ['https://attie.ai'] });
    const res = await call({ uri: DOC, cid: CID });
    expect(res.headers['cache-control']).toBe('public, max-age=60, s-maxage=600');
  });
});
