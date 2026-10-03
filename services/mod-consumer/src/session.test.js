import { describe, it, expect, vi } from 'vitest';

import { isAuthError, createReconnector } from './session.js';

describe('noticing a dead session', () => {
  it('reads the ways the PDS and the library say so', () => {
    expect(isAuthError(new Error('Authentication Required'))).toBe(true);
    expect(isAuthError({ status: 401, message: 'whatever' })).toBe(true);
    expect(
      isAuthError({ error: 'ExpiredToken', message: 'Token has expired' }),
    ).toBe(true);
    expect(isAuthError(new Error('fetch failed'))).toBe(false);
    expect(isAuthError(new Error('Upstream Failure'))).toBe(false);
    expect(isAuthError(null)).toBe(false);
  });
});

describe('getting it back', () => {
  it('reconnects once however many jobs notice', async () => {
    const connect = vi.fn(async () => ({ via: 'login' }));
    const log = vi.fn();
    const r = createReconnector({ connect, log });
    await Promise.all([r.reconnect('a'), r.reconnect('b'), r.reconnect('c')]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      'info',
      'Re-established the moderator session',
      expect.objectContaining({ via: 'login', reason: 'a' }),
    );
  });

  it('backs off after a failure, doubling up to the cap', async () => {
    let t = 0;
    const connect = vi
      .fn()
      .mockRejectedValue(new Error('Invalid identifier or password'));
    const r = createReconnector({
      connect,
      now: () => t,
      firstWaitMs: 1000,
      maxWaitMs: 3000,
    });
    await r.reconnect('x');
    expect(r.reconnect('x')).toBe(null);
    t = 1000;
    await r.reconnect('x');
    t = 2999;
    expect(r.reconnect('x')).toBe(null);
    t = 3000;
    await r.reconnect('x');
    expect(connect).toHaveBeenCalledTimes(3);
    expect(r.failures()).toBe(3);
    connect.mockResolvedValueOnce({ via: 'resume' });
    t = 6000;
    await r.reconnect('x');
    expect(r.failures()).toBe(0);
  });
});
