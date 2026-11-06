import { describe, it, expect } from 'vitest';
import {
  findResumeBySlug,
  mendSkillItems,
  pickDefaultResume,
  printableUrl,
  resolveResume,
  resolveServices,
  SERVICES_NOTE,
  splitTags,
} from './resumeHelpers.js';

const resume = (rkey, value) => ({
  uri: `at://did:plc:test/is.dame.resume/${rkey}`,
  value: { slug: rkey, ...value },
});

describe('résumé visibility', () => {
  const unset = resume('unset', {});
  const priv = resume('priv', { visibility: 'private' });
  const unlisted = resume('unlisted', { visibility: 'unlisted' });
  const pub = resume('pub', { visibility: 'public' });

  it('reads a missing visibility as private, as the lexicon and admin do', () => {
    expect(pickDefaultResume([unset])).toBeNull();
    expect(findResumeBySlug([unset], 'unset')).toBeNull();
  });

  it('never renders a private version, even by slug', () => {
    expect(findResumeBySlug([priv], 'priv')).toBeNull();
  });

  it('keeps an unlisted version reachable by slug', () => {
    expect(findResumeBySlug([unlisted, pub], 'unlisted')).toBe(unlisted);
  });

  it('prefers a public version over an unlisted one as the default', () => {
    expect(pickDefaultResume([unset, unlisted, pub])).toBe(pub);
  });

  it('honours the featured flag on any renderable version', () => {
    const featured = resume('feat', { visibility: 'unlisted', featured: true });
    expect(pickDefaultResume([pub, featured])).toBe(featured);
    expect(
      pickDefaultResume([pub, { ...featured, value: { featured: true } }]),
    ).toBe(pub);
  });
});

describe('splitTags', () => {
  it('splits on commas outside parentheses only', () => {
    expect(splitTags('browser extensions (Chrome, Firefox), MV3')).toEqual([
      'browser extensions (Chrome, Firefox)',
      'MV3',
    ]);
    expect(splitTags('a (b, c), d')).toEqual(['a (b, c)', 'd']);
  });

  it('trims and drops empties', () => {
    expect(splitTags(' a ,, b , ')).toEqual(['a', 'b']);
    expect(splitTags('')).toEqual([]);
  });

  it('lets an unclosed paren split normally', () => {
    expect(splitTags('a (b, c')).toEqual(['a (b', 'c']);
  });
});

describe('mendSkillItems', () => {
  it('rejoins a parenthetical a plain comma split cut in two', () => {
    expect(
      mendSkillItems([
        'React',
        'browser extensions (Chrome',
        'Firefox)',
        'CSS',
      ]),
    ).toEqual(['React', 'browser extensions (Chrome, Firefox)', 'CSS']);
  });

  it('rejoins across more than one cut', () => {
    expect(mendSkillItems(['x (a', 'b', 'c)'])).toEqual(['x (a, b, c)']);
  });

  it('leaves an opening paren that never closes as it is', () => {
    expect(mendSkillItems(['x (a', 'b'])).toEqual(['x (a', 'b']);
  });

  it('passes well-formed items through and tolerates junk', () => {
    expect(mendSkillItems(['a (b)', 'c'])).toEqual(['a (b)', 'c']);
    expect(mendSkillItems(undefined)).toEqual([]);
    expect(mendSkillItems(['a', null, 3])).toEqual(['a']);
  });

  it('is what resolveResume hands the page', () => {
    const r = resume('pub', {
      visibility: 'public',
      skills: [
        {
          category: 'Engineering',
          items: ['browser extensions (Chrome', 'Firefox)'],
        },
      ],
    });
    expect(resolveResume(r, [], [], []).skills).toEqual([
      {
        category: 'Engineering',
        items: ['browser extensions (Chrome, Firefox)'],
      },
    ]);
  });
});

describe('printableUrl', () => {
  it('drops the scheme, www and a trailing slash', () => {
    expect(printableUrl('https://dame.is')).toBe('dame.is');
    expect(printableUrl('https://www.dame.is/')).toBe('dame.is');
    expect(printableUrl('https://bsky.app/profile/dame.is')).toBe(
      'bsky.app/profile/dame.is',
    );
  });

  it('is empty for anything that is not an http(s) URL', () => {
    expect(printableUrl('mailto:resume@dame.is')).toBe('');
    expect(printableUrl('')).toBe('');
    expect(printableUrl(null)).toBe('');
  });
});

describe('resolveServices', () => {
  it('shows nothing when the version offers nothing', () => {
    expect(resolveServices(undefined)).toBeNull();
    expect(resolveServices({ items: [] })).toBeNull();
    expect(resolveServices({ note: 'Hire me', items: ['  ', ''] })).toBeNull();
  });

  it('trims and dedupes the items, keeping their order', () => {
    const s = resolveServices({ items: [' atproto ', 'branding', 'atproto', 7] });
    expect(s.items).toEqual(['atproto', 'branding']);
  });

  it('falls back to the built-in line when the note is blank', () => {
    expect(resolveServices({ items: ['atproto'] }).note).toBe(SERVICES_NOTE);
    expect(resolveServices({ note: '  ', items: ['atproto'] }).note).toBe(SERVICES_NOTE);
    expect(resolveServices({ note: 'Taking on a few projects.', items: ['atproto'] }).note).toBe(
      'Taking on a few projects.',
    );
  });

  it('mails its own address first, then the contact email, else no button', () => {
    const own = resolveServices(
      { items: ['atproto'], email: 'work@example.com' },
      { email: 'resume@example.com' },
    );
    expect(own.href).toMatch(/^mailto:work@example\.com\?subject=/);
    const fallback = resolveServices({ items: ['atproto'] }, { email: 'resume@example.com' });
    expect(fallback.href).toMatch(/^mailto:resume@example\.com\?subject=/);
    expect(resolveServices({ items: ['atproto'] }, null).href).toBeNull();
  });

  it('comes through resolveResume with the version', () => {
    const r = resume('primary', {
      visibility: 'public',
      services: { items: ['atproto'] },
      contact: { email: 'resume@example.com' },
    });
    expect(resolveResume(r, [], []).services.items).toEqual(['atproto']);
    expect(resolveResume(resume('bare', {}), [], []).services).toBeNull();
  });
});
