import { describe, it, expect } from 'vitest';
import { dropGhostPlays, findGhostPlays } from './ghostPlays.js';
import { dedupeVerbAggregate } from './feedBuilder.js';

const DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
let seq = 0;

/** A unified-feed listening item, the shape both feeds hand the filter. */
const play = (
  trackName,
  at,
  { artist = 'Victoria Monét & USHER', duration = 261 } = {},
) => ({
  verb: 'listening',
  atUri: `at://${DID}/fm.teal.feed.play/3mx${String(seq++).padStart(10, 'a')}`,
  createdAt: at,
  payload: {
    trackName,
    artists: [{ artistName: artist }],
    ...(duration ? { duration } : {}),
    playedTime: at,
  },
});

const tracks = (list) => list.map((p) => p.payload.trackName);

/** An evening session ending on DNA. and Money (Interlude), as on 10-07. */
const evening = () => [
  play('Juicy', '2026-10-07T22:44:33Z', {
    artist: 'Victoria Monét',
    duration: 186,
  }),
  play('Maybe', '2026-10-07T22:51:33Z', {
    artist: 'Victoria Monét',
    duration: 223,
  }),
  play('DNA.', '2026-10-07T22:52:03Z', {
    artist: 'Kendrick Lamar',
    duration: 185,
  }),
  play('Money (Interlude)', '2026-10-07T22:55:33Z', {
    artist: 'Victoria Monét',
    duration: 86,
  }),
];

describe('doubles', () => {
  it('drops a song logged again 30 seconds into a 4:21 track', () => {
    const first = play('SOS (Sex on Sight)', '2026-10-01T00:10:33Z');
    const again = play('SOS (Sex on Sight)', '2026-10-01T00:11:06Z');
    expect(dropGhostPlays([first, again])).toEqual([first]);
  });

  it('keeps a song on repeat, even when the first copy was noticed a poll late', () => {
    const first = play('SOS (Sex on Sight)', '2026-10-01T00:10:33Z');
    // 241s later: 20 seconds short of the song, inside the 30s poll slack.
    const repeat = play('SOS (Sex on Sight)', '2026-10-01T00:14:34Z');
    expect(dropGhostPlays([first, repeat])).toEqual([first, repeat]);
  });

  it('drops the second half of an A, B, A, B flip-flop', () => {
    const opts = { artist: 'Wet Leg', duration: 227 };
    const a1 = play('davina mccall', '2026-09-30T10:46:33Z', opts);
    const b1 = play('Thank You', '2026-09-30T10:47:03Z', {
      artist: 'Clairo',
      duration: 205,
    });
    const a2 = play('davina mccall', '2026-09-30T10:47:33Z', opts);
    const b2 = play('Thank You', '2026-09-30T10:48:03Z', {
      artist: 'Clairo',
      duration: 205,
    });
    expect(dropGhostPlays([a1, b1, a2, b2])).toEqual([a1, b1]);
  });

  it('falls back to a one-minute window when a record has no duration', () => {
    const first = play('Untimed', '2026-10-01T00:00:00Z', { duration: null });
    const soon = play('Untimed', '2026-10-01T00:00:40Z', { duration: null });
    const later = play('Untimed', '2026-10-01T00:03:00Z', { duration: null });
    expect(dropGhostPlays([first, soon, later])).toEqual([first, later]);
  });

  it('tells songs apart by artist as well as title', () => {
    const a = play('Intro', '2026-10-01T00:00:00Z', { artist: 'One' });
    const b = play('Intro', '2026-10-01T00:00:30Z', { artist: 'Two' });
    expect(dropGhostPlays([a, b])).toEqual([a, b]);
  });
});

describe('echoes', () => {
  it('drops a morning burst that replays the end of last night', () => {
    const night = evening();
    const ghostA = play('DNA.', '2026-10-08T11:24:07Z', {
      artist: 'Kendrick Lamar',
      duration: 185,
    });
    const ghostB = play('Money (Interlude)', '2026-10-08T11:36:33Z', {
      artist: 'Victoria Monét',
      duration: 86,
    });
    expect(dropGhostPlays([...night, ghostA, ghostB])).toEqual(night);
  });

  it('keeps a morning that plays something new', () => {
    const morning = [
      play('DNA.', '2026-10-08T11:24:07Z', {
        artist: 'Kendrick Lamar',
        duration: 185,
      }),
      play('Thank You', '2026-10-08T11:28:00Z', {
        artist: 'Clairo',
        duration: 205,
      }),
    ];
    const all = [...evening(), ...morning];
    expect(dropGhostPlays(all)).toEqual(all);
  });

  it('keeps a session of three or more songs, even all recent ones', () => {
    const night = evening();
    const replay = [
      play('Juicy', '2026-10-08T15:00:00Z', {
        artist: 'Victoria Monét',
        duration: 186,
      }),
      play('Maybe', '2026-10-08T15:04:00Z', {
        artist: 'Victoria Monét',
        duration: 223,
      }),
      play('Money (Interlude)', '2026-10-08T15:08:00Z', {
        artist: 'Victoria Monét',
        duration: 86,
      }),
    ];
    expect(dropGhostPlays([...night, ...replay])).toHaveLength(7);
  });

  it('keeps a short session that follows real listening within three hours', () => {
    const night = evening();
    const encore = play('DNA.', '2026-10-08T00:30:00Z', {
      artist: 'Kendrick Lamar',
      duration: 185,
    });
    expect(dropGhostPlays([...night, encore])).toHaveLength(5);
  });

  it('drops an echo after a few quiet days when it replays the last songs logged', () => {
    const before = [
      play('Thank You', '2026-10-01T12:15:24Z', {
        artist: 'Clairo',
        duration: 205,
      }),
      play('SOS (Sex on Sight)', '2026-10-01T14:35:03Z'),
    ];
    // Four days of nothing, then SOS twice, 33 seconds apart (10-05).
    const ghost = play('SOS (Sex on Sight)', '2026-10-05T14:58:34Z');
    const double = play('SOS (Sex on Sight)', '2026-10-05T14:59:07Z');
    expect(dropGhostPlays([...before, ghost, double])).toEqual(before);
  });

  it('measures the silence from the last real listening, not the last echo', () => {
    // 10-01: an 8:15 echo, then SOS again at 9:59, only 1.5h later.
    const night = [
      play('Thank You', '2026-09-30T17:29:33Z', {
        artist: 'Clairo',
        duration: 205,
      }),
      play('Icky Thump', '2026-09-30T20:20:03Z', {
        artist: 'The White Stripes',
        duration: 254,
      }),
      play('SOS (Sex on Sight)', '2026-09-30T20:34:03Z'),
    ];
    const echo = [
      play('Thank You', '2026-10-01T12:15:24Z', {
        artist: 'Clairo',
        duration: 205,
      }),
      play('SOS (Sex on Sight)', '2026-10-01T12:32:03Z'),
    ];
    const later = play('SOS (Sex on Sight)', '2026-10-01T13:59:33Z');
    expect(dropGhostPlays([...night, ...echo, later])).toEqual(night);
  });

  it('never flags the oldest session, which has nothing to echo', () => {
    const lone = [
      play('DNA.', '2026-10-08T11:24:07Z', { artist: 'Kendrick Lamar' }),
    ];
    expect(dropGhostPlays(lone)).toEqual(lone);
  });
});

describe('inputs', () => {
  it('works newest-first and keeps the input order', () => {
    const night = evening();
    const ghost = play('Money (Interlude)', '2026-10-08T11:36:33Z', {
      artist: 'Victoria Monét',
      duration: 86,
    });
    const newestFirst = [...night, ghost].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    expect(tracks(dropGhostPlays(newestFirst))).toEqual([
      'Money (Interlude)',
      'DNA.',
      'Maybe',
      'Juicy',
    ]);
    expect(dropGhostPlays(newestFirst)).not.toContain(ghost);
  });

  it('passes through items it cannot judge', () => {
    const undated = { ...play('DNA.', 'not a date'), createdAt: null };
    const untitled = play('', '2026-10-08T11:24:07Z');
    expect(dropGhostPlays([undated, untitled])).toEqual([undated, untitled]);
    expect(findGhostPlays(null).size).toBe(0);
    expect(dropGhostPlays(undefined)).toEqual([]);
  });

  it('returns the same array when there is nothing to drop', () => {
    const night = evening();
    expect(dropGhostPlays(night)).toBe(night);
  });
});

describe('home feed ingest', () => {
  it('drops ghost plays alongside the cross-namespace dedupe', () => {
    const night = evening();
    const ghost = play('Money (Interlude)', '2026-10-08T11:36:33Z', {
      artist: 'Victoria Monét',
      duration: 86,
    });
    const alphaCopy = {
      ...night[0],
      atUri: night[0].atUri.replace(
        'fm.teal.feed.play',
        'fm.teal.alpha.feed.play',
      ),
    };
    const out = dedupeVerbAggregate('listening', [...night, alphaCopy, ghost]);
    expect(out).toEqual(night);
  });
});
