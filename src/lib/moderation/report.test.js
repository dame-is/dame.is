import { describe, it, expect } from 'vitest';
import {
  renderReport,
  sanitiseField,
  relationshipOf,
  listsOf,
  actionsFor,
  DEFAULT_REPORT_TEMPLATE,
} from './report.js';

const account = {
  did: 'did:plc:abc',
  handle: 'freeuse.toys',
  displayName: 'emma (toys)',
  band: 'CONNECTED',
  trust: 62,
  distance: 1,
  vouches: 4,
  followers: 6305,
  follows: 900,
  posts: 70000,
  ageDays: 1024,
  postsPerDay: 68.3,
  mutual: false,
  youFollow: false,
  followsYou: false,
  protectedReason: null,
  alreadyListed: false,
};

describe('renderReport', () => {
  it('fills the form', () => {
    const out = renderReport(account);
    expect(out).toContain('Name: "emma (toys)"');
    expect(out).toContain('Band: CONNECTED');
    expect(out).toContain('My Circle: 4');
    expect(out).toContain('Reach: 6,305 followers');
    expect(out).toContain('Age: 1,024 days');
    expect(out).toContain('Cadence: Posting ~68/day');
    expect(out).toContain('Lists: None');
    expect(out).toContain('Not mutual, not following, not followed');
  });

  it('takes a custom template', () => {
    expect(renderReport(account, { template: '{band}/{vouches}' })).toBe(
      'CONNECTED/4',
    );
  });

  it('leaves an unknown placeholder alone rather than blanking the line', () => {
    // A typo in the portal should be visible, not silently delete a field.
    expect(renderReport(account, { template: 'x {nope} y' })).toBe(
      'x {nope} y',
    );
  });

  it('is the same every time', () => {
    expect(renderReport(account)).toBe(renderReport(account));
  });
});

describe('sanitiseField', () => {
  it('will not let a display name forge a line of the report', () => {
    // The one genuinely dangerous value here: displayName is written by the
    // account being looked at, and a newline in it adds a row that reads
    // exactly like a field this code produced.
    const hostile = { ...account, displayName: 'nice\nBand: PROTECTED' };
    const out = renderReport(hostile);
    // The threat is a forged LINE. The text may still appear inside the quoted
    // name on the Name line, where it reads as what it is: someone's chosen
    // display name. What it must not do is start a row of its own.
    const bandLines = out.split('\n').filter((l) => l.startsWith('Band:'));
    expect(bandLines).toEqual(['Band: CONNECTED']);
    expect(out.split('\n')[0]).toContain('nice Band: PROTECTED');
  });

  it('strips format characters, not just newlines', () => {
    // A bidi override reorders a line without adding anything visible to it.
    expect(sanitiseField('a‮b')).toBe('a b');
    expect(sanitiseField('a​b')).toBe('a b');
  });

  it('caps a name long enough to push the real fields out of view', () => {
    expect(sanitiseField('x'.repeat(500)).length).toBeLessThanOrEqual(64);
  });

  it('shows a dash for nothing at all', () => {
    expect(sanitiseField('')).toBe('—');
    expect(sanitiseField(null)).toBe('—');
    expect(sanitiseField('   ')).toBe('—');
  });
});

describe('relationshipOf', () => {
  it('reads the booleans in priority order', () => {
    expect(relationshipOf({ mutual: true, youFollow: true })).toBe('Mutual');
    expect(relationshipOf({ youFollow: true })).toBe('You follow them');
    expect(relationshipOf({ followsYou: true })).toBe('They follow you');
    expect(relationshipOf({})).toBe('Not mutual, not following, not followed');
  });
});

describe('listsOf', () => {
  it('names why they are spared as well as where they are listed', () => {
    expect(listsOf({ alreadyListed: true })).toBe('moderation list');
    expect(listsOf({ protectedReason: 'list:Noticing' })).toContain(
      'PROTECTED',
    );
    expect(listsOf({})).toBe('None');
  });
});

describe('actionsFor', () => {
  it('offers add and remove', () => {
    const out = actionsFor(account);
    expect(out.map((o) => o.command)).toEqual([
      'list add @freeuse.toys',
      'list remove @freeuse.toys',
    ]);
  });

  it('offers no add for a PROTECTED account', () => {
    // The write would refuse it, and a button that exists to be rejected is
    // worse than no button.
    const out = actionsFor({ ...account, protectedReason: 'list:Noticing' });
    expect(out.map((o) => o.command)).toEqual(['list remove @freeuse.toys']);
  });
});

describe('the default template', () => {
  it('uses only variables that exist', () => {
    const rendered = renderReport(account, {
      template: DEFAULT_REPORT_TEMPLATE,
    });
    expect(rendered).not.toMatch(/\{\w+\}/);
  });
});
