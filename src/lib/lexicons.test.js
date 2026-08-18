import { describe, it, expect } from 'vitest';
import {
  LEXICONS,
  lexiconFor,
  blankRecordFor,
  emptyLeafletContent,
  hasLeafletContent,
} from './lexicons.js';
import { COLLECTIONS } from '../config.js';
// Imported HERE and not in lexicons.js: the module itself must stay free of JSX
// component imports (see the note on the photoLayout options), which is exactly
// why the duplicated list needs a test holding the two in step.
import { GALLERY_LAYOUTS } from '../components/LeafletDocument.jsx';

const text = (plaintext) => ({
  $type: 'pub.leaflet.pages.linearDocument#block',
  block: { $type: 'pub.leaflet.blocks.text', plaintext },
});

const image = () => ({
  $type: 'pub.leaflet.pages.linearDocument#block',
  block: { $type: 'pub.leaflet.blocks.image', image: { $type: 'blob' } },
});

const content = (blocks) => ({
  $type: 'pub.leaflet.content',
  pages: [{ $type: 'pub.leaflet.pages.linearDocument', blocks }],
});

describe('hasLeafletContent', () => {
  // The distinction that matters: a `blocks` field is never absent once the
  // record has been opened in the editor, because blankRecordFor seeds it. If
  // "present" counted as "written", /themself would render an empty paragraph
  // AND suppress the markdown body underneath it.
  it('rejects the blank shell blankRecordFor seeds', () => {
    expect(hasLeafletContent(emptyLeafletContent())).toBe(false);
    expect(hasLeafletContent(blankRecordFor(COLLECTIONS.profile).content)).toBe(false);
  });

  it('rejects nothing at all', () => {
    expect(hasLeafletContent(null)).toBe(false);
    expect(hasLeafletContent(undefined)).toBe(false);
    expect(hasLeafletContent({})).toBe(false);
    expect(hasLeafletContent(content([]))).toBe(false);
  });

  it('rejects text blocks that are only whitespace', () => {
    expect(hasLeafletContent(content([text(''), text('   \n ')]))).toBe(false);
  });

  it('accepts a text block with words in it', () => {
    expect(hasLeafletContent(content([text(''), text('hello')]))).toBe(true);
  });

  // An image says something without carrying any text, so a body that is
  // nothing but photos still counts as written.
  it('accepts a non-text block even with no text anywhere', () => {
    expect(hasLeafletContent(content([text(''), image()]))).toBe(true);
  });
});

describe('is.dame.profile form definition', () => {
  const lex = lexiconFor(COLLECTIONS.profile);
  const keys = lex.fields.map((f) => f.key);

  // The form wrote `bio` while the lexicon, /themself and the OG builder all
  // read `body`, so anything typed in the admin rendered nowhere. Pinning the
  // key here stops that drifting apart again.
  it('writes the body to the key the site reads', () => {
    expect(keys).toContain('body');
    expect(keys).not.toContain('bio');
  });

  it('folds a stranded legacy `bio` into `body` on open', () => {
    expect(lex.migrate({ bio: 'the old text' })).toEqual({
      bio: 'the old text',
      body: 'the old text',
    });
  });

  it('leaves an already-migrated record alone', () => {
    const already = { bio: 'old', body: 'new' };
    expect(lex.migrate(already)).toBe(already);
    expect(lex.migrate({ body: 'new' })).toEqual({ body: 'new' });
  });

  it('drops the legacy key on save', () => {
    expect(lex.stripLegacyKeys).toContain('bio');
  });

  it('offers the photo gallery, the block body and the three visibility flags', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'photos',
        'photoLayout',
        'content',
        'showAvatar',
        'showIdentity',
        'showBlueskyBio',
      ]),
    );
  });

  // Absent must read as "show it" on the page, so a record written before the
  // flags existed hides nothing. blankRecordFor stamps them true anyway, so a
  // NEW record says so explicitly rather than relying on that reading.
  it('defaults every visibility flag to on for a new record', () => {
    const blank = blankRecordFor(COLLECTIONS.profile);
    expect(blank.showAvatar).toBe(true);
    expect(blank.showIdentity).toBe(true);
    expect(blank.showBlueskyBio).toBe(true);
  });

  it('marks the legacy markdown body as superseded by the block body', () => {
    const body = lex.fields.find((f) => f.key === 'body');
    expect(body.supersededBy).toBe('content');
    // The field it names has to exist, or the preview would silently never skip.
    expect(keys).toContain(body.supersededBy);
  });

  // The photo layout dropdown and the blocks editor's gallery control are two
  // views of one vocabulary — a value here that LeafletDocument doesn't know
  // would publish a gallery that reads as the default instead.
  it('offers exactly the gallery layouts the renderer understands', () => {
    const layout = lex.fields.find((f) => f.key === 'photoLayout');
    expect(layout.options.map((o) => o.value)).toEqual(GALLERY_LAYOUTS.map((l) => l.value));
    expect(layout.default).toBe('two-up');
  });
});

describe('LEXICONS field shapes', () => {
  // Every field the record editor renders needs a key it can write to and a
  // label to render; a typo in either fails silently as a blank form row.
  it('gives every field in every lexicon a key and a label', () => {
    for (const [nsid, lex] of Object.entries(LEXICONS)) {
      for (const f of lex.fields || []) {
        expect(f.key, `${nsid} field key`).toBeTruthy();
        expect(f.label, `${nsid}.${f.key} label`).toBeTruthy();
      }
    }
  });

  it('never names a supersededBy field that the lexicon does not have', () => {
    for (const [nsid, lex] of Object.entries(LEXICONS)) {
      const keys = new Set((lex.fields || []).map((f) => f.key));
      for (const f of lex.fields || []) {
        if (f.supersededBy) expect(keys, `${nsid}.${f.key}`).toContain(f.supersededBy);
      }
    }
  });
});
