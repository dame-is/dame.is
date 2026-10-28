// Both mirror crons log in with the app password and write to the PDS, so
// who may start one is the whole question. An unset CRON_SECRET used to mean
// anybody; it now means nobody, the way api/rebuild.js already worked.

import { describe, it, expect, vi, afterEach } from 'vitest';
import mirrorArena from './mirror-arena.js';
import mirrorMothing from './mirror-mothing.js';

function mockRes() {
  const res = { statusCode: 200, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

const call = async (handler, authorization) => {
  const res = mockRes();
  await handler({ headers: authorization ? { authorization } : {} }, res);
  return res;
};

afterEach(() => vi.unstubAllEnvs());

describe.each([
  ['mirror-arena', mirrorArena],
  ['mirror-mothing', mirrorMothing],
])('/api/%s', (_name, handler) => {
  it('refuses everybody when CRON_SECRET is unset', async () => {
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('BSKY_APP_PASSWORD', 'app-password');
    expect((await call(handler)).statusCode).toBe(401);
    expect((await call(handler, 'Bearer ')).statusCode).toBe(401);
  });

  it('refuses the wrong bearer', async () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    expect((await call(handler, 'Bearer not-it')).statusCode).toBe(401);
  });

  it('lets the right bearer through to the next check', async () => {
    vi.stubEnv('CRON_SECRET', 'the-secret');
    // With no app password configured the run stops at the very next guard,
    // which is all this needs to show: auth said yes.
    vi.stubEnv('BSKY_APP_PASSWORD', '');
    vi.stubEnv('ATP_APP_PASSWORD', '');
    const res = await call(handler, 'Bearer the-secret');
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/BSKY_APP_PASSWORD/);
  });
});
