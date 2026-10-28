import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  detectCoarseRegion,
  isXrpcRecordNotFound,
  setEntryHidden,
} from './guestbook.js';
import { GUESTBOOK_NSID } from '../config.js';

const OWNER = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
const ENTRY = 'at://did:plc:someone/is.dame.guestbook.entry/3abc';

/** An XRPC error the way @atproto/api throws one. */
function xrpcError(status, error, message) {
  return Object.assign(new Error(message), { status, error });
}

function fakeAgent({ getRecord }) {
  const putRecord = vi.fn().mockResolvedValue({ data: {} });
  return {
    assertDid: OWNER,
    com: { atproto: { repo: { getRecord: vi.fn(getRecord), putRecord } } },
    putRecord,
  };
}

describe('isXrpcRecordNotFound', () => {
  it('recognises the PDS’s answer for a missing record', () => {
    expect(
      isXrpcRecordNotFound(
        xrpcError(400, 'RecordNotFound', 'Could not locate record'),
      ),
    ).toBe(true);
    expect(
      isXrpcRecordNotFound(new Error('Could not locate record: at://…')),
    ).toBe(true);
  });

  it('does not mistake other failures for absence', () => {
    expect(isXrpcRecordNotFound(new TypeError('Failed to fetch'))).toBe(false);
    expect(
      isXrpcRecordNotFound(xrpcError(500, 'InternalServerError', 'boom')),
    ).toBe(false);
    expect(
      isXrpcRecordNotFound(xrpcError(401, 'ExpiredToken', 'Token has expired')),
    ).toBe(false);
    expect(isXrpcRecordNotFound(xrpcError(400, 'InvalidRequest', 'bad'))).toBe(
      false,
    );
  });
});

describe('setEntryHidden', () => {
  it('adds to the existing book’s hidden list under a CID swap', async () => {
    const agent = fakeAgent({
      getRecord: async () => ({
        data: {
          cid: 'bafybook',
          value: {
            $type: GUESTBOOK_NSID,
            title: 'my book',
            hidden: ['at://old'],
          },
        },
      }),
    });
    await setEntryHidden(agent, ENTRY, true);
    const call = agent.putRecord.mock.calls[0][0];
    expect(call.swapRecord).toBe('bafybook');
    expect(call.record.title).toBe('my book');
    expect(call.record.hidden).toEqual(['at://old', ENTRY]);
  });

  it('creates the book only when the PDS says there is none, and only if still absent', async () => {
    const agent = fakeAgent({
      getRecord: async () => {
        throw xrpcError(400, 'RecordNotFound', 'Could not locate record');
      },
    });
    await setEntryHidden(agent, ENTRY, true);
    const call = agent.putRecord.mock.calls[0][0];
    expect(call.swapRecord).toBeNull();
    expect(call.record).toMatchObject({
      $type: GUESTBOOK_NSID,
      title: 'guestbook',
      hidden: [ENTRY],
    });
  });

  it('refuses to write over the book when the read failed for any other reason', async () => {
    for (const err of [
      new TypeError('Failed to fetch'),
      xrpcError(502, 'UpstreamFailure', 'bad gateway'),
      xrpcError(401, 'ExpiredToken', 'Token has expired'),
    ]) {
      const agent = fakeAgent({
        getRecord: async () => {
          throw err;
        },
      });
      await expect(setEntryHidden(agent, ENTRY, true)).rejects.toBe(err);
      expect(agent.putRecord).not.toHaveBeenCalled();
    }
  });
});

describe('detectCoarseRegion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubLocation({ permission, error }) {
    const getCurrentPosition = vi.fn((_ok, fail) => fail(error));
    vi.stubGlobal('navigator', {
      geolocation: { getCurrentPosition },
      permissions:
        permission === undefined
          ? undefined
          : { query: vi.fn(async () => ({ state: permission })) },
    });
    return getCurrentPosition;
  }

  it('says location is unavailable, not declined, when nobody was asked', async () => {
    const getCurrentPosition = stubLocation({ permission: 'denied' });
    await expect(detectCoarseRegion()).rejects.toThrow(
      "Location isn't available here.",
    );
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('says the prompt was declined when it was', async () => {
    stubLocation({ permission: 'prompt', error: { code: 1 } });
    await expect(detectCoarseRegion()).rejects.toThrow(
      'Location permission was declined.',
    );
  });

  it('still asks where the Permissions API can’t say', async () => {
    const getCurrentPosition = stubLocation({ error: { code: 2 } });
    await expect(detectCoarseRegion()).rejects.toThrow(
      'Could not read your location.',
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  });
});
