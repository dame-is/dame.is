// The fetching half of the link previews. The network is stood in for with a
// table of answers, and the SSRF guard (which has to resolve DNS) with a
// pass-through; its own cases are about addresses, not about this.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ssrfGuard.js', async (importOriginal) => {
  const real = await importOriginal();
  return { ...real, assertPublicHttpUrl: async (url) => new URL(url) };
});

const { icoBitmapEntry, icoPngEntry, iconTypeOf, resolveLinks, SITE_ICON } = await import('./linkPreviews.js');

/** An .ico holding the given entries, each `{ width, bytes }`. */
function ico(entries) {
  const head = Buffer.alloc(6 + entries.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((e, i) => {
    const at = 6 + i * 16;
    head[at] = e.width === 256 ? 0 : e.width;
    head[at + 1] = e.width === 256 ? 0 : e.width;
    head.writeUInt32LE(e.bytes.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += e.bytes.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.bytes)]);
}

/** A BITMAPINFOHEADER entry: `rows` top-down of [r, g, b, a] (32-bit) or palette indexes (1-bit). */
function bitmap({ width, height, bpp, rows, palette = [], mask }) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(width, 4);
  header.writeInt32LE(height * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(bpp, 14);
  header.writeUInt32LE(palette.length, 32);
  const pal = Buffer.concat(palette.map(([r, g, b]) => Buffer.from([b, g, r, 0])));
  const stride = Math.floor((bpp * width + 31) / 32) * 4;
  const pixels = Buffer.alloc(stride * height);
  rows.forEach((row, y) => {
    const at = (height - 1 - y) * stride;
    row.forEach((px, x) => {
      if (bpp === 32) Buffer.from([px[2], px[1], px[0], px[3]]).copy(pixels, at + x * 4);
      else if (bpp === 1 && px) pixels[at + (x >> 3)] |= 0x80 >> (x & 7);
    });
  });
  const maskStride = Math.floor((width + 31) / 32) * 4;
  const andMask = Buffer.alloc(maskStride * height);
  (mask || []).forEach((row, y) => {
    row.forEach((clear, x) => {
      if (clear) andMask[(height - 1 - y) * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    });
  });
  return Buffer.concat([header, pal, pixels, andMask]);
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);

describe('icons in .ico files', () => {
  it('finds the PNG nearest 32px inside an .ico', () => {
    const small = Buffer.concat([PNG, Buffer.from('16')]);
    const right = Buffer.concat([PNG, Buffer.from('32')]);
    const buf = ico([
      { width: 16, bytes: small },
      { width: 32, bytes: right },
    ]);
    expect(icoPngEntry(buf).equals(right)).toBe(true);
    expect(icoPngEntry(Buffer.from('not an icon'))).toBeNull();
  });

  it('decodes a 32-bit bitmap entry, alpha and all', () => {
    const buf = ico([
      {
        width: 2,
        bytes: bitmap({
          width: 2,
          height: 2,
          bpp: 32,
          rows: [
            [[255, 0, 0, 255], [0, 255, 0, 128]],
            [[0, 0, 255, 255], [0, 0, 0, 0]],
          ],
        }),
      },
    ]);
    const { width, height, rgba } = icoBitmapEntry(buf);
    expect([width, height]).toEqual([2, 2]);
    expect([...rgba.subarray(0, 8)]).toEqual([255, 0, 0, 255, 0, 255, 0, 128]);
    expect([...rgba.subarray(8, 12)]).toEqual([0, 0, 255, 255]);
  });

  it('decodes a paletted entry, with the AND mask for transparency', () => {
    const buf = ico([
      {
        width: 2,
        bytes: bitmap({
          width: 2,
          height: 2,
          bpp: 1,
          palette: [
            [0, 0, 0],
            [255, 255, 255],
          ],
          rows: [
            [1, 0],
            [0, 1],
          ],
          mask: [
            [0, 1],
            [0, 0],
          ],
        }),
      },
    ]);
    const { rgba } = icoBitmapEntry(buf);
    expect([...rgba.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect(rgba[7]).toBe(0); // masked out
    expect([...rgba.subarray(8, 12)]).toEqual([0, 0, 0, 255]);
  });
});

describe('iconTypeOf', () => {
  it('goes by the bytes, which servers misreport', () => {
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 ')]);
    expect(iconTypeOf('image/png', webp)).toBe('image/webp');
    expect(iconTypeOf('image/vnd.microsoft.icon', ico([{ width: 16, bytes: PNG }]))).toBe('image/x-icon');
    expect(iconTypeOf('image/svg+xml', Buffer.from('<?xml version="1.0"?>\n<svg xmlns="x"></svg>'))).toBe('image/svg+xml');
  });
  it('refuses a page answering in an icon’s place', () => {
    expect(iconTypeOf('text/html', Buffer.from('<!doctype html><html><body>Not found</body></html>'))).toBe('');
  });
});

describe('resolveLinks', () => {
  afterEach(() => vi.unstubAllGlobals());

  const page = (head) => `<!doctype html><html><head>${head}</head><body></body></html>`;
  const html = (body, init = {}) =>
    new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  function serve(routes) {
    const fetch = vi.fn(async (input) => {
      const url = String(input);
      for (const [match, answer] of routes) {
        if (url.startsWith(match)) return typeof answer === 'function' ? answer(url) : answer.clone();
      }
      return new Response('nope', { status: 404 });
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  }

  const media = () => {
    const icon = vi.fn(async (candidates) => `icon:${candidates[0]}`);
    return { small: false, icon, image: vi.fn(async (src, { width }) => `img:${width}:${src}`) };
  };

  it('reads each kind of place and files the icons by host, fetched once a host', async () => {
    serve([
      [
        'https://techcrunch.com/2026/',
        html(
          page(`<meta property="og:title" content="Story one | TechCrunch">
            <meta property="og:site_name" content="TechCrunch">
            <meta property="og:image" content="https://techcrunch.com/cover.png">
            <meta property="article:published_time" content="2026-08-26T18:35:40+00:00">
            <link rel="icon" href="/fav.png" sizes="32x32" type="image/png">`),
        ),
      ],
      [
        'https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread',
        json({
          thread: {
            post: {
              author: { handle: 'toni.bsky.team', displayName: 'Toni', avatar: 'https://cdn.bsky.app/img/avatar/plain/a' },
              record: { text: 'Atmosphere update', createdAt: '2026-10-17T19:21:46.581Z' },
              likeCount: 261,
            },
          },
        }),
      ],
    ]);
    const m = media();
    const out = await resolveLinks(
      [
        'https://techcrunch.com/2026/08/26/one/',
        'https://techcrunch.com/2026/08/27/two/',
        'https://bsky.app/profile/toni.bsky.team/post/3my3sslnd2c2w',
      ],
      { media: m, concurrency: 2 },
    );
    expect(out.failed).toEqual([]);
    const one = out.previews['https://techcrunch.com/2026/08/26/one/'];
    expect(one).toMatchObject({
      kind: 'article',
      title: 'Story one',
      site: 'TechCrunch',
      icon: 'techcrunch.com',
      image: 'img:640:https://techcrunch.com/cover.png',
    });
    const post = out.previews['https://bsky.app/profile/toni.bsky.team/post/3my3sslnd2c2w'];
    expect(post).toMatchObject({ kind: 'post', name: 'Toni', icon: 'bsky.app', avatar: 'https://cdn.bsky.app/img/avatar/plain/a' });
    expect(out.icons).toEqual({
      'techcrunch.com': 'icon:https://techcrunch.com/fav.png',
      'bsky.app': 'icon:https://bsky.app/static/favicon-32x32.png',
    });
    expect(m.icon).toHaveBeenCalledTimes(2);
  });

  it('follows a redirect and says where the link landed', async () => {
    serve([
      ['https://attie.ai/login', html(page('<meta property="og:title" content="Attie"><meta property="og:description" content="AI for the Atmosphere">'))],
      ['https://attie.ai/', new Response(null, { status: 307, headers: { location: '/login' } })],
    ]);
    const out = await resolveLinks(['https://attie.ai'], { media: media() });
    expect(out.previews['https://attie.ai']).toMatchObject({ kind: 'website', title: 'Attie', land: 'attie.ai/login' });
  });

  it('follows a page that only forwards, to read the one it forwards to', async () => {
    serve([
      ['https://docs.example/moved', html(page('<meta http-equiv="refresh" content="0; url=https://new.example/post">'))],
      ['https://new.example/post', html(page('<title>The post</title>'))],
    ]);
    const out = await resolveLinks(['https://docs.example/moved'], { media: media() });
    expect(out.previews['https://docs.example/moved']).toMatchObject({ title: 'The post', land: 'new.example/post' });
  });

  it('describes the newsletter link by the newsletter’s own page, with the site’s icon', async () => {
    serve([
      ['https://dame.is/blogging/subscribe', html(page('<meta property="og:title" content="Subscribe to the dame.is newsletter — dame.is"><meta property="og:site_name" content="dame.is">'))],
    ]);
    const m = media();
    const out = await resolveLinks(['https://dame.is/blogging#subscribe'], { media: m });
    expect(out.previews['https://dame.is/blogging#subscribe']).toMatchObject({
      kind: 'internal',
      title: 'Subscribe to the dame.is newsletter',
      path: 'dame.is/blogging/subscribe',
      local: true,
      icon: 'dame.is',
    });
    expect(out.icons['dame.is']).toBe(SITE_ICON);
    expect(m.icon).not.toHaveBeenCalled();
  });

  it('lists what it couldn’t read, and keeps going', async () => {
    serve([
      ['https://down.example/', new Response('error', { status: 500 })],
      ['https://notapage.example/', new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })],
      ['https://fine.example/', html(page('<title>Fine</title>'))],
    ]);
    const out = await resolveLinks(['https://down.example/', 'https://notapage.example/', 'https://fine.example/'], {
      media: media(),
    });
    expect(out.failed.sort()).toEqual(['https://down.example/', 'https://notapage.example/']);
    expect(out.previews['https://fine.example/'].title).toBe('Fine');
  });

  it('gives up on a link that takes too long', async () => {
    serve([
      [
        'https://slow.example/',
        (url) =>
          new Promise((resolve) => {
            setTimeout(() => resolve(html(page('<title>Late</title>'))), 500);
            void url;
          }),
      ],
    ]);
    // The stand-in fetch ignores the signal, as a hung server would; the
    // per-link bound still has to end the wait.
    const started = Date.now();
    const out = await resolveLinks(['https://slow.example/'], { media: media(), perLinkMs: 50 });
    expect(out.failed).toEqual(['https://slow.example/']);
    expect(Date.now() - started).toBeLessThan(450);
  });
});
