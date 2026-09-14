// Does the fixture repo still look like the PDS?
//
// Not a test of the admin, and not a test of the fixtures' exact contents —
// counts and track names are free to change. What is pinned here is the SHAPE
// of the listening fixture, because that is what went wrong: it sat on
// teal.fm's `fm.teal.alpha.feed.play` for weeks after the scrobbler moved to
// production `fm.teal.feed.play`, writing `artistNames` and no origin URL —
// a shape no live record has had since 11 August 2026. Nothing caught it,
// because nothing looked.
//
// The listening surfaces are built around the move (one cursor per NSID, an
// rkey dedupe, accessors that branch on the spelling), and a fixture in a
// single namespace leaves all of it unwalked while still looking fine on
// screen. These assertions are the thing that looks.

import { describe, it, expect } from 'vitest';
import { buildRepo } from './fixtures.js';
import {
  TEAL_PLAY_NSIDS,
  dedupePlaysByRkey,
  playArtistNames,
  playOriginUrl,
  playTrackName,
  playedAtOf,
} from '../src/lib/teal.js';

const repo = buildRepo();
const rkeyOf = (r) => r.uri.split('/').pop();

describe('the listening fixture spans teal.fm’s namespace move', () => {
  it('populates both play lexicons', () => {
    for (const nsid of TEAL_PLAY_NSIDS) {
      expect(repo[nsid]?.length, `${nsid} has no fixture records`).toBeGreaterThan(0);
    }
  });

  it('puts most of the archive in the production lexicon', () => {
    const [production, alpha] = TEAL_PLAY_NSIDS;
    expect(repo[production].length).toBeGreaterThan(repo[alpha].length);
  });

  it('writes some plays to both lexicons under one rkey, as the cutover did', () => {
    const [production, alpha] = TEAL_PLAY_NSIDS;
    const prodRkeys = new Set(repo[production].map(rkeyOf));
    const shared = repo[alpha].filter((r) => prodRkeys.has(rkeyOf(r)));
    expect(shared.length).toBeGreaterThan(0);
  });

  it('collapses those duplicates to the production copy', () => {
    const [production, alpha] = TEAL_PLAY_NSIDS;
    const all = [...repo[production], ...repo[alpha]];
    const merged = dedupePlaysByRkey(all);

    // One survivor per distinct rkey, and never the alpha copy of a play that
    // exists in production — a play counted twice is a wrong listen count.
    expect(merged.length).toBe(new Set(all.map(rkeyOf)).size);
    expect(merged.length).toBeLessThan(all.length);

    const prodRkeys = new Set(repo[production].map(rkeyOf));
    const alphaSurvivors = merged.filter(
      (r) => r.uri.includes(alpha) && prodRkeys.has(rkeyOf(r)),
    );
    expect(alphaSurvivors).toEqual([]);
  });
});

describe('the listening fixture uses each lexicon’s own field spellings', () => {
  it('writes production records the way production records are written', () => {
    const [production] = TEAL_PLAY_NSIDS;
    const values = repo[production].map((r) => r.value);

    // Every production record sampled off the network uses `artists` objects.
    // `artistNames` is a deprecated fallback for old records; a production
    // fixture that used it would be describing a record that does not exist.
    expect(values.every((v) => Array.isArray(v.artists))).toBe(true);
    expect(values.some((v) => v.artistNames)).toBe(false);
    expect(values.some((v) => v.originUrl || v.musicServiceBaseDomain)).toBe(false);

    // Production spellings, and `trackMbId`, which alpha has no equivalent for.
    expect(values.some((v) => v.originUri)).toBe(true);
    expect(values.some((v) => v.musicServiceUri)).toBe(true);
    expect(values.some((v) => v.trackMbId)).toBe(true);

    // Not every scrobbler reports where the play came from — multi-scrobbler
    // on Spotify sends none — so the "no direct link" path has to be covered.
    expect(values.some((v) => !v.originUri)).toBe(true);
  });

  it('keeps the alpha spellings on the alpha archive', () => {
    const [, alpha] = TEAL_PLAY_NSIDS;
    const values = repo[alpha].map((r) => r.value);

    expect(values.some((v) => v.originUrl)).toBe(true);
    expect(values.some((v) => v.musicServiceBaseDomain)).toBe(true);
    expect(values.some((v) => v.originUri || v.musicServiceUri)).toBe(false);

    // The real archive is a mix: `artistNames` on the oldest records, `artists`
    // on the newer ones. Both accessor branches need something to read.
    expect(values.some((v) => Array.isArray(v.artistNames))).toBe(true);
    expect(values.some((v) => Array.isArray(v.artists))).toBe(true);
  });

  it('gives every play a name, an artist and a time through the accessors', () => {
    const all = TEAL_PLAY_NSIDS.flatMap((nsid) => repo[nsid] || []);
    const unreadable = all.filter(
      (r) =>
        !playTrackName(r.value) ||
        playArtistNames(r.value).length === 0 ||
        !playedAtOf(r.value),
    );
    expect(unreadable).toEqual([]);
  });

  it('carries origin URLs an Apple song id can be parsed out of', () => {
    // `albumArt.js` reads the `?i=` param and takes it only if it is all
    // digits; `musicLinks.js` offers a direct link only when the host matches.
    // A placeholder URL would quietly fall through both.
    const all = TEAL_PLAY_NSIDS.flatMap((nsid) => repo[nsid] || []);
    const origins = all.map((r) => playOriginUrl(r.value)).filter(Boolean);
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      const url = new URL(origin);
      expect(url.hostname).toBe('music.apple.com');
      expect(url.searchParams.get('i')).toMatch(/^\d+$/);
    }
  });
});
