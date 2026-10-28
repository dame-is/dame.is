import { describe, it, expect } from 'vitest';
import { navigationTarget } from './leaveGuard.js';

const HERE = new URL('https://dame.is/admin?view=blogging&r=3k');

/** A link as `navigationTarget` reads one: attributes, nothing else. */
function link(attrs) {
  return {
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name) => name in attrs,
  };
}

/** A click whose target sits inside `anchor` (or inside no link at all). */
function click(anchor, extra = {}) {
  return {
    button: 0,
    defaultPrevented: false,
    target: { closest: (selector) => (selector === 'a[href]' ? anchor : null) },
    ...extra,
  };
}

describe('navigationTarget', () => {
  it('resolves a plain in-app link against the current address', () => {
    expect(navigationTarget(click(link({ href: '/' })), HERE)?.href).toBe(
      'https://dame.is/',
    );
    expect(
      navigationTarget(click(link({ href: '?view=now' })), HERE)?.search,
    ).toBe('?view=now');
  });

  it('ignores clicks that are not on a link', () => {
    expect(navigationTarget(click(null), HERE)).toBe(null);
    expect(navigationTarget({ button: 0, target: null }, HERE)).toBe(null);
  });

  it('leaves new tabs, downloads and other windows alone', () => {
    const home = link({ href: '/' });
    expect(navigationTarget(click(home, { metaKey: true }), HERE)).toBe(null);
    expect(navigationTarget(click(home, { ctrlKey: true }), HERE)).toBe(null);
    expect(navigationTarget(click(home, { button: 1 }), HERE)).toBe(null);
    expect(
      navigationTarget(click(link({ href: '/a.json', download: '' })), HERE),
    ).toBe(null);
    expect(
      navigationTarget(click(link({ href: '/', target: '_blank' })), HERE),
    ).toBe(null);
    expect(
      navigationTarget(click(link({ href: '/', target: '_self' })), HERE)?.href,
    ).toBe('https://dame.is/');
  });

  it('leaves a click something already handled alone', () => {
    expect(
      navigationTarget(
        click(link({ href: '/' }), { defaultPrevented: true }),
        HERE,
      ),
    ).toBe(null);
  });

  it('leaves another origin to beforeunload', () => {
    expect(
      navigationTarget(click(link({ href: 'https://bsky.app/' })), HERE),
    ).toBe(null);
  });
});
