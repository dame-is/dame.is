// Leaflet sends every confirmed newsletter subscriber through this route, so
// what it must never do is send one anywhere but back to a page on this site.

import { describe, it, expect } from 'vitest';
import handler from './newsletter-return.js';

function mockRes() {
  const res = { statusCode: 200, headers: {}, ended: false };
  res.setHeader = (name, value) => {
    res.headers[name.toLowerCase()] = value;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.end = () => {
    res.ended = true;
    return res;
  };
  return res;
}

const call = (cookie) => {
  const res = mockRes();
  handler({ headers: cookie ? { cookie } : {}, query: { token: 'leaflets-own' } }, res);
  return res;
};

describe('/receive_auth_callback', () => {
  it('sends the reader back to the form they used, and clears the note', () => {
    const res = call(`newsletter_return=${encodeURIComponent('/blogging/3abc#subscribe-2')}`);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/blogging/3abc?subscribed=email#subscribe-2');
    expect(res.headers['set-cookie']).toMatch(/^newsletter_return=; Path=\/receive_auth_callback; Max-Age=0/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.ended).toBe(true);
  });

  it('lands on the newsletter page’s form without a note', () => {
    expect(call().headers.location).toBe('/blogging/subscribe?subscribed=email#subscribe');
  });

  it('never redirects off the site', () => {
    const res = call(`newsletter_return=${encodeURIComponent('//evil.example/')}`);
    expect(res.headers.location).toBe('/blogging/subscribe?subscribed=email#subscribe');
  });
});
