// Small avatars at a small size.
//
// The AppView hands back every avatar as `cdn.bsky.app/img/avatar/plain/…`,
// which is the full 1000×1000 upload — 60 KB to 280 KB apiece — and the site
// draws them at 18 to 48 pixels: a guestbook page of twenty faces was 1.7 MB of
// avatar. The CDN's `avatar_thumbnail` preset is the same image cut to 128px,
// a few KB, and still sharp at 48px on a 2x screen.

const FULL = 'https://cdn.bsky.app/img/avatar/plain/';
const THUMB = 'https://cdn.bsky.app/img/avatar_thumbnail/plain/';

/**
 * The 128px CDN copy of a Bluesky avatar URL, for anything drawn at 64px or
 * less. Anything that isn't a full-size `cdn.bsky.app` avatar — already a
 * thumbnail, another host, empty — comes back unchanged, so this is safe to
 * wrap around any avatar the site renders.
 */
export function avatarThumb(url) {
  if (typeof url !== 'string' || !url.startsWith(FULL)) return url;
  return THUMB + url.slice(FULL.length);
}
