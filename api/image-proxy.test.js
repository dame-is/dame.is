// The image proxy serves whatever it returns FROM dame.is, so these are about
// what it must refuse: anything that isn't a plain raster image, anything too
// big to buffer, and pages on other sites using it as their own proxy. The
// SSRF guard has to resolve DNS, so it is stood in for here; its own cases are
// about addresses, not about this.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('./_lib/ssrfGuard.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, assertPublicHttpUrl: async (url) => new URL(url) };
});

const { default: handler, baseMediaType } = await import('./image-proxy.js');

/** The slice of a Vercel response the handler touches, recording what it got. */
function mockRes() {
  const res = { statusCode: 200, headers: {}, body: undefined };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (k, v) => {
    res.headers[k.toLowerCase()] = v;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  res.end = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

const call = async ({
  url = 'https://example.com/a.png',
  headers = {},
} = {}) => {
  const res = mockRes();
  await handler({ query: { url }, headers }, res);
  return res;
};

/** An upstream answering with `type` and `bytes`, streamed in `chunk`-sized pieces. */
function upstream(
  type,
  bytes,
  { chunk = bytes.length || 1, length = true } = {},
) {
  let read = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (read >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(read, read + chunk));
      read += chunk;
    },
  });
  const headers = { 'content-type': type };
  if (length) headers['content-length'] = String(bytes.length);
  const response = new Response(body, { status: 200, headers });
  return { response, bytesRead: () => read };
}

afterEach(() => vi.unstubAllGlobals());

describe('/api/image-proxy', () => {
  it('refuses an SVG, which would run as a page on this origin', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    for (const type of ['image/svg+xml', 'Image/SVG+XML; charset=utf-8']) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => upstream(type, svg).response),
      );
      const res = await call({ url: 'https://evil.example/x.svg' });
      expect(res.statusCode, type).toBe(415);
      expect(res.headers['content-type']).toBeUndefined();
    }
  });

  it('refuses anything else that merely starts with image/', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream('image/x-icon', Buffer.alloc(10)).response),
    );
    expect((await call()).statusCode).toBe(415);
  });

  it('serves a raster image, locked down so it can only ever be an image', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream('image/png; foo=bar', png).response),
    );
    const res = await call();
    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.body, png)).toBe(0);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none'; sandbox",
    );
    expect(res.headers['content-disposition']).toBe(
      'inline; filename="preview"',
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['cache-control']).toMatch(/^private/);
  });

  it('turns away a request another site made, before fetching anything', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    for (const site of ['cross-site', 'same-site']) {
      const res = await call({ headers: { 'sec-fetch-site': site } });
      expect(res.statusCode).toBe(403);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still serves the editor, which fetches from its own origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => upstream('image/jpeg', Buffer.alloc(4)).response),
    );
    expect(
      (await call({ headers: { 'sec-fetch-site': 'same-origin' } })).statusCode,
    ).toBe(200);
  });

  it('refuses a body declared too large without reading it', async () => {
    const big = upstream('image/png', Buffer.alloc(9 * 1024 * 1024), {
      chunk: 64 * 1024,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => big.response),
    );
    expect((await call()).statusCode).toBe(413);
    expect(big.bytesRead()).toBeLessThan(1024 * 1024);
  });

  it('stops reading a body that turns out too large', async () => {
    // No content-length, so only the running count can catch it.
    const big = upstream('image/png', Buffer.alloc(12 * 1024 * 1024), {
      chunk: 512 * 1024,
      length: false,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => big.response),
    );
    expect((await call()).statusCode).toBe(413);
    expect(big.bytesRead()).toBeLessThan(10 * 1024 * 1024);
  });

  it('gives the upstream a deadline, and says so when it passes', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      expect(init.signal).toBeInstanceOf(AbortSignal);
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    vi.stubGlobal('fetch', fetchMock);
    const res = await call();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(504);
  });
});

describe('baseMediaType', () => {
  it('reduces a header to its bare, lower-case type', () => {
    expect(baseMediaType('Image/PNG; charset=binary')).toBe('image/png');
    expect(baseMediaType('')).toBe('');
    expect(baseMediaType(null)).toBe('');
  });
});
