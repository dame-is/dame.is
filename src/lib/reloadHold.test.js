// The work-in-progress signal between long jobs and the deploy auto-updater.
// Small, but a bug in either direction is expensive: a hold that never
// registers lets a deploy reload the tab mid-archive-build, and a hold that
// never clears pins the tab on a stale build forever.

import { describe, expect, it } from 'vitest';
import { holdReload, isReloadHeld } from './reloadHold.js';

describe('reloadHold', () => {
  it('holds while a job runs and clears when released', () => {
    expect(isReloadHeld()).toBe(false);
    const release = holdReload('test-job');
    expect(isReloadHeld()).toBe(true);
    release();
    expect(isReloadHeld()).toBe(false);
  });

  it('keeps holding until EVERY overlapping job releases — same label included', () => {
    const a = holdReload('sweep');
    const b = holdReload('sweep');
    a();
    expect(isReloadHeld()).toBe(true);
    b();
    expect(isReloadHeld()).toBe(false);
  });

  it('treats a double release as a no-op, not a theft of someone else’s hold', () => {
    const a = holdReload('one');
    const b = holdReload('two');
    a();
    a();
    expect(isReloadHeld()).toBe(true);
    b();
    expect(isReloadHeld()).toBe(false);
  });
});
