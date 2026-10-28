import { describe, expect, it } from 'vitest';
import {
  CLIENT_SCOPE,
  GUESTBOOK_SCOPE,
  OWNER_SCOPE,
  buildLoopbackClientId,
  callbackErrorMessage,
  scopeForAccount,
  signInErrorMessage,
} from './oauthClient.js';
import { ME_DID } from '../config.js';

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
    ]) {
      expect(CLIENT_SCOPE.split(' ')).toContain(token);
    }
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
