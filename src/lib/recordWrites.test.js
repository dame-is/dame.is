import { describe, it, expect, vi } from 'vitest';
import { jsonStringToLex } from '@atproto/api';
import {
  blobCid,
  getRecordIfExists,
  isRecordMissing,
  isSwapConflict,
} from './recordWrites.js';

const LINK = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';

describe('isSwapConflict', () => {
  it('reads the XRPC error code, wherever the client put it', () => {
    expect(isSwapConflict({ error: 'InvalidSwap' })).toBe(true);
    expect(isSwapConflict({ data: { error: 'InvalidSwap' } })).toBe(true);
    expect(isSwapConflict({ name: 'InvalidSwapError' })).toBe(true);
  });

  it("falls back to the PDS's own sentence", () => {
    expect(isSwapConflict(new Error(`Record was at ${LINK}`))).toBe(true);
    expect(isSwapConflict(new Error('Record was at null'))).toBe(true);
  });

  it('is not fooled by other write failures', () => {
    expect(
      isSwapConflict({
        error: 'InvalidRequest',
        message: 'Record/text must be a string',
      }),
    ).toBe(false);
    expect(isSwapConflict(new Error('Failed to fetch'))).toBe(false);
    expect(isSwapConflict(null)).toBe(false);
  });
});

describe('isRecordMissing', () => {
  it('matches every shape a missing record arrives in', () => {
    expect(isRecordMissing({ error: 'RecordNotFound' })).toBe(true);
    expect(isRecordMissing({ status: 404 })).toBe(true);
    expect(
      isRecordMissing(
        new Error('Could not locate record: at://did:plc:x/a.b/c'),
      ),
    ).toBe(true);
  });

  it('leaves real failures alone', () => {
    expect(isRecordMissing({ error: 'AuthRequired', status: 401 })).toBe(false);
    expect(isRecordMissing(new Error('Failed to fetch'))).toBe(false);
  });
});

describe('getRecordIfExists', () => {
  const params = { repo: 'did:plc:x', collection: 'is.dame.nav', rkey: 'self' };
  const agentFor = (getRecord) => ({
    com: { atproto: { repo: { getRecord } } },
  });

  it('hands back what the PDS read', async () => {
    const res = { data: { uri: 'at://did:plc:x/is.dame.nav/self', value: {} } };
    const getRecord = vi.fn().mockResolvedValue(res);
    await expect(getRecordIfExists(agentFor(getRecord), params)).resolves.toBe(
      res,
    );
    expect(getRecord).toHaveBeenCalledWith(params);
  });

  it('answers null only when the PDS says the record is not there', async () => {
    const missing = Object.assign(new Error('Could not locate record'), {
      error: 'RecordNotFound',
      status: 400,
    });
    const agent = agentFor(vi.fn().mockRejectedValue(missing));
    await expect(getRecordIfExists(agent, params)).resolves.toBe(null);
  });

  it('rethrows a failure that says nothing about the record', async () => {
    // Each of these used to open the editor on its defaults, one Save away
    // from writing them over the real record.
    for (const err of [
      new TypeError('Failed to fetch'),
      Object.assign(new Error('Token has expired'), {
        error: 'ExpiredToken',
        status: 400,
      }),
      Object.assign(new Error('Internal Server Error'), { status: 500 }),
    ]) {
      const agent = agentFor(vi.fn().mockRejectedValue(err));
      await expect(getRecordIfExists(agent, params)).rejects.toBe(err);
    }
  });
});

describe('blobCid', () => {
  it('reads the plain wire form a saved record carries', () => {
    expect(
      blobCid({
        $type: 'blob',
        ref: { $link: LINK },
        mimeType: 'image/jpeg',
        size: 1,
      }),
    ).toBe(LINK);
  });

  it('reads a live BlobRef, the shape uploadBlob actually returns', () => {
    // Parsed exactly the way the XRPC client parses an uploadBlob response.
    const { blob } = jsonStringToLex(
      JSON.stringify({
        blob: {
          $type: 'blob',
          ref: { $link: LINK },
          mimeType: 'image/jpeg',
          size: 1,
        },
      }),
    );
    expect(blob.ref.$link).toBeUndefined();
    expect(blobCid(blob)).toBe(LINK);
    // The two forms of one blob agree, which is what lets a preview cached
    // under the upload's CID survive the save that turns it into plain JSON.
    expect(blobCid(JSON.parse(JSON.stringify(blob)))).toBe(LINK);
  });

  it('reads the legacy untyped form, and nothing else', () => {
    expect(blobCid({ cid: LINK, mimeType: 'image/png' })).toBe(LINK);
    expect(blobCid({ ref: {} })).toBe(null);
    expect(blobCid(undefined)).toBe(null);
  });
});
