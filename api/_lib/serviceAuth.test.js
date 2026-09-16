// Auth code, so the tests are adversarial rather than illustrative: every case
// below is a way in that must stay shut. A green run here is the only thing
// standing between a public URL and the moderation log.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Secp256k1Keypair } from '@atproto/crypto';
import { verifyServiceAuth, authorize } from './serviceAuth.js';
import { ME_DID } from '../../src/config.js';

let owner;
let attacker;

/** Mint a token the way a PDS would, so the test signs the real bytes. */
async function mint(
  keypair,
  { iss = ME_DID, aud = ME_DID, lxm, expInSec = 60, alg = 'ES256K' } = {},
) {
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({
      iss,
      aud,
      exp: Math.floor(Date.now() / 1000) + expInSec,
      ...(lxm ? { lxm } : {}),
    }),
  ).toString('base64url');
  const sig = await keypair.sign(
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${Buffer.from(sig).toString('base64url')}`;
}

/** A PLC directory that publishes `keypair` as ME_DID's atproto key. */
function plcServing(keypair) {
  return vi.fn(async () => ({
    ok: true,
    json: async () => ({
      verificationMethod: [
        {
          id: `${ME_DID}#atproto`,
          type: 'Multikey',
          publicKeyMultibase: keypair.did().replace('did:key:', ''),
        },
      ],
    }),
  }));
}

beforeAll(async () => {
  owner = await Secp256k1Keypair.create({ exportable: true });
  attacker = await Secp256k1Keypair.create({ exportable: true });
});

describe('verifyServiceAuth', () => {
  it('accepts a token signed by the key in the DID document', async () => {
    const token = await mint(owner);
    const payload = await verifyServiceAuth(token, {
      fetchImpl: plcServing(owner),
    });
    expect(payload.iss).toBe(ME_DID);
  });

  it('rejects a token signed by a different key', async () => {
    // The whole attack: right shape, right claims, wrong signer.
    const token = await mint(attacker);
    await expect(
      verifyServiceAuth(token, { fetchImpl: plcServing(owner) }),
    ).rejects.toThrow(/bad signature/);
  });

  it('rejects a payload edited after signing', async () => {
    // The edit has to survive every cheap check to actually exercise the
    // signature, so it adds a claim rather than moving `exp` — stretching the
    // expiry is caught by the lifetime ceiling first, which is the next test.
    const token = await mint(owner, { expInSec: 60 });
    const [h, p, s] = token.split('.');
    const tampered = JSON.parse(Buffer.from(p, 'base64url').toString());
    tampered.scope = 'admin';
    const forged = Buffer.from(JSON.stringify(tampered)).toString('base64url');
    await expect(
      verifyServiceAuth(`${h}.${forged}.${s}`, {
        fetchImpl: plcServing(owner),
      }),
    ).rejects.toThrow(/bad signature/);
  });

  it('catches a stretched expiry before spending a signature check on it', async () => {
    const token = await mint(owner, { expInSec: 60 });
    const [h, p, s] = token.split('.');
    const tampered = JSON.parse(Buffer.from(p, 'base64url').toString());
    tampered.exp += 3600;
    const forged = Buffer.from(JSON.stringify(tampered)).toString('base64url');
    const plc = plcServing(owner);
    await expect(
      verifyServiceAuth(`${h}.${forged}.${s}`, { fetchImpl: plc }),
    ).rejects.toThrow(/lifetime/);
    // Rejected without resolving the DID document at all: the cheap checks run
    // first so a flood of junk tokens cannot be turned into a flood of PLC
    // lookups and secp256k1 verifications.
    expect(plc).not.toHaveBeenCalled();
  });

  it('rejects an issuer who is not the site owner', async () => {
    const token = await mint(owner, { iss: 'did:plc:someoneelse' });
    await expect(
      verifyServiceAuth(token, { fetchImpl: plcServing(owner) }),
    ).rejects.toThrow(/issuer is not the site owner/);
  });

  it('rejects a token minted for a different service', async () => {
    // Replay: a valid token dame minted for some other audience must not work
    // here just because dame signed it.
    const token = await mint(owner, { aud: 'did:web:api.bsky.app' });
    await expect(
      verifyServiceAuth(token, { fetchImpl: plcServing(owner) }),
    ).rejects.toThrow(/not minted for this service/);
  });

  it('rejects an expired token', async () => {
    const token = await mint(owner, { expInSec: -1 });
    await expect(
      verifyServiceAuth(token, { fetchImpl: plcServing(owner) }),
    ).rejects.toThrow(/expired/);
  });

  it('rejects a token with an implausibly long life', async () => {
    const token = await mint(owner, { expInSec: 60 * 60 * 24 * 365 });
    await expect(
      verifyServiceAuth(token, { fetchImpl: plcServing(owner) }),
    ).rejects.toThrow(/lifetime/);
  });

  it('enforces the lxm scope when the endpoint asks for one', async () => {
    const token = await mint(owner, { lxm: 'is.dame.mod.preflight' });
    await expect(
      verifyServiceAuth(token, {
        lxm: 'is.dame.mod.settings',
        fetchImpl: plcServing(owner),
      }),
    ).rejects.toThrow(/scoped to/);
    await expect(
      verifyServiceAuth(token, {
        lxm: 'is.dame.mod.preflight',
        fetchImpl: plcServing(owner),
      }),
    ).resolves.toMatchObject({ lxm: 'is.dame.mod.preflight' });
  });

  it('rejects an alg that disagrees with the published key', async () => {
    const token = await mint(owner, { alg: 'HS256' });
    await expect(
      verifyServiceAuth(token, { fetchImpl: plcServing(owner) }),
    ).rejects.toThrow(/does not match the published key/);
  });

  it('rejects anything that is not three segments', async () => {
    for (const bad of ['', 'abc', 'a.b', 'a.b.c.d']) {
      await expect(
        verifyServiceAuth(bad, { fetchImpl: plcServing(owner) }),
      ).rejects.toThrow();
    }
  });
});

describe('authorize', () => {
  const resStub = () => {
    const res = { code: null, body: null };
    res.status = (c) => ((res.code = c), res);
    res.json = (b) => ((res.body = b), res);
    return res;
  };

  it('fails closed when no credential is presented', async () => {
    const res = resStub();
    expect(await authorize({ headers: {} }, res)).toBeNull();
    expect(res.code).toBe(401);
  });

  it('fails closed when CRON_SECRET is unset, rather than opening up', async () => {
    // A preview deployment with no env vars must not be a public endpoint.
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const res = resStub();
    expect(await authorize({ headers: {} }, res)).toBeNull();
    expect(res.code).toBe(401);
    if (prev !== undefined) process.env.CRON_SECRET = prev;
  });

  it('accepts the cron secret when it matches exactly', async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'a-long-random-string';
    const res = resStub();
    const kind = await authorize(
      { headers: { authorization: 'Bearer a-long-random-string' } },
      res,
    );
    expect(kind).toBe('cron');
    if (prev === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = prev;
  });
});
