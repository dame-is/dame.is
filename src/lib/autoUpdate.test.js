// The deploy auto-updater's two decisions. A wrong "busy" answer either
// reloads a page out from under someone (a playing video, a half-written
// guestbook note) or pins a tab on a stale build; a wrong reload answer is a
// reload loop.

import { describe, expect, it, vi } from 'vitest';
import {
  RELOAD_TARGET_KEY,
  attemptReload,
  documentIsBusy,
} from './autoUpdate.js';

function fakeDoc({
  active = null,
  media = [],
  dialog = false,
  fields = [],
} = {}) {
  return {
    activeElement: active,
    querySelectorAll: (sel) => (sel === 'textarea' ? fields : media),
    querySelector: () => (dialog ? {} : null),
  };
}

function fakeWin() {
  const listeners = {};
  return {
    reload: vi.fn(),
    location: {
      reload() {
        this.owner.reload();
      },
    },
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    setTimeout: vi.fn(),
    fire: (type) => listeners[type]?.(),
  };
}

function setup() {
  const win = fakeWin();
  win.location.owner = win;
  const items = {};
  const storage = {
    getItem: (k) => (k in items ? items[k] : null),
    setItem: (k, v) => {
      items[k] = v;
    },
  };
  return { win, storage, items };
}

describe('documentIsBusy', () => {
  it('is idle on a page being read', () => {
    expect(documentIsBusy(fakeDoc({ active: { tagName: 'BODY' } }))).toBe(
      false,
    );
  });

  it('is busy while a field or an embedded player has focus', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'IFRAME', 'VIDEO']) {
      expect(documentIsBusy(fakeDoc({ active: { tagName } })), tagName).toBe(
        true,
      );
    }
    const editable = { tagName: 'DIV', isContentEditable: true };
    expect(documentIsBusy(fakeDoc({ active: editable }))).toBe(true);
  });

  it('is busy while media plays, focused or not', () => {
    const playing = { paused: false, ended: false };
    const finished = { paused: false, ended: true };
    expect(documentIsBusy(fakeDoc({ media: [playing] }))).toBe(true);
    expect(documentIsBusy(fakeDoc({ media: [finished] }))).toBe(false);
  });

  it('is busy while a sheet or modal is open', () => {
    expect(documentIsBusy(fakeDoc({ dialog: true }))).toBe(true);
  });

  it('is busy while a text field holds unsent words, even without focus', () => {
    expect(documentIsBusy(fakeDoc({ fields: [{ value: 'hi dame' }] }))).toBe(
      true,
    );
    expect(documentIsBusy(fakeDoc({ fields: [{ value: '  \n' }] }))).toBe(
      false,
    );
  });

  it('ignores text a reader cannot edit', () => {
    const shown = [
      { value: '{ "text": "hi" }', readOnly: true },
      { value: 'locked', disabled: true },
    ];
    expect(documentIsBusy(fakeDoc({ fields: shown }))).toBe(false);
  });
});

describe('attemptReload', () => {
  it('reloads to a new build and records it only as the page unloads', () => {
    const { win, storage, items } = setup();
    const ok = attemptReload('b2', {
      isSafe: () => true,
      win,
      storage,
      volatile: false,
    });
    expect(ok).toBe(true);
    expect(win.reload).toHaveBeenCalledTimes(1);
    // Not yet: a "Leave site?" Cancel must not spend this build's attempt.
    expect(items[RELOAD_TARGET_KEY]).toBeUndefined();
    win.fire('pagehide');
    expect(items[RELOAD_TARGET_KEY]).toBe('b2');
  });

  it('never reloads twice to the same build', () => {
    const { win, storage, items } = setup();
    items[RELOAD_TARGET_KEY] = 'b2';
    const ok = attemptReload('b2', {
      isSafe: () => true,
      win,
      storage,
      volatile: false,
    });
    expect(ok).toBe(false);
    expect(win.reload).not.toHaveBeenCalled();
  });

  it('defers while the page is busy', () => {
    const { win, storage } = setup();
    const ok = attemptReload('b2', {
      isSafe: () => false,
      win,
      storage,
      volatile: false,
    });
    expect(ok).toBe(false);
    expect(win.reload).not.toHaveBeenCalled();
  });

  it('does not reload at all when the loop guard could not survive it', () => {
    const { win, storage } = setup();
    const ok = attemptReload('b2', {
      isSafe: () => true,
      win,
      storage,
      volatile: true,
    });
    expect(ok).toBe(false);
    expect(win.reload).not.toHaveBeenCalled();
  });

  it('reports a page that is still here after asking to reload', () => {
    const { win, storage } = setup();
    const onStillHere = () => {};
    attemptReload('b2', {
      isSafe: () => true,
      win,
      storage,
      volatile: false,
      onStillHere,
    });
    expect(win.setTimeout).toHaveBeenCalledWith(
      onStillHere,
      expect.any(Number),
    );
  });
});
