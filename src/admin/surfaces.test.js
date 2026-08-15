// Invariants for the admin surface registry and its record-field accessors.
//
// These are not unit tests of arithmetic; they are the guard rail around the two
// things in the admin that break silently and expensively:
//
//   1. A surface `key` is a URL. Renaming one, or letting two surfaces collide on
//      one, breaks a bookmark and every in-tree link that names it — and nothing
//      throws, the page just quietly renders the Front Desk instead.
//   2. `resolveSurface`'s precedence is what keeps `?c=` addressing the GENERIC
//      record editor. Two shipped components (the guestbook moderation panel and
//      the page-content panel) link into `?c=` expecting exactly that, so a
//      "helpful" tweak that routes `?c=site.standard.publication` to
//      PublicationsManager would strand the only way to reach a raw record.

import { describe, it, expect } from 'vitest';
import {
  SURFACES,
  SURFACE_GROUPS,
  DASHBOARD_SURFACE,
  allSurfaces,
  surfaceByKey,
  resolveSurface,
  rowHrefFor,
} from './surfaces.js';
import { latestInstant, rowLabel, recordInstant, previewFor, truncate } from './recordFields.js';
import {
  countedNsids,
  invalidateCounts,
  fetchCounts,
  deriveTiles,
  deriveNeedsYou,
  deriveLatest,
  surfaceForRecord,
  NEEDS_YOU_EMPTY,
} from './useAdminData.js';
import { LEGACY_POSTS } from '../lib/legacyBlog.js';
import { COLLECTIONS, PORTFOLIO_PUBLICATION, GUESTBOOK_NSID } from '../config.js';

const STANDARD_DOC = 'site.standard.document';

describe('the surface registry', () => {
  it('has unique keys', () => {
    const keys = allSurfaces().map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('keeps the keys that are already in URLs', () => {
    // Every one of these is a live `?view=` value today. Changing one is a
    // breaking change to a bookmark, not a rename.
    for (const key of [
      'blogging',
      'creating',
      'listening',
      'pages',
      'nav',
      'sky',
      'publications',
      'guestbook',
      'resume',
      'resume-tailor',
      'ratioed',
      'ratioed-studio',
      'legacy-blogs',
    ]) {
      const s = surfaceByKey(key);
      expect(s, `missing surface: ${key}`).toBeTruthy();
      expect(s.urlByView, `${key} must be addressed as ?view=`).toBe(true);
    }
  });

  it('gives every surface a group the grid knows how to render', () => {
    const groups = new Set(SURFACE_GROUPS.map((g) => g.key));
    for (const s of allSurfaces()) expect(groups.has(s.group), `${s.key} → ${s.group}`).toBe(true);
  });

  it('gives every surface an icon NAME, never a component', () => {
    for (const s of allSurfaces()) expect(typeof s.icon).toBe('string');
  });

  it('resolves pageSlug eagerly — never undefined', () => {
    // `undefined` would mean "ask pageSlugForCollection yourself", and a consumer
    // that forgot would silently render the wrong page panel.
    for (const s of allSurfaces()) expect(s.pageSlug === null || typeof s.pageSlug === 'string').toBe(true);
    expect(surfaceByKey('blogging').pageSlug).toBe('blogging');
    // Overridden: the default for site.standard.document is `blogging`.
    expect(surfaceByKey('creating').pageSlug).toBe('creating');
  });

  it('derives the legacy record types instead of listing them', () => {
    // `is.dame.creating.work` is flagged legacy in lexicons.js and is absent from
    // the live repo; it must still be reachable, and must arrive by derivation so
    // that flagging a lexicon is the whole change.
    const derived = allSurfaces().filter((s) => !SURFACES.includes(s));
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.map((s) => s.nsid)).toContain(COLLECTIONS.creating);
    for (const s of derived) expect(s.group).toBe('legacy');
  });
});

describe('countability', () => {
  // Counting is one listRecords per collection. The four large collections are
  // exempt because counting them means paging them: app.bsky.feed.post measured
  // 24,409 records = 246 requests over two minutes.
  it('never counts the four large collections', () => {
    for (const nsid of [COLLECTIONS.now, 'app.bsky.feed.post', 'fm.teal.feed.play', 'fm.teal.alpha.feed.play']) {
      const s = allSurfaces().find((x) => x.nsid === nsid);
      if (!s) continue;
      expect(s.countable, `${nsid} must not be countable`).toBe(false);
    }
  });

  it('never counts an offRepo surface', () => {
    // `is.dame.guestbook.entry` lives on the SIGNERS' repos. listRecords for it
    // here answers 200 with an empty array — a successful lie — so the guestbook
    // is exempt from counting and from the empty-collection dimming rule.
    const gb = surfaceByKey('guestbook');
    expect(gb.offRepo).toBe(true);
    expect(gb.countable).toBe(false);
    expect(gb.nsid).toBe(GUESTBOOK_NSID);
    expect(gb.nsids).toContain('is.dame.guestbook.entry');
  });

  it('counts the small collections', () => {
    for (const key of ['blogging', 'curating', 'pages', 'publications', 'hero', 'resume']) {
      expect(surfaceByKey(key).countable, key).toBe(true);
    }
  });

  it('leaves a surface with no NSID uncountable', () => {
    expect(surfaceByKey('legacy-blogs').nsid).toBeNull();
    expect(surfaceByKey('legacy-blogs').countable).toBe(false);
  });
});

describe('href / key round-trip', () => {
  it('round-trips every urlByView surface through its own href', () => {
    for (const s of allSurfaces()) {
      if (!s.urlByView) continue;
      expect(s.href).toBe(`/admin?view=${s.key}`);
      const view = new URL(s.href, 'https://dame.is').searchParams.get('view');
      expect(resolveSurface({ view, collection: null })).toBe(s);
    }
  });

  it('round-trips every ?c= surface through its own href', () => {
    for (const s of allSurfaces()) {
      if (s.urlByView) continue;
      expect(s.href).toBe(`/admin?c=${encodeURIComponent(s.nsid)}`);
      const c = new URL(s.href, 'https://dame.is').searchParams.get('c');
      expect(resolveSurface({ view: null, collection: c })).toBe(s);
    }
  });

  it('gives no two ?c= surfaces the same NSID', () => {
    // resolveSurface picks the FIRST match, so a duplicate would make one of them
    // unreachable by URL forever.
    const nsids = allSurfaces().filter((s) => !s.urlByView).map((s) => s.nsid);
    expect(new Set(nsids).size).toBe(nsids.length);
  });
});

describe('resolveSurface precedence', () => {
  it('prefers a known view over a collection', () => {
    expect(resolveSurface({ view: 'sky', collection: COLLECTIONS.now }).key).toBe('sky');
  });

  it('falls through an unknown view to the collection', () => {
    expect(resolveSurface({ view: 'nope', collection: COLLECTIONS.now }).key).toBe('logging');
  });

  it('falls all the way through to the Front Desk', () => {
    expect(resolveSurface({}).kind).toBe('dashboard');
    expect(resolveSurface({ view: 'nope', collection: null })).toBe(DASHBOARD_SURFACE);
    // A `?c=` surface key is not a `?view=` value.
    expect(resolveSurface({ view: 'logging', collection: null })).toBe(DASHBOARD_SURFACE);
  });

  it('NEVER resolves a ?c= URL to a studio', () => {
    // GuestbookModerationPanel and PageContentPanel both link into `?c=` to reach
    // the raw record behind a studio. If either of these becomes a studio, that
    // link silently reopens the studio it was trying to escape.
    for (const nsid of ['site.standard.publication', GUESTBOOK_NSID, COLLECTIONS.page, COLLECTIONS.sky]) {
      expect(resolveSurface({ view: null, collection: nsid }).kind, nsid).toBe('records-list');
    }
  });

  it('mints a synthetic, uncountable surface for an unknown NSID', () => {
    // The "open any NSID" control can name a collection with 24,000 records in it.
    const s = resolveSurface({ view: null, collection: 'com.example.unheard.of' });
    expect(s.kind).toBe('records-list');
    expect(s.countable).toBe(false);
    expect(s.urlByView).toBe(false);
    expect(s.label).toBe('com.example.unheard.of');
    expect(s.blurb).toBe('');
    // Stable identity for the same NSID, so it can sit in a React dep array.
    expect(resolveSurface({ collection: 'com.example.unheard.of' })).toBe(s);
  });

  it('labels a synthetic surface from the lexicon when there is one', () => {
    expect(resolveSurface({ collection: COLLECTIONS.resumeJob }).label).toBe('Resume · job');
  });

  it('never returns null', () => {
    for (const params of [{}, { view: '' }, { collection: '' }, { view: null, collection: null }]) {
      expect(resolveSurface(params)).toBeTruthy();
    }
  });
});

describe('rowHrefFor', () => {
  it('preserves a urlByView records surface', () => {
    expect(rowHrefFor(surfaceByKey('creating'), 'abc')).toBe('/admin?view=creating&r=abc');
  });

  it('addresses a ?c= surface by collection', () => {
    expect(rowHrefFor(surfaceByKey('curating'), 'weird-dog-photos-only')).toBe(
      '/admin?c=is.dame.arena.channel&r=weird-dog-photos-only',
    );
  });

  it('sends a studio-homed record to the generic editor', () => {
    // The only way to reach the raw record behind a studio.
    expect(rowHrefFor(surfaceByKey('publications'), 'x')).toBe(
      '/admin?c=site.standard.publication&r=x',
    );
  });

  it('escapes an rkey that would otherwise change the URL shape', () => {
    expect(rowHrefFor(surfaceByKey('curating'), 'a b&c=1')).toBe(
      '/admin?c=is.dame.arena.channel&r=a%20b%26c%3D1',
    );
  });
});

describe('recordFilter', () => {
  // Blogging and Creating are ONE collection split client-side on `value.site`.
  it('splits documents by publication, and covers every document between them', () => {
    const blogging = surfaceByKey('blogging').recordFilter;
    const creating = surfaceByKey('creating').recordFilter;
    const portfolio = { site: PORTFOLIO_PUBLICATION };
    const blog = { site: 'at://did:plc:x/site.standard.publication/blog' };
    expect(blogging(blog)).toBe(true);
    expect(creating(blog)).toBe(false);
    expect(creating(portfolio)).toBe(true);
    expect(blogging(portfolio)).toBe(false);
    // A doc with no publication at all still lands somewhere.
    expect(blogging({})).toBe(true);
  });
});

describe('latestInstant', () => {
  const uri = (nsid, rkey) => `at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/${nsid}/${rkey}`;

  it('prefers an edit timestamp, then publication, then creation', () => {
    const v = { updatedAt: '2026-03-01T00:00:00Z', publishedAt: '2025-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' };
    expect(latestInstant(v, uri(COLLECTIONS.page, 'home'), COLLECTIONS.page)).toBe('2026-03-01T00:00:00Z');
    expect(latestInstant({ publishedAt: '2025-01-01T00:00:00Z', createdAt: '2024-01-01T00:00:00Z' }, uri(STANDARD_DOC, 'x'), STANDARD_DOC)).toBe('2025-01-01T00:00:00Z');
  });

  it('reads a ratioed piece from measuredAt', () => {
    // Ratioed pieces carry no createdAt / updatedAt / publishedAt at all.
    const v = { take: 13, measuredAt: '2026-02-02T00:00:00Z' };
    expect(latestInstant(v, uri(COLLECTIONS.ratioedPiece, '3lrqlgyvftk27'), COLLECTIONS.ratioedPiece)).toBe(
      '2026-02-02T00:00:00Z',
    );
  });

  it('trusts a TID rkey ONLY when the lexicon mints it', () => {
    // This is the whole reason the fallback is conditional. A ratioed piece's rkey
    // is the SUBJECT Bluesky post's rkey — decoding it would date a measurement
    // taken today as months old, and those rows dominated the merged list.
    const tid = '3lrqlgyvftk27';
    expect(latestInstant({}, uri(COLLECTIONS.now, tid), COLLECTIONS.now)).toBeTruthy();
    expect(latestInstant({}, uri(COLLECTIONS.ratioedPiece, tid), COLLECTIONS.ratioedPiece)).toBeNull();
  });

  it('returns null rather than a wrong date', () => {
    // A null instant means the row is DROPPED, not shown undated.
    expect(latestInstant({}, uri(COLLECTIONS.page, 'home'), COLLECTIONS.page)).toBeNull();
    expect(latestInstant(null, null, 'com.example.unknown')).toBeNull();
  });
});

describe('rowLabel', () => {
  it('names a ratioed piece by its take, not its subject at-uri', () => {
    // previewFor skips `take` (a number) and lands on `subject`, a raw at:// URI.
    const v = { take: 13, subject: 'at://did:plc:x/app.bsky.feed.post/3lrqlgyvftk27' };
    expect(rowLabel(v, COLLECTIONS.ratioedPiece)).toBe('Take 13');
  });

  it('prefers an arena channel title, then the slug', () => {
    expect(rowLabel({ arenaSlug: 'weird-dog-photos-only', title: 'Weird dogs' }, COLLECTIONS.arenaChannel)).toBe('Weird dogs');
    expect(rowLabel({ arenaSlug: 'weird-dog-photos-only' }, COLLECTIONS.arenaChannel)).toBe('weird-dog-photos-only');
  });

  it('falls back to previewFor everywhere else', () => {
    expect(rowLabel({ status: 'mothing' }, COLLECTIONS.now)).toBe('mothing');
  });

  it('never returns undefined', () => {
    expect(rowLabel(null, 'com.example.unknown')).toBe('');
    expect(rowLabel({}, COLLECTIONS.ratioedPiece)).toBe('');
  });
});

describe('the lifted display helpers behave exactly as they did in Admin.jsx', () => {
  it('prefers a publication instant for a row timestamp', () => {
    expect(recordInstant({ createdAt: 'c', publishedAt: 'p' })).toBe('p');
    expect(recordInstant({ createdAt: 'c', playedTime: 't' })).toBe('c');
    expect(recordInstant('nope')).toBeNull();
  });

  it('skips a bare timestamp field when previewing', () => {
    // A record whose only string field is createdAt previews as empty, not as a date.
    expect(previewFor({ createdAt: '2026-01-01T00:00:00Z' }, lexOf('createdAt', 'status'))).toBe('');
  });

  it('truncates with an ellipsis and no trailing space', () => {
    expect(truncate('abcdef', 6)).toBe('abcdef');
    expect(truncate('abcdef', 5)).toBe('abcd…');
    // The cut lands mid-gap: the ellipsis must not float off the last word.
    expect(truncate('ab  cdef', 5)).toBe('ab…');
    expect(truncate(null, 5)).toBe('');
  });

  function lexOf(...keys) {
    return { fields: keys.map((key) => ({ key })) };
  }
});

/* ------------------------------------------------------------------ */
/* Front Desk data                                                      */
/* ------------------------------------------------------------------ */

/** A settled count entry, shaped exactly as one listRecords page produces. */
function entryOf(nsid, values, { complete = true, error = null, rkeys = null } = {}) {
  return {
    nsid,
    records: values.map((value, i) => ({
      uri: `at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/${nsid}/${rkeys ? rkeys[i] : `r${i}`}`,
      cid: `cid${i}`,
      value,
    })),
    count: error ? null : values.length,
    complete,
    error,
    fetchedAt: error ? 0 : Date.now(),
  };
}

/** Every counted collection, empty, so a derivation is never "still loading". */
function settledEmpty(overrides = {}) {
  const out = {};
  for (const nsid of countedNsids()) out[nsid] = entryOf(nsid, []);
  // The legacy-blog item fires on a bare repo — correctly, nothing is migrated —
  // so quiet it by default with one document per bundled post.
  out[STANDARD_DOC] = entryOf(
    STANDARD_DOC,
    LEGACY_POSTS.map((p) => ({ title: p.slug })),
    { rkeys: LEGACY_POSTS.map((p) => p.slug) },
  );
  return { ...out, ...overrides };
}

describe('what gets counted', () => {
  it('counts each collection once, never the large four, never the guestbook', () => {
    const nsids = countedNsids();
    expect(new Set(nsids).size).toBe(nsids.length);
    // Blogging + Creating are one collection; Ratioed studio + catalogue another.
    expect(nsids.filter((n) => n === STANDARD_DOC)).toHaveLength(1);
    for (const big of [COLLECTIONS.now, 'app.bsky.feed.post', 'fm.teal.feed.play', 'fm.teal.alpha.feed.play', GUESTBOOK_NSID, 'is.dame.guestbook.entry']) {
      expect(nsids, big).not.toContain(big);
    }
  });

  it('makes exactly one request per counted collection, at the API maximum', async () => {
    invalidateCounts();
    const log = [];
    const agent = fakeAgent(log, { [STANDARD_DOC]: [{ title: 'a' }] });
    await fetchCounts(agent, 'did:plc:x');
    expect(log.length).toBe(countedNsids().length);
    expect(log.every((c) => c.limit === 100)).toBe(true);
  });

  it('serves the next read from cache, and refetches only what was invalidated', async () => {
    invalidateCounts();
    const log = [];
    const agent = fakeAgent(log, {});
    await fetchCounts(agent, 'did:plc:x');
    const first = log.length;
    await fetchCounts(agent, 'did:plc:x');
    expect(log.length).toBe(first);
    // Scoped invalidation is what a record delete does: one collection, not all.
    invalidateCounts(STANDARD_DOC);
    await fetchCounts(agent, 'did:plc:x');
    expect(log.length).toBe(first + 1);
    expect(log[log.length - 1].collection).toBe(STANDARD_DOC);
  });

  it('reports a full page as incomplete — the count is a floor, never a bare number', async () => {
    invalidateCounts();
    const hundred = Array.from({ length: 100 }, (_, i) => ({ title: `doc ${i}` }));
    const entries = await fetchCounts(fakeAgent([], { [STANDARD_DOC]: hundred }), 'did:plc:x');
    // The exhaustion test is records.length < limit, NOT !cursor: a short final
    // page still returns a live cursor, verified twice against the live PDS —
    // which is why fakeAgent returns one unconditionally.
    expect(entries[STANDARD_DOC].count).toBe(100);
    expect(entries[STANDARD_DOC].complete).toBe(false);
    expect(deriveTiles(entries, null).documentsPublished.complete).toBe(false);
  });

  it('loses only the failing collection when one request rejects', async () => {
    invalidateCounts();
    const agent = {
      com: { atproto: { repo: {
        async listRecords({ collection, limit }) {
          if (collection === COLLECTIONS.resume) throw new Error('boom');
          return { data: { records: collection === STANDARD_DOC ? [{ uri: 'at://d/c/r', value: { title: 'a' } }] : [], cursor: 'x' }, limit };
        },
      } } },
    };
    const entries = await fetchCounts(agent, 'did:plc:x');
    expect(entries[COLLECTIONS.resume].error).toBe('boom');
    expect(entries[COLLECTIONS.resume].count).toBeNull();
    // fetchedAt 0 so the failure is never treated as a fresh number.
    expect(entries[COLLECTIONS.resume].fetchedAt).toBe(0);
    expect(entries[STANDARD_DOC].count).toBe(1);
    const tiles = deriveTiles(entries, null);
    expect(tiles.documentsPublished.value).toBe(1);
    expect(tiles.hiddenElsewhere.error).toBe('boom');
  });

  function fakeAgent(log, repo) {
    return {
      com: { atproto: { repo: {
        async listRecords({ collection, limit }) {
          log.push({ collection, limit });
          const values = repo[collection] || [];
          return {
            data: {
              records: values.map((value, i) => ({ uri: `at://d/${collection}/r${i}`, cid: 'c', value })),
              // A cursor is returned even on a short final page — on purpose.
              cursor: 'always-a-cursor',
            },
          };
        },
      } } },
    };
  }
});

describe('the four tiles', () => {
  it('keeps Drafts and Hidden elsewhere describing disjoint sets', () => {
    // site.standard.document's visibility model IS the draft predicate, so a
    // "hidden" tile spanning documents would report the same records twice and
    // their sum would be twice the number of affected records.
    const entries = settledEmpty({
      [STANDARD_DOC]: entryOf(STANDARD_DOC, [
        { title: 'live' },
        { title: 'wip', draft: true },
        { title: 'also wip', draft: true },
      ]),
      [COLLECTIONS.arenaChannel]: entryOf(COLLECTIONS.arenaChannel, [{ arenaSlug: 'a', enabled: false }]),
      [COLLECTIONS.heroPhrase]: entryOf(COLLECTIONS.heroPhrase, [{ text: 'x', enabled: false }]),
      [COLLECTIONS.resume]: entryOf(COLLECTIONS.resume, [{ title: 'r', visibility: 'public' }, { title: 'r2' }]),
    });
    const tiles = deriveTiles(entries, null);
    expect(tiles.documentsPublished.value).toBe(1);
    expect(tiles.drafts.value).toBe(2);
    // One channel + one phrase + one resume with a missing visibility (which
    // reads as private). Documents contribute nothing.
    expect(tiles.hiddenElsewhere.value).toBe(3);
  });

  it('survives a collection with no visibility model at all', () => {
    // Seven counted collections have none, and `.isHidden` on a null model is a
    // TypeError rather than a zero.
    expect(() => deriveTiles(settledEmpty(), null)).not.toThrow();
    expect(deriveTiles(settledEmpty(), null).hiddenElsewhere.value).toBe(0);
  });

  it('shows nothing rather than zero before the data lands', () => {
    const tiles = deriveTiles({}, null);
    expect(tiles.drafts.loading).toBe(true);
    expect(tiles.drafts.value).toBeNull();
    expect(tiles.hiddenElsewhere.value).toBeNull();
  });

  it('never renders an unreachable guestbook index as 0', () => {
    const dead = deriveTiles(settledEmpty(), { signatures: null, hiddenList: null });
    expect(dead.guestbook.available).toBe(false);
    expect(dead.guestbook.signatures).toBeNull();
    // One of the two numbers is enough to render the tile.
    const half = deriveTiles(settledEmpty(), { signatures: null, hiddenList: 0 });
    expect(half.guestbook.available).toBe(true);
    expect(half.guestbook.hiddenList).toBe(0);
  });
});

describe('needs you', () => {
  it('says so, verbatim, when there is nothing to do', () => {
    const needs = deriveNeedsYou(settledEmpty());
    expect(needs.empty).toBe(true);
    expect(needs.loading).toBe(false);
    expect(needs.items).toEqual([]);
    expect(NEEDS_YOU_EMPTY).toBe('Nothing needs you right now.');
  });

  it('does not claim emptiness before the data lands', () => {
    expect(deriveNeedsYou({}).loading).toBe(true);
  });

  it('sends each draft back to the surface it is homed on', () => {
    const entries = settledEmpty({
      [STANDARD_DOC]: entryOf(
        STANDARD_DOC,
        [
          { title: 'a blog draft', draft: true },
          { title: 'a portfolio draft', draft: true, site: PORTFOLIO_PUBLICATION },
        ],
        { rkeys: ['aaa', 'bbb'] },
      ),
    });
    const item = deriveNeedsYou(entries).work.find((i) => i.id === 'drafts');
    expect(item.count).toBe(2);
    expect(item.label).toBe('2 drafts');
    expect(item.rows.map((r) => r.href)).toEqual([
      '/admin?view=blogging&r=aaa',
      '/admin?view=creating&r=bbb',
    ]);
  });

  it('suppresses the legacy-migration item when the document page came back full', () => {
    // The migrated set would be incomplete, and asserting work that is already
    // done is worse than staying quiet.
    const full = settledEmpty({
      [STANDARD_DOC]: entryOf(STANDARD_DOC, Array.from({ length: 100 }, () => ({ title: 'x' })), {
        complete: false,
      }),
    });
    expect(deriveNeedsYou(full).work.find((i) => i.id === 'legacy-blogs')).toBeUndefined();
    // Unguarded, the same data does report it.
    const short = settledEmpty({ [STANDARD_DOC]: entryOf(STANDARD_DOC, []) });
    expect(deriveNeedsYou(short).work.find((i) => i.id === 'legacy-blogs').count).toBe(
      LEGACY_POSTS.length,
    );
  });

  it('trips only when more than one resume version is active', () => {
    const one = settledEmpty({
      [COLLECTIONS.resume]: entryOf(COLLECTIONS.resume, [{ featured: true }, {}]),
    });
    expect(deriveNeedsYou(one).checks).toEqual([]);
    const two = settledEmpty({
      [COLLECTIONS.resume]: entryOf(COLLECTIONS.resume, [{ featured: true }, { featured: true }]),
    });
    expect(deriveNeedsYou(two).checks.map((c) => c.id)).toEqual(['resume-featured']);
  });

  it('flags page records outside the built-in surfaces, and publications with no url', () => {
    const entries = settledEmpty({
      [COLLECTIONS.page]: entryOf(COLLECTIONS.page, [{}, {}], { rkeys: ['about', 'not-a-page'] }),
      'site.standard.publication': entryOf('site.standard.publication', [
        { title: 'ok', url: 'https://dame.is' },
        { title: 'broken' },
      ]),
    });
    const ids = deriveNeedsYou(entries).checks.map((c) => c.id);
    expect(ids).toEqual(['pages-unknown', 'publications-no-url']);
  });

  it('derives NOTHING from the guestbook', () => {
    // `flagged` is recomputed per render and never persisted, so an item built on
    // it is not a queue — it would nag forever. The hidden list is a fact, not a
    // task. Neither may produce a needs-you item.
    const needs = deriveNeedsYou(settledEmpty());
    for (const item of needs.items) expect(item.id).not.toMatch(/guest|flag|hidden|review/i);
  });
});

describe('latest records', () => {
  it('merges across collections in real time order, newest first', () => {
    const entries = settledEmpty({
      [STANDARD_DOC]: entryOf(STANDARD_DOC, [{ title: 'older doc', publishedAt: '2026-01-01T00:00:00Z' }]),
      [COLLECTIONS.arenaChannel]: entryOf(COLLECTIONS.arenaChannel, [
        // A -04:00 offset that sorts WRONG as a string against a Z timestamp.
        { arenaSlug: 'chan', title: 'Newer channel', createdAt: '2026-01-01T20:00:00-04:00' },
      ]),
    });
    const rows = deriveLatest(entries);
    expect(rows.map((r) => r.label).slice(0, 2)).toEqual(['Newer channel', 'older doc']);
  });

  it('omits a record it cannot honestly date', () => {
    const entries = settledEmpty({
      [COLLECTIONS.page]: entryOf(COLLECTIONS.page, [{ title: 'no timestamp' }], { rkeys: ['about'] }),
    });
    expect(deriveLatest(entries).find((r) => r.rkey === 'about')).toBeUndefined();
  });

  it('caps the list', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      title: `doc ${i}`,
      publishedAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
    }));
    expect(deriveLatest(settledEmpty({ [STANDARD_DOC]: entryOf(STANDARD_DOC, many) }))).toHaveLength(8);
  });

  it('names the surface each row belongs to and links back to it', () => {
    const entries = settledEmpty({
      [STANDARD_DOC]: entryOf(
        STANDARD_DOC,
        [{ title: 'a work', site: PORTFOLIO_PUBLICATION, publishedAt: '2026-01-02T00:00:00Z' }],
        { rkeys: ['work1'] },
      ),
    });
    const row = deriveLatest(entries)[0];
    expect(row.surfaceLabel).toBe('Creating');
    expect(row.href).toBe('/admin?view=creating&r=work1');
  });

  it('sends a studio-homed record to the generic editor', () => {
    // The only way to reach the raw record behind a studio.
    expect(surfaceForRecord(COLLECTIONS.ratioedPiece, {}).key).toBe('ratioed-studio');
    const entries = settledEmpty({
      [COLLECTIONS.ratioedPiece]: entryOf(
        COLLECTIONS.ratioedPiece,
        [{ take: 13, subject: 'at://did:plc:x/app.bsky.feed.post/abc', measuredAt: '2026-02-02T00:00:00Z' }],
        { rkeys: ['3lrqlgyvftk27'] },
      ),
    });
    const row = deriveLatest(entries)[0];
    expect(row.label).toBe('Take 13');
    expect(row.href).toBe('/admin?c=is.dame.creating.ratioed.piece&r=3lrqlgyvftk27');
  });
});
