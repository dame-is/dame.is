import { useEffect, useRef, useState } from 'react';
import { uploadImageFile } from './ImageBlockEditor.jsx';

/**
 * Add `https://` to a bare URL so authors can type `anisota.net` and still
 * get a working link (and a fetchable target for metadata). Leaves an
 * existing scheme — or an empty string — untouched.
 */
export function normalizeUrl(raw) {
  const s = (raw || '').trim();
  if (!s) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s; // already has a scheme
  if (s.startsWith('//')) return `https:${s}`;
  return `https://${s}`;
}

export default function WebsiteBlockEditor({ block, agent, onChange, onSetCover }) {
  const [status, setStatus] = useState(null);
  const [unfurling, setUnfurling] = useState(false);
  // Object URL for a just-obtained image (upload or auto-detected preview).
  // A fresh blob has no `_url` yet — that only lands when the record is read
  // back — so we keep a local URL to show the thumbnail immediately.
  const [localPreviewUrl, setLocalPreviewUrl] = useState(null);
  const [coverDone, setCoverDone] = useState(false);
  // The link's og:image URL, if metadata turned one up. Kept in local state
  // (not on the block) so it never gets persisted into the record.
  const [detected, setDetected] = useState(null);
  const fileRef = useRef(null);
  // The raw bytes behind the current preview, kept so "Use as record cover"
  // can mint a fresh, independently-owned object URL for the cover field
  // (this editor's own preview URL is revoked when the card collapses).
  const rawImageRef = useRef(null);

  // Revoke the local object URL on unmount / when replaced.
  useEffect(() => () => localPreviewUrl && URL.revokeObjectURL(localPreviewUrl), [localPreviewUrl]);

  function setLocalPreview(url) {
    setLocalPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }

  async function handlePreviewFile(file) {
    if (!file) return;
    rawImageRef.current = file;
    const local = URL.createObjectURL(file);
    setLocalPreview(local);
    setStatus('Uploading…');
    try {
      const { blob } = await uploadImageFile(agent, file);
      onChange({ ...block, previewImage: blob });
      setCoverDone(false);
      setStatus(null);
    } catch (err) {
      setStatus(`Upload failed: ${err?.message || err}`);
    }
  }

  // Pull a remote image (e.g. the link's og:image) through our same-origin
  // proxy — a direct cross-origin fetch is CORS-blocked on most hosts — then
  // upload it to the PDS. Returns the blob ref (and shows the thumbnail from a
  // local object URL); the caller decides how to merge it into the block so
  // this never clobbers concurrent field edits.
  async function fetchAndUploadImage(imageUrl) {
    const res = await fetch(`/api/image-proxy?url=${encodeURIComponent(imageUrl)}`);
    if (!res.ok) throw new Error(`proxy ${res.status}`);
    const raw = await res.blob();
    const type = raw.type || 'image/jpeg';
    const ext = (type.split('/')[1] || 'jpg').split(';')[0];
    const file = new File([raw], `preview.${ext}`, { type });
    rawImageRef.current = raw;
    setLocalPreview(URL.createObjectURL(raw));
    const { blob } = await uploadImageFile(agent, file);
    return blob;
  }

  // "Use detected image" button — swap the current preview for the og:image.
  async function useDetectedImage(imageUrl) {
    if (!imageUrl) return;
    setStatus('Fetching preview image…');
    try {
      const blob = await fetchAndUploadImage(imageUrl);
      onChange({ ...block, previewImage: blob });
      setCoverDone(false);
      setStatus(null);
    } catch {
      setStatus('Could not load that image.');
    }
  }

  // Pull title/description/image from the linked page's Open Graph tags via the
  // /api/unfurl endpoint so link cards aren't filled by hand. A detected image
  // auto-fills the preview when the card doesn't already have one.
  async function fetchMetadata() {
    const src = normalizeUrl(block.src);
    if (!src) return;
    setUnfurling(true);
    try {
      const res = await fetch(`/api/unfurl?url=${encodeURIComponent(src)}`);
      const data = await res.json();
      // Merge everything into a single block so title/description and a
      // freshly uploaded preview blob land together (avoids a stale-block race
      // between two separate onChange calls).
      const next = {
        ...block,
        src,
        title: block.title || data?.title || '',
        description: block.description || data?.description || '',
      };
      if (data?.image) setDetected(data.image);
      if (data?.image && !block.previewImage) {
        try {
          setStatus('Fetching preview image…');
          next.previewImage = await fetchAndUploadImage(data.image);
          setStatus(null);
        } catch {
          setStatus('Metadata loaded, but the preview image could not be fetched.');
        }
      }
      onChange(next);
    } catch {
      /* leave fields as-is on failure */
    } finally {
      setUnfurling(false);
    }
  }

  function clearPreview() {
    setLocalPreview(null);
    setCoverDone(false);
    onChange({ ...block, previewImage: undefined });
  }

  function useAsCover() {
    if (!onSetCover || !block.previewImage) return;
    // Mint a URL the cover field can own (ours is revoked on collapse); fall
    // back to the blob's read-back URL if the raw bytes aren't around.
    const coverUrl = rawImageRef.current
      ? URL.createObjectURL(rawImageRef.current)
      : block.previewImage?._url || null;
    onSetCover(block.previewImage, coverUrl);
    setCoverDone(true);
  }

  const previewUrl = localPreviewUrl || block?.previewImage?._url || null;

  return (
    <div className="website-block-editor">
      <label className="admin-field-label">
        URL
        <input
          className="admin-input"
          type="url"
          value={block.src || ''}
          onChange={(e) => onChange({ ...block, src: e.target.value })}
          onBlur={() => {
            const src = normalizeUrl(block.src);
            if (src !== block.src) onChange({ ...block, src });
          }}
          placeholder="example.com"
        />
      </label>
      <div className="website-block-actions">
        <button
          type="button"
          className="admin-link-subtle"
          onClick={fetchMetadata}
          disabled={!block.src || unfurling}
        >
          {unfurling ? 'Fetching…' : 'Fetch metadata'}
        </button>
        <span className="admin-field-hint">
          No “https://” needed. YouTube / Vimeo URLs render as an inline player.
        </span>
      </div>
      <label className="admin-field-label">
        Title
        <input
          className="admin-input"
          type="text"
          value={block.title || ''}
          onChange={(e) => onChange({ ...block, title: e.target.value })}
          placeholder="Page title"
        />
      </label>
      <label className="admin-field-label">
        Description
        <textarea
          className="admin-input admin-textarea"
          rows={2}
          value={block.description || ''}
          onChange={(e) => onChange({ ...block, description: e.target.value })}
          placeholder="Short summary"
        />
      </label>
      <div className="website-block-preview">
        <label className="admin-field-hint">Preview image</label>
        {previewUrl && (
          <img className="website-block-preview-img" src={previewUrl} alt="" />
        )}
        {/* Offer the detected og:image when it isn't the one already in use. */}
        {detected && !previewUrl && (
          <button
            type="button"
            className="admin-link-subtle"
            onClick={() => useDetectedImage(detected)}
          >
            Use detected image
          </button>
        )}
        <div className="website-block-preview-actions">
          <button
            type="button"
            className="admin-link-subtle"
            onClick={() => fileRef.current?.click()}
          >
            {previewUrl ? 'Replace preview' : 'Upload preview'}
          </button>
          {previewUrl && onSetCover && (
            <button
              type="button"
              className="admin-link-subtle"
              onClick={useAsCover}
            >
              {coverDone ? 'Cover set ✓' : 'Use as record cover'}
            </button>
          )}
          {block.previewImage && (
            <button
              type="button"
              className="admin-link-subtle"
              onClick={clearPreview}
            >
              Remove preview
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            handlePreviewFile(f);
          }}
        />
        {status && <p className="admin-field-hint">{status}</p>}
      </div>
    </div>
  );
}
