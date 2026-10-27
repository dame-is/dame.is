/**
 * If a URL is a known video host, return an embeddable player src so a link
 * to it can play inline (a leaflet `website` block, an are.na Embed block).
 * Only YouTube and Vimeo — the two hosts the CSP's frame-src lets through.
 */
export function videoEmbedSrc(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/embed/${v}`;
      const m = u.pathname.match(/^\/(?:embed|shorts)\/([\w-]+)/);
      if (m) return `https://www.youtube.com/embed/${m[1]}`;
    }
    if (host === 'youtu.be') {
      const id = u.pathname.slice(1).split('/')[0];
      if (id) return `https://www.youtube.com/embed/${id}`;
    }
    if (host === 'vimeo.com') {
      const id = u.pathname.split('/').filter(Boolean)[0];
      if (id && /^\d+$/.test(id)) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {
    /* not a URL */
  }
  return null;
}
