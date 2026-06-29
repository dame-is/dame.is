import { useRef, useState } from 'react';
import { uploadImageFile } from './ImageBlockEditor.jsx';

export default function WebsiteBlockEditor({ block, agent, onChange }) {
  const [status, setStatus] = useState(null);
  const fileRef = useRef(null);

  async function handlePreviewFile(file) {
    if (!file) return;
    setStatus('Uploading…');
    try {
      const { blob } = await uploadImageFile(agent, file);
      onChange({ ...block, previewImage: blob });
      setStatus(null);
    } catch (err) {
      setStatus(`Upload failed: ${err?.message || err}`);
    }
  }

  const previewUrl = block?.previewImage?._url || null;

  return (
    <div className="website-block-editor">
      <label className="admin-field-label">
        URL
        <input
          className="admin-input"
          type="url"
          value={block.src || ''}
          onChange={(e) => onChange({ ...block, src: e.target.value })}
          placeholder="https://example.com"
        />
      </label>
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
        <button
          type="button"
          className="admin-link-subtle"
          onClick={() => fileRef.current?.click()}
        >
          {previewUrl ? 'Replace preview' : 'Upload preview'}
        </button>
        {block.previewImage && (
          <button
            type="button"
            className="admin-link-subtle"
            onClick={() => onChange({ ...block, previewImage: undefined })}
          >
            Remove preview
          </button>
        )}
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
