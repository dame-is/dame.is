import { describe, it, expect } from 'vitest';
import {
  emailAction,
  emailRedirect,
  hasSignupBlock,
  isReturnTo,
  isSubscribeLink,
  isSubscribePath,
  returnCookie,
  returnLocation,
  RETURN_COOKIE,
  SIGNUP_BLOCK_TYPE,
  signupBlockIds,
  SUBSCRIBE_PATH,
  SUBSCRIBE_URL,
  withoutReturnMarker,
} from './newsletter.js';
import { isRecordRoute } from '../../og/records.js';
import { matchRoute } from '../../og/routes.js';
import { BLOG_PUBLICATION } from '../config.js';

const wrap = (block) => ({ $type: 'pub.leaflet.pages.linearDocument#block', block });
const text = (plaintext) => wrap({ $type: 'pub.leaflet.blocks.text', plaintext });
const signup = () => wrap({ $type: SIGNUP_BLOCK_TYPE });

describe('emailAction', () => {
  it('is the subscribe action Leaflet parses, encoded once', () => {
    const action = emailAction();
    expect(JSON.parse(decodeURIComponent(action))).toEqual({
      action: 'subscribe',
      publication: BLOG_PUBLICATION,
      source: { placement: 'embed' },
    });
    expect(action).not.toContain('{');
  });
});

describe('emailRedirect', () => {
  it('points at the form on the page it sits on', () => {
    expect(emailRedirect('https://dame.is', '/blogging/3abc', 'subscribe-2')).toBe(
      'https://dame.is/blogging/3abc#subscribe-2',
    );
  });
});

describe('returnCookie', () => {
  it('keeps the path and the form, for the return route only', () => {
    const cookie = returnCookie('https://dame.is/blogging/3abc#subscribe');
    expect(cookie).toBe(
      `${RETURN_COOKIE}=${encodeURIComponent('/blogging/3abc#subscribe')}; Path=/receive_auth_callback; Max-Age=86400; SameSite=Lax; Secure`,
    );
  });

  it('leaves Secure off for a plain-http dev server', () => {
    expect(returnCookie('http://localhost:5173/blogging#subscribe', { secure: false })).not.toContain('Secure');
  });

  it('gives nothing for a redirect that is not a URL', () => {
    expect(returnCookie('not a url')).toBeNull();
  });
});

describe('returnLocation', () => {
  const cookie = (path) => `other=1; ${RETURN_COOKIE}=${encodeURIComponent(path)}`;

  it('sends the reader back to the form they used, marked', () => {
    expect(returnLocation(cookie('/blogging/3abc#subscribe-2'))).toBe(
      '/blogging/3abc?subscribed=email#subscribe-2',
    );
  });

  it('falls back to the newsletter page’s form without a cookie', () => {
    expect(returnLocation(undefined)).toBe('/blogging/subscribe?subscribed=email#subscribe');
    expect(returnLocation('other=1')).toBe('/blogging/subscribe?subscribed=email#subscribe');
  });

  it('never leaves the site', () => {
    for (const path of ['//evil.example/x', 'https://evil.example/x', 'javascript:alert(1)']) {
      expect(returnLocation(cookie(path))).toBe('/blogging/subscribe?subscribed=email#subscribe');
    }
  });

  it('does not loop back to the return route', () => {
    expect(returnLocation(cookie('/receive_auth_callback'))).toBe('/blogging/subscribe?subscribed=email#subscribe');
  });

  it('survives a malformed cookie', () => {
    expect(returnLocation(`${RETURN_COOKIE}=%E0%A4%A`)).toBe('/blogging/subscribe?subscribed=email#subscribe');
  });
});

describe('isReturnTo and withoutReturnMarker', () => {
  it('thanks only the form the reader came back to', () => {
    expect(isReturnTo('?subscribed=email', '#subscribe-2', 'subscribe-2')).toBe(true);
    expect(isReturnTo('?subscribed=email', '#subscribe-2', 'subscribe')).toBe(false);
    expect(isReturnTo('', '#subscribe', 'subscribe')).toBe(false);
  });

  it('takes the marker off and keeps everything else', () => {
    expect(withoutReturnMarker('/blogging', '?q=moth&subscribed=email', '#subscribe')).toBe(
      '/blogging?q=moth#subscribe',
    );
    expect(withoutReturnMarker('/blogging/3abc', '?subscribed=email', '#subscribe')).toBe(
      '/blogging/3abc#subscribe',
    );
  });
});

describe('signupBlockIds', () => {
  it('numbers the signup blocks in reading order, across pages', () => {
    const pages = [
      { blocks: [text('one'), signup(), text('two')] },
      { blocks: [signup(), signup()] },
    ];
    const ids = signupBlockIds(pages);
    expect([...ids.values()]).toEqual(['subscribe', 'subscribe-2', 'subscribe-3']);
    expect(ids.get(pages[0].blocks[1].block)).toBe('subscribe');
    expect(hasSignupBlock(pages)).toBe(true);
  });

  it('finds none in a document without one, or without pages', () => {
    expect(hasSignupBlock([{ blocks: [text('one')] }])).toBe(false);
    expect(hasSignupBlock(undefined)).toBe(false);
  });
});

describe('the subscribe page', () => {
  it('claims its own path, with or without a trailing slash, and nothing else', () => {
    expect(SUBSCRIBE_PATH).toBe('/blogging/subscribe');
    expect(isSubscribePath('/blogging/subscribe')).toBe(true);
    expect(isSubscribePath('/blogging/subscribe/')).toBe(true);
    expect(isSubscribePath('/blogging')).toBe(false);
    expect(isSubscribePath('/blogging/3mz4bbmjphc2l')).toBe(false);
    expect(isSubscribePath('/creating/subscribe')).toBe(false);
  });

  it('is a page at the edge, not a post that would 404', () => {
    expect(matchRoute('/blogging/subscribe')).toBe('/blogging/subscribe');
    expect(matchRoute('/blogging/3mz4bbmjphc2l')).toBe('/blogging/:slug');
    expect(isRecordRoute('/blogging/subscribe')).toBe(false);
    expect(isRecordRoute('/blogging/3mz4bbmjphc2l')).toBe(true);
  });
});

describe('isSubscribeLink', () => {
  it('recognises the newsletter page, the address to link', () => {
    expect(SUBSCRIBE_URL).toBe('https://dame.is/blogging/subscribe');
    expect(isSubscribeLink(SUBSCRIBE_URL)).toBe(true);
    expect(isSubscribeLink('https://www.dame.is/blogging/subscribe/')).toBe(true);
    expect(isSubscribeLink('https://dame.is/blogging/subscribe#subscribe')).toBe(true);
  });

  it('still recognises a link to a form on dame.is, as published posts have them', () => {
    expect(isSubscribeLink('https://dame.is/blogging#subscribe')).toBe(true);
    expect(isSubscribeLink('https://www.dame.is/blogging/3abc#subscribe')).toBe(true);
  });

  it('leaves every other link alone', () => {
    expect(isSubscribeLink('https://dame.is/blogging')).toBe(false);
    expect(isSubscribeLink('https://example.com/blogging/subscribe')).toBe(false);
    expect(isSubscribeLink('https://example.com/blogging#subscribe')).toBe(false);
    expect(isSubscribeLink('not a url')).toBe(false);
  });
});
