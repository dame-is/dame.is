// Vercel serverless function: fetch a URL and return its Open Graph / basic
// metadata (title, description, image) so the block editor can populate a
// link card without the author copying it by hand. Read-only, owner-facing.

const META_LIMIT = 512 * 1024; // only need the <head>; cap the read.

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function metaContent(html, names) {
  for (const name of names) {
    // property="og:title" content="…"  (either attribute order)
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`,
      'i',
    );
    const m = html.match(re) ||
      html.match(
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'),
      );
    if (m && m[1]) return decodeEntities(m[1]).trim();
  }
  return '';
}

export default async function handler(req, res) {
  const url = req.query?.url;
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Pass a valid http(s) `url` query param.' });
  }
  try {
    const upstream = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (dame.is link unfurl)' },
      redirect: 'follow',
    });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream ${upstream.status}` });
    }
    const reader = upstream.body?.getReader?.();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder();
      let total = 0;
      // Read just enough to cover <head>.
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        html += decoder.decode(value, { stream: true });
        if (total >= META_LIMIT || /<\/head>/i.test(html)) break;
      }
      reader.cancel().catch(() => {});
    } else {
      html = (await upstream.text()).slice(0, META_LIMIT);
    }

    const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const out = {
      title: metaContent(html, ['og:title', 'twitter:title']) || (titleTag ? decodeEntities(titleTag[1]).trim() : ''),
      description: metaContent(html, ['og:description', 'twitter:description', 'description']),
      image: metaContent(html, ['og:image', 'twitter:image']),
    };
    // og:image is often a relative path ("/cover.png") or protocol-relative
    // ("//host/cover.png"); resolve it against the final (post-redirect) page
    // URL so callers always get an absolute http(s) URL they can fetch.
    if (out.image) {
      try {
        out.image = new URL(out.image, upstream.url || url).href;
      } catch {
        out.image = '';
      }
    }
    res.setHeader('cache-control', 'public, max-age=3600');
    return res.status(200).json(out);
  } catch (err) {
    return res.status(502).json({ error: err?.message || 'unfurl failed' });
  }
}
