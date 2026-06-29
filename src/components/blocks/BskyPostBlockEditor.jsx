export default function BskyPostBlockEditor({ block, onChange }) {
  const uri = block?.postRef?.uri || '';
  return (
    <div className="bsky-post-block-editor">
      <label className="admin-field-label">
        Bluesky post URL
        <input
          className="admin-input"
          type="text"
          value={uri}
          onChange={(e) => {
            const next = normalizeUri(e.target.value.trim());
            onChange({ ...block, postRef: { uri: next } });
          }}
          placeholder="https://bsky.app/profile/handle/post/3k…  or  at://did:plc:…/app.bsky.feed.post/3k…"
        />
      </label>
      <p className="admin-field-hint">
        Paste a bsky.app post URL or an at:// URI. The renderer will fetch the post on view.
      </p>
    </div>
  );
}

/**
 * Convert a bsky.app post URL to an at:// URI. Leaves valid at:// URIs
 * untouched. Empty/unrecognized input returns as-is so the user can
 * keep editing.
 */
function normalizeUri(input) {
  if (!input) return '';
  if (input.startsWith('at://')) return input;
  const m = input.match(/^https?:\/\/bsky\.app\/profile\/([^/]+)\/post\/([^/?#]+)/i);
  if (m) {
    // Best-effort: if the profile segment is already a DID, use it; otherwise
    // we keep it as a handle and let the server resolve. Either form works
    // for getPostThread once we wire it.
    return `at://${m[1]}/app.bsky.feed.post/${m[2]}`;
  }
  return input;
}
