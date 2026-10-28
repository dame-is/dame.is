import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME_DID, COLLECTIONS } from '../config.js';

const getRecord = vi.fn();
vi.mock('./atproto.js', async (importOriginal) => ({
  ...(await importOriginal()),
  getRecord: (...a) => getRecord(...a),
}));

const { isWorkAt, rereadWork } = await import('./workRecord.js');

const STD = 'site.standard.document';
const uri = (collection, rkey, did = ME_DID) =>
  `at://${did}/${collection}/${rkey}`;
const doc = (rkey, value) => ({ uri: uri(STD, rkey), cid: 'bafy', value });

beforeEach(() => {
  getRecord.mockReset();
});

describe('isWorkAt', () => {
  const portfolio = { path: '/red-blue-yellow', tags: ['creating'] };

  it('answers to its path or its rkey', () => {
    const r = doc('3abc', portfolio);
    expect(isWorkAt(r, 'red-blue-yellow')).toBe(true);
    expect(isWorkAt(r, '3abc')).toBe(true);
    expect(isWorkAt(r, 'something-else')).toBe(false);
  });

  it('never answers as a draft', () => {
    expect(
      isWorkAt(doc('3abc', { ...portfolio, draft: true }), 'red-blue-yellow'),
    ).toBe(false);
  });
});

describe('rereadWork', () => {
  const pds = 'https://pds.example';

  it('re-reads the one record the snapshot named, by its own rkey', async () => {
    const value = {
      path: '/how-i-made-it',
      tags: ['creating'],
      publishedAt: '2026-01-02T00:00:00Z',
    };
    getRecord.mockResolvedValue(doc('how-i-made-it', { ...value }));
    const rec = await rereadWork(
      pds,
      doc('how-i-made-it', value),
      'how-i-made-it',
    );
    expect(getRecord).toHaveBeenCalledWith(pds, {
      repo: ME_DID,
      collection: STD,
      rkey: 'how-i-made-it',
    });
    // Timestamps filled in the way the snapshot's are.
    expect(rec.value.createdAt).toBe('2026-01-02T00:00:00Z');
  });

  it('gives up when the live copy no longer answers to the slug', async () => {
    getRecord.mockResolvedValue(
      doc('3abc', { path: '/renamed', tags: ['creating'] }),
    );
    expect(
      await rereadWork(pds, doc('3abc', { path: '/old' }), 'old'),
    ).toBeNull();
  });

  it('gives up, without rejecting, when the record is gone', async () => {
    getRecord.mockRejectedValue(
      Object.assign(new Error('RecordNotFound'), { status: 400 }),
    );
    expect(
      await rereadWork(pds, doc('3abc', { path: '/old' }), 'old'),
    ).toBeNull();
  });

  it('reads nothing for a record that is not the owner’s work', async () => {
    expect(
      await rereadWork(pds, { uri: uri(STD, '3abc', 'did:plc:other') }, '3abc'),
    ).toBeNull();
    expect(
      await rereadWork(pds, { uri: uri(COLLECTIONS.now, '3abc') }, '3abc'),
    ).toBeNull();
    expect(await rereadWork(pds, null, '3abc')).toBeNull();
    expect(getRecord).not.toHaveBeenCalled();
  });
});
