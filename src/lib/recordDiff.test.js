import { describe, it, expect } from 'vitest';
import { normalizeForDiff, diffRecord, labelFields } from './recordDiff.js';
import { lexiconFor, migrateLegacyCreating } from './lexicons.js';
import { COLLECTIONS } from '../config.js';

/**
 * Stand-in for `@atproto/api`'s `BlobRef`. The editor never touches the class
 * itself — all it relies on is that `JSON.stringify` runs `toJSON` and yields
 * the plain wire form — so a four-line mirror pins the behaviour under test
 * without dragging the SDK (and a real CID instance) into a node test run.
 */
class FakeBlobRef {
  constructor(link, mimeType, size) {
    this.ref = { toString: () => link };
    this.mimeType = mimeType;
    this.size = size;
  }

  toJSON() {
    return {
      $type: 'blob',
      ref: { $link: this.ref.toString() },
      mimeType: this.mimeType,
      size: this.size,
    };
  }
}

const DOC = lexiconFor('site.standard.document');
const NOW = lexiconFor(COLLECTIONS.now);

describe('normalizeForDiff', () => {
  it('drops autoOnEdit fields — the save path rewrites them on every call', () => {
    const out = normalizeForDiff(
      { status: 'mothing', createdAt: '2026-04-02T16:04:00.000Z', updatedAt: '2026-04-02T16:04:00.000Z' },
      NOW,
    );
    expect(out).toEqual({ status: 'mothing', createdAt: '2026-04-02T16:04:00.000Z' });
  });

  it('keeps autoOnEdit fields when there is no lexicon to name them', () => {
    const out = normalizeForDiff({ status: 'mothing', updatedAt: 'x' }, null);
    expect(out).toEqual({ status: 'mothing', updatedAt: 'x' });
  });

  it('deep-strips `_url` display annotations', () => {
    const out = normalizeForDiff(
      {
        coverImage: { $type: 'blob', ref: { $link: 'bafy1' }, _url: 'https://pds/xrpc/…' },
        content: { pages: [{ blocks: [{ image: { _url: 'https://pds/xrpc/…', alt: 'a' } }] }] },
      },
      null,
    );
    expect(out).toEqual({
      coverImage: { $type: 'blob', ref: { $link: 'bafy1' } },
      content: { pages: [{ blocks: [{ image: { alt: 'a' } }] }] },
    });
  });

  it('collapses BlobRef instances to their wire form', () => {
    const out = normalizeForDiff(
      { coverImage: new FakeBlobRef('bafy1', 'image/jpeg', 1234) },
      null,
    );
    expect(out).toEqual({
      coverImage: { $type: 'blob', ref: { $link: 'bafy1' }, mimeType: 'image/jpeg', size: 1234 },
    });
  });

  it('drops undefined-valued keys so absence has one representation', () => {
    expect(normalizeForDiff({ title: 'A', slug: undefined }, null)).toEqual({ title: 'A' });
  });

  it('treats null and missing values as themselves', () => {
    expect(normalizeForDiff(null, DOC)).toEqual({});
  });
});

describe('diffRecord', () => {
  it('reports an unchanged fetched record as clean', () => {
    const fetched = {
      $type: 'site.standard.document',
      title: 'A quiet week',
      description: 'Moths, mostly.',
      createdAt: '2026-03-01T09:00:00.000Z',
      updatedAt: '2026-03-02T09:00:00.000Z',
    };
    const baseline = normalizeForDiff(fetched, DOC);
    expect(diffRecord(baseline, normalizeForDiff(fetched, DOC), DOC)).toEqual({
      dirty: false,
      keys: [],
    });
  });

  it('is clean when the ONLY difference is the auto-stamped updatedAt', () => {
    const fetched = { status: 'mothing', createdAt: '2026-03-01T09:00:00.000Z', updatedAt: '2026-03-01T09:00:00.000Z' };
    const baseline = normalizeForDiff(fetched, NOW);
    const bumped = { ...fetched, updatedAt: new Date().toISOString() };
    expect(diffRecord(baseline, normalizeForDiff(bumped, NOW), NOW).dirty).toBe(false);
  });

  it('is clean for a BlobRef cover image after a round-trip', () => {
    // The load path normalizes once and the display path re-annotates the same
    // blob with a `_url`; neither may register as an edit.
    const fetched = { title: 'A', coverImage: new FakeBlobRef('bafy1', 'image/jpeg', 1234) };
    const baseline = normalizeForDiff(fetched, DOC);
    const annotated = {
      title: 'A',
      coverImage: {
        $type: 'blob',
        ref: { $link: 'bafy1' },
        mimeType: 'image/jpeg',
        size: 1234,
        _url: 'https://pds.example/xrpc/com.atproto.sync.getBlob?did=…',
      },
    };
    expect(diffRecord(baseline, normalizeForDiff(annotated, DOC), DOC).dirty).toBe(false);
  });

  it('is clean for a migrate-rewritten legacy value', () => {
    // `migrateLegacyCreating` rewrites `kind`/`body`/`media`/`links` into
    // `category` + a blocks body. The baseline is taken from the MIGRATED value,
    // so a record the owner has only looked at is not permanently dirty.
    const legacy = {
      $type: COLLECTIONS.creating,
      title: 'Inkblot',
      slug: 'inkblot',
      kind: 'art',
      body: 'Some notes.',
      media: [{ kind: 'image', url: 'https://example/1.jpg', alt: 'one' }],
      links: [{ url: 'https://example', label: 'Site' }],
      createdAt: '2024-01-01T00:00:00.000Z',
    };
    const lex = lexiconFor(COLLECTIONS.creating);
    const migrated = migrateLegacyCreating(legacy);
    const baseline = normalizeForDiff(migrated, lex);
    // Migration is idempotent (it early-returns once `content` exists), so a
    // second pass models "the form re-rendered without an edit".
    const again = migrateLegacyCreating(JSON.parse(JSON.stringify(migrated)));
    expect(diffRecord(baseline, normalizeForDiff(again, lex), lex)).toEqual({
      dirty: false,
      keys: [],
    });
  });

  it('is insensitive to key order inside a nested body', () => {
    const baseline = normalizeForDiff(
      { content: { pages: [{ blocks: [{ $type: 'text', plaintext: 'hi', facets: [] }] }] } },
      DOC,
    );
    const reordered = normalizeForDiff(
      { content: { pages: [{ blocks: [{ facets: [], plaintext: 'hi', $type: 'text' }] }] } },
      DOC,
    );
    expect(diffRecord(baseline, reordered, DOC).dirty).toBe(false);
  });

  it('names the changed field', () => {
    const baseline = normalizeForDiff({ title: 'A', description: 'x' }, DOC);
    const next = normalizeForDiff({ title: 'B', description: 'x' }, DOC);
    expect(diffRecord(baseline, next, DOC)).toEqual({ dirty: true, keys: ['title'] });
  });

  it('counts an added key and a removed key', () => {
    const baseline = normalizeForDiff({ title: 'A', description: 'x' }, DOC);
    const next = normalizeForDiff({ title: 'A', tags: ['moths'] }, DOC);
    const { dirty, keys } = diffRecord(baseline, next, DOC);
    expect(dirty).toBe(true);
    expect(new Set(keys)).toEqual(new Set(['description', 'tags']));
  });

  it('orders changed keys the way the form draws them, extras alphabetically', () => {
    const fieldOrder = DOC.fields.map((f) => f.key);
    expect(fieldOrder.indexOf('title')).toBeLessThan(fieldOrder.indexOf('description'));
    const baseline = normalizeForDiff({ title: 'A', description: 'x', zeta: 1, alpha: 1 }, DOC);
    const next = normalizeForDiff({ title: 'B', description: 'y', zeta: 2, alpha: 2 }, DOC);
    const { keys } = diffRecord(baseline, next, DOC);
    expect(keys.slice(0, 2)).toEqual(['title', 'description']);
    expect(keys.slice(2)).toEqual(['alpha', 'zeta']);
  });

  it('falls back to alphabetical order with no lexicon', () => {
    const { keys } = diffRecord({ b: 1, a: 1 }, { b: 2, a: 2 }, null);
    expect(keys).toEqual(['a', 'b']);
  });

  it('survives null arguments', () => {
    expect(diffRecord(null, null, null)).toEqual({ dirty: false, keys: [] });
    expect(diffRecord(null, { a: 1 }, null)).toEqual({ dirty: true, keys: ['a'] });
  });
});

describe('labelFields', () => {
  it('maps keys to the labels the form shows', () => {
    expect(labelFields(['title', 'publishedAt'], DOC)).toEqual(['Title', 'Published at']);
  });

  it('falls back to the key for anything the lexicon does not model', () => {
    expect(labelFields(['mysteryField'], DOC)).toEqual(['mysteryField']);
    expect(labelFields(['title'], null)).toEqual(['title']);
  });

  it('returns an empty list for no keys', () => {
    expect(labelFields([], DOC)).toEqual([]);
    expect(labelFields(null, DOC)).toEqual([]);
  });
});
