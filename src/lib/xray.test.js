import { describe, it, expect } from 'vitest';
import {
  blobFacts,
  censusLine,
  formatBytes,
  indexSpans,
  recordCensus,
  subjectOfRecord,
  xrayNotARecord,
  xrayRecordAttrs,
} from './xray.js';

const ME = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const POE = 'did:plc:poe';

describe('xrayRecordAttrs', () => {
  it('marks an inline record with its collection', () => {
    expect(xrayRecordAttrs(`at://${ME}/is.dame.now/3mz`)).toEqual({
      'data-atproto': '',
      'data-at-uri': `at://${ME}/is.dame.now/3mz`,
      'data-xray-nsid': 'is.dame.now',
    });
  });

  it('adds nothing without a record', () => {
    expect(xrayRecordAttrs(null)).toEqual({});
    expect(xrayRecordAttrs('https://example.com')).toEqual({});
  });

  it('says when a signal is not a record', () => {
    expect(xrayNotARecord('computed')).toEqual({ 'data-xray-note': 'not a record · computed' });
  });
});

describe('subjectOfRecord', () => {
  it("reads a repost's subject, with its own CID and handle", () => {
    const value = {
      author: { did: POE, handle: 'poe.atpota.to' },
      subjectUri: `at://${POE}/app.bsky.feed.post/3myrvxkhmbsic`,
      subjectCid: 'bafyreid4tja',
    };
    expect(subjectOfRecord(value)).toEqual({
      uri: `at://${POE}/app.bsky.feed.post/3myrvxkhmbsic`,
      cid: 'bafyreid4tja',
      handle: 'poe.atpota.to',
    });
  });

  it('reads a strong ref', () => {
    const value = { subject: { uri: `at://${POE}/app.bsky.feed.post/3my`, cid: 'bafy' } };
    expect(subjectOfRecord(value)).toEqual({ uri: `at://${POE}/app.bsky.feed.post/3my`, cid: 'bafy', handle: null });
  });

  it('ignores a follow, whose subject is an account', () => {
    expect(subjectOfRecord({ subject: POE })).toBe(null);
    expect(subjectOfRecord({ text: 'a post' })).toBe(null);
  });
});

describe('recordCensus', () => {
  const uris = [
    `at://${ME}/app.bsky.feed.post/a`,
    `at://${ME}/app.bsky.feed.post/b`,
    `at://${ME}/app.bsky.feed.post/a`,
    `at://${ME}/app.bsky.feed.repost/c`,
    `at://${ME}/is.dame.now/d`,
    'not a uri',
  ];

  it('counts each record once, by collection, most first', () => {
    expect(recordCensus(uris)).toEqual({
      total: 4,
      collections: [
        { nsid: 'app.bsky.feed.post', did: ME, count: 2 },
        { nsid: 'app.bsky.feed.repost', did: ME, count: 1 },
        { nsid: 'is.dame.now', did: ME, count: 1 },
      ],
    });
  });

  it('writes the HUD line', () => {
    expect(censusLine(recordCensus(uris))).toBe('4 records in 3 collections');
    expect(censusLine(recordCensus([`at://${ME}/is.dame.now/d`]))).toBe('1 record in is.dame.now');
    expect(censusLine(recordCensus([]))).toBe('no records on this page');
  });
});

describe('blobFacts', () => {
  const CID = 'bafkreien7pxyxqwfyahmep2v3ae5k6733km3yvd76uhpvwadrbbdaik7pm';

  it("reads the record's blob ref", () => {
    const blob = { $type: 'blob', ref: { $link: CID }, mimeType: 'image/jpeg', size: 1768328 };
    expect(blobFacts(blob)).toEqual({ cid: CID, mimeType: 'image/jpeg', size: 1768328 });
  });

  it('falls back to the CID in a CDN URL, with the rest unknown', () => {
    const expected = { cid: CID, mimeType: null, size: null };
    expect(blobFacts(null, `https://cdn.bsky.app/img/feed_fullsize/plain/${ME}/${CID}`)).toEqual(expected);
    expect(blobFacts(null, `https://cdn.bsky.app/img/feed_thumbnail/plain/${ME}/${CID}@jpeg`)).toEqual(expected);
    expect(blobFacts(undefined, `https://video.bsky.app/watch/${ME}/${CID}/thumbnail.jpg`)).toEqual(expected);
  });

  it('reads the legacy blob shape', () => {
    expect(blobFacts({ cid: CID, mimeType: 'image/png' })).toEqual({ cid: CID, mimeType: 'image/png', size: null });
  });

  it('is null with no blob to name', () => {
    expect(blobFacts(null, null)).toBe(null);
    expect(blobFacts({}, 'https://example.com/picture.jpg')).toBe(null);
  });
});

describe('formatBytes', () => {
  it('prints a size in decimal units', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(48213)).toBe('48 kB');
    expect(formatBytes(1768328)).toBe('1.8 MB');
  });

  it('prints nothing for a size it was not given', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(-1)).toBe('');
  });
});

describe('indexSpans', () => {
  it('runs consecutive indices together', () => {
    expect(indexSpans([7, 8, 9, 12])).toBe('7–9, 12');
    expect(indexSpans([3])).toBe('3');
    expect(indexSpans([0, 1])).toBe('0–1');
  });

  it('sorts and drops repeats', () => {
    expect(indexSpans([12, 8, 7, 9, 8])).toBe('7–9, 12');
    expect(indexSpans([])).toBe('');
  });
});
