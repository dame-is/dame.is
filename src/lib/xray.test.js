import { describe, it, expect } from 'vitest';
import {
  censusLine,
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
