import { useEffect, useRef, useState } from 'react';

/**
 * Edit a pub.leaflet.blocks.image block. Click-to-upload or
 * drag-and-drop pushes the file to the user's PDS as a blob and stores
 * the returned BlobRef on `block.image`. The aspect ratio is sniffed
 * from the bitmap before upload so the renderer can size the slot
 * correctly.
 */
export default function ImageBlockEditor({ block, agent, did, onChange }) {
  const [status, setStatus] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

  // Revoke any object URL on unmount or when replaced.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleFile(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setStatus('That doesn\'t look like an image.');
      return;
    }
    setStatus('Uploading…');
    const localUrl = URL.createObjectURL(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(localUrl);
    try {
      const { blob, aspectRatio } = await uploadImageFile(agent, file);
      onChange({
        ...block,
        image: blob,
        ...(aspectRatio ? { aspectRatio } : {}),
        // Drop the legacy URL once a fresh blob is in place.
        url: undefined,
      });
      setStatus(null);
    } catch (err) {
      setStatus(`Upload failed: ${err?.message || err}`);
    }
  }

  function handleDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }

  // Display the previously uploaded blob (annotated _url) or any legacy URL.
  const displayUrl = previewUrl || block?.image?._url || block?.url || null;

  return (
    <div className="image-block-editor">
      <div
        className={`image-block-dropzone${displayUrl ? ' has-image' : ''}`}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        {displayUrl ? (
          <img src={displayUrl} alt={block.alt || ''} />
        ) : (
          <div className="image-block-dropzone-empty">
            Click to upload or drop an image
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) handleFile(file);
          }}
        />
      </div>
      {status && <p className="admin-field-hint">{status}</p>}
      <label className="admin-field-label image-block-alt-label">
        Alt text
        <input
          className="admin-input"
          type="text"
          value={block.alt || ''}
          onChange={(e) => onChange({ ...block, alt: e.target.value })}
          placeholder="Describe the image"
        />
      </label>
    </div>
  );
}

/**
 * Shared upload helper. Returns the BlobRef from uploadBlob plus a
 * best-effort aspectRatio (omitted on decode failure).
 */
export async function uploadImageFile(agent, file) {
  if (!agent) throw new Error('Not signed in.');
  const buffer = new Uint8Array(await file.arrayBuffer());
  const ar = await sniffAspectRatio(file).catch(() => null);
  const res = await agent.com.atproto.repo.uploadBlob(buffer, { encoding: file.type });
  const data = res?.data || res;
  const blob = data?.blob;
  if (!blob) throw new Error('PDS did not return a blob ref.');
  return { blob, aspectRatio: ar };
}

function sniffAspectRatio(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth && img.naturalHeight) {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      } else {
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image.'));
    };
    img.src = url;
  });
}
