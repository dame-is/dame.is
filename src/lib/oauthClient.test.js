import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  CLIENT_SCOPE,
  GUESTBOOK_SCOPE,
  OWNER_SCOPE,
  PLAY_SCOPE,
  REACTION_SCOPE,
  buildLoopbackClientId,
  callbackErrorMessage,
  playScopeForAccount,
  reactionScopeForAccount,
  scopeForAccount,
  signInErrorMessage,
} from './oauthClient.js';
import { scopeAllowsCollection, scopeAllowsReaction } from './experiments.js';
import { ME_DID, SUNFARMING_RESULT_NSID } from '../config.js';

describe('buildLoopbackClientId', () => {
  it('names a 127.0.0.1 redirect even when the dev server was opened at localhost', () => {
    const id = new URL(
      buildLoopbackClientId('http://localhost:5206', '/oauth/callback'),
    );
    expect(id.origin).toBe('http://localhost');
    expect(id.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:5206/oauth/callback',
    );
  });

  it('declares every scope a sign-in may narrow to', () => {
    const id = new URL(
      buildLoopbackClientId('http://127.0.0.1:4173', '/oauth/callback'),
    );
    expect(id.searchParams.get('scope')).toBe(CLIENT_SCOPE);
    for (const token of [
      ...OWNER_SCOPE.split(' '),
      ...GUESTBOOK_SCOPE.split(' '),
      ...REACTION_SCOPE.split(' '),
      ...PLAY_SCOPE.split(' '),
    ]) {
      expect(CLIENT_SCOPE.split(' ')).toContain(token);
    }
  });

  it('declares the same scope the production metadata serves', () => {
    // api/client-metadata.js is a serverless function with the string written
    // out again; an authorization server checks every sign-in against what it
    // serves, so one that lagged behind would refuse the newer grants.
    const served = readFileSync(
      new URL('../../api/client-metadata.js', import.meta.url),
      'utf8',
    );
    expect(served).toContain(`'${CLIENT_SCOPE}'`);
  });
});

describe('reactionScopeForAccount', () => {
  it('lets a visitor write reactions, and still their guestbook signature', () => {
    const scope = reactionScopeForAccount('someone.bsky.social');
    expect(scope).toBe(REACTION_SCOPE);
    expect(scopeAllowsReaction(scope)).toBe(true);
    // Everything the guestbook grant holds, so reacting never costs a signer
    // the "remove" on their signature.
    for (const token of GUESTBOOK_SCOPE.split(' ')) {
      expect(scope.split(' ')).toContain(token);
    }
  });

  it('never narrows the owner’s session', () => {
    expect(reactionScopeForAccount('dame.is')).toBe(OWNER_SCOPE);
    expect(reactionScopeForAccount(ME_DID)).toBe(OWNER_SCOPE);
  });

  it('is more than the guestbook grant, which cannot write a reaction', () => {
    expect(scopeAllowsReaction(GUESTBOOK_SCOPE)).toBe(false);
  });
});

describe('playScopeForAccount', () => {
  it('lets a visitor post a Sunfarming result, and keeps what they could already do', () => {
    const scope = playScopeForAccount('someone.bsky.social');
    expect(scope).toBe(PLAY_SCOPE);
    expect(scopeAllowsCollection(scope, SUNFARMING_RESULT_NSID)).toBe(true);
    for (const token of REACTION_SCOPE.split(' ')) {
      expect(scope.split(' ')).toContain(token);
    }
    expect(scopeAllowsReaction(scope)).toBe(true);
  });

  it('never narrows the owner’s session', () => {
    expect(playScopeForAccount('dame.is')).toBe(OWNER_SCOPE);
    expect(playScopeForAccount(ME_DID)).toBe(OWNER_SCOPE);
  });

  it('is more than the reaction grant, which cannot write a result', () => {
    expect(scopeAllowsCollection(REACTION_SCOPE, SUNFARMING_RESULT_NSID)).toBe(false);
    expect(scopeAllowsCollection(OWNER_SCOPE, SUNFARMING_RESULT_NSID)).toBe(true);
  });
});

describe('scopeForAccount', () => {
  it('gives the owner the broad scope and everyone else the guestbook one', () => {
    expect(scopeForAccount('dame.is')).toBe(OWNER_SCOPE);
    expect(scopeForAccount('@Dame.is')).toBe(OWNER_SCOPE);
    expect(scopeForAccount(ME_DID)).toBe(OWNER_SCOPE);
    expect(scopeForAccount('someone.bsky.social')).toBe(GUESTBOOK_SCOPE);
    expect(scopeForAccount('')).toBe(GUESTBOOK_SCOPE);
  });
});

describe('signInErrorMessage', () => {
  it('turns an unresolvable handle into advice about the handle', () => {
    const err = new Error(
      'Failed to resolve identity: nobody-at-all.bsky.social',
    );
    expect(signInErrorMessage(err)).toMatch(/Couldn’t find that account/);
  });

  it('tells an unreachable server from a bad handle', () => {
    expect(signInErrorMessage(new TypeError('Failed to fetch'))).toMatch(
      /Couldn’t reach/,
    );
    expect(
      signInErrorMessage(
        new Error('Failed to resolve OAuth server metadata for issuer: x'),
      ),
    ).toMatch(/isn’t accepting sign-ins/);
  });

  it('never shows the library’s own text for anything else', () => {
    const zod = new Error(
      '[{"code":"invalid_type","expected":"object","received":"string"}]',
    );
    expect(signInErrorMessage(zod)).toBe(
      'Sign-in couldn’t start. Check the handle and try again.',
    );
    expect(signInErrorMessage(undefined)).toBe(
      'Sign-in couldn’t start. Check the handle and try again.',
    );
  });
});

describe('callbackErrorMessage', () => {
  it('says plainly when access was declined', () => {
    const err = Object.assign(new Error('Access denied'), {
      params: new URLSearchParams({ error: 'access_denied' }),
    });
    expect(callbackErrorMessage(err)).toMatch(/Access wasn’t granted/);
  });

  it('falls back to a general sentence', () => {
    expect(
      callbackErrorMessage(new Error('Unknown authorization session "x"')),
    ).toMatch(/didn’t finish/);
    expect(callbackErrorMessage(null)).toMatch(/didn’t finish/);
  });
});
