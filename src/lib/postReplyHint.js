/**
 * Pull a parent-post hint from a Bluesky post payload. Prefers the AppView's
 * resolved `payload.parent` (has handle + text), falls back to the
 * `payload.reply` record itself (URI only, lets us still link out).
 */
export function getReplyHint(payload) {
  if (!payload) return null;
  const parent = payload.parent;
  if (parent?.$type === 'app.bsky.feed.defs#notFoundPost') {
    return { kind: 'missing', label: 'a deleted post', uri: parent.uri || null };
  }
  if (parent?.$type === 'app.bsky.feed.defs#blockedPost') {
    return { kind: 'missing', label: 'a blocked post', uri: parent.uri || null };
  }
  if (parent?.author?.handle) {
    return {
      kind: 'resolved',
      handle: parent.author.handle,
      uri: parent.uri,
    };
  }
  if (payload.reply?.parent?.uri) {
    return { kind: 'unresolved', uri: payload.reply.parent.uri };
  }
  return null;
}
