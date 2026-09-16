// The guard that matters here is the account-identity check. A DID and an app
// password from two different accounts is a plausible copy-paste mistake, login
// succeeds because the password is valid for SOMEONE, and every write afterwards
// lands in a repo nobody meant to touch.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const BOT = 'did:plc:bot';
const OTHER = 'did:plc:someoneelse';

let sessionRow = null;
let loginAs = BOT;

vi.mock('./modDb.js', () => ({
  select: vi.fn(async () => (sessionRow ? [{ session: sessionRow }] : [])),
  upsert: vi.fn(async () => null),
}));

vi.mock('@atproto/api', () => ({
  AtpAgent: class {
    constructor(opts) {
      this.opts = opts;
      this.session = null;
    }
    async login() {
      this.session = { did: loginAs, handle: 'bot.example.com', refreshJwt: 'r' };
      this.opts?.persistSession?.('create', this.session);
      return { data: this.session };
    }
    async resumeSession(session) {
      if (!session?.refreshJwt) throw new Error('dead');
      this.session = { ...session, did: session.did ?? loginAs };
      return { data: this.session };
    }
    withProxy() {
      return this;
    }
  },
}));

const { botAgent } = await import('./botAgent.js');

beforeEach(() => {
  sessionRow = null;
  loginAs = BOT;
  process.env.MOD_IDENTIFIER = BOT;
  process.env.MOD_APP_PASSWORD = 'pw';
});

afterEach(() => {
  delete process.env.MOD_IDENTIFIER;
  delete process.env.MOD_APP_PASSWORD;
});

describe('botAgent', () => {
  it('logs in when there is no stored session', async () => {
    const { agent, via } = await botAgent();
    expect(via).toBe('login');
    expect(agent.session.did).toBe(BOT);
  });

  it('resumes a stored session instead of spending a createSession', async () => {
    // The whole reason this file exists: createSession is capped at 300/day and
    // a ten-minute cron alone would spend 144 of them.
    sessionRow = { did: BOT, refreshJwt: 'r' };
    const { via } = await botAgent();
    expect(via).toBe('resume');
  });

  it('falls back to login when the stored refresh token is dead', async () => {
    sessionRow = { did: BOT };
    const { via } = await botAgent();
    expect(via).toBe('login');
  });

  it('refuses when the password authenticates as a different account', async () => {
    loginAs = OTHER;
    await expect(botAgent()).rejects.toThrow(
      /belong to different accounts/,
    );
  });

  it('refuses a resumed session for a different account too', async () => {
    // A stored session written under an earlier misconfiguration would
    // otherwise sail past the check that only runs on fresh logins.
    sessionRow = { did: OTHER, refreshJwt: 'r' };
    await expect(botAgent()).rejects.toThrow(
      /belong to different accounts/,
    );
  });

  it('accepts a handle identifier, and cannot check it', async () => {
    // Stated so the tradeoff is visible: a handle still works, it just gives up
    // the mismatch guard, which is the argument for storing the DID.
    process.env.MOD_IDENTIFIER = 'bot.example.com';
    loginAs = OTHER;
    const { agent } = await botAgent();
    expect(agent.session.did).toBe(OTHER);
  });

  it('errors clearly when nothing is configured', async () => {
    delete process.env.MOD_IDENTIFIER;
    delete process.env.MOD_APP_PASSWORD;
    await expect(botAgent()).rejects.toThrow(/must be configured/);
  });
});
