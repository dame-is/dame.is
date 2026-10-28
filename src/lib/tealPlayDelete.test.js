import { describe, it, expect } from 'vitest';
import { deleteEveryCopy, playCopiesOf } from './tealPlayDelete.js';

const PROD = 'fm.teal.feed.play';
const ALPHA = 'fm.teal.alpha.feed.play';

/** An agent whose deleteRecord logs its calls and can be told to fail. */
function fakeAgent(fail = () => null) {
  const calls = [];
  return {
    calls,
    com: {
      atproto: {
        repo: {
          async deleteRecord(args) {
            calls.push(`${args.collection}/${args.rkey}`);
            const err = fail(args);
            if (err) throw err;
            return {};
          },
        },
      },
    },
  };
}

describe('playCopiesOf', () => {
  it('names the other teal namespace for a play, the record itself first', () => {
    expect(playCopiesOf(PROD)).toEqual([PROD, ALPHA]);
    expect(playCopiesOf(ALPHA)).toEqual([ALPHA, PROD]);
  });

  it('leaves every other collection alone', () => {
    expect(playCopiesOf('app.bsky.feed.post')).toEqual(['app.bsky.feed.post']);
  });
});

describe('deleteEveryCopy', () => {
  it('deletes the twin as well, so dedupe has nothing left to resurrect', async () => {
    const agent = fakeAgent();
    await deleteEveryCopy(agent, {
      repo: 'did:plc:me',
      collection: PROD,
      rkey: '3k',
    });
    expect(agent.calls).toEqual([`${PROD}/3k`, `${ALPHA}/3k`]);
  });

  it('treats a twin that was never there as done', async () => {
    const agent = fakeAgent(({ collection }) =>
      collection === ALPHA
        ? Object.assign(new Error('Could not locate record'), {
            error: 'RecordNotFound',
          })
        : null,
    );
    await expect(
      deleteEveryCopy(agent, {
        repo: 'did:plc:me',
        collection: PROD,
        rkey: '3k',
      }),
    ).resolves.toBeUndefined();
  });

  it('still reports a real failure, on either copy', async () => {
    const offline = () => new Error('Failed to fetch');
    await expect(
      deleteEveryCopy(fakeAgent(offline), {
        repo: 'did:plc:me',
        collection: PROD,
        rkey: '3k',
      }),
    ).rejects.toThrow('Failed to fetch');
    const twinOffline = fakeAgent(({ collection }) =>
      collection === ALPHA ? offline() : null,
    );
    await expect(
      deleteEveryCopy(twinOffline, {
        repo: 'did:plc:me',
        collection: PROD,
        rkey: '3k',
      }),
    ).rejects.toThrow('Failed to fetch');
  });

  it('is a single delete for anything that is not a play', async () => {
    const agent = fakeAgent();
    await deleteEveryCopy(agent, {
      repo: 'did:plc:me',
      collection: 'app.bsky.feed.post',
      rkey: '3k',
    });
    expect(agent.calls).toEqual(['app.bsky.feed.post/3k']);
  });
});
