import { useEffect, useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { uploadImageFile } from './blocks/ImageBlockEditor.jsx';
import { move, replaceAt, removeAt, RowControls } from './listFields.jsx';
import { blobCid } from '../lib/recordWrites.js';

/**
 * Editor for `is.dame.profile.photos` — the portrait gallery on /themself.
 *
 * A photo is `{ image: BlobRef, alt, caption, aspectRatio }`, the same shape a
 * leaflet image block carries, so the same `uploadImageFile` puts the bytes on
 * the PDS and sniffs the intrinsic size on the way through.
 *
 * Freshly uploaded blobs have no `_url` (that annotation is baked on by the
 * READ path, against a PDS this editor has not asked about), so previews come
 * from local object URLs held here. They are keyed by the blob's CID rather
 * than by row index: rows reorder, and an index-keyed cache would hand row 2
 * row 1's picture the moment you pressed ▲.
 */
export default function PhotoGalleryField({ value, onChange, agent }) {
  const list = Array.isArray(value) ? value : [];
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const addRef = useRef(null);
  // cid → object URL, for photos uploaded in this session.
  const localUrls = useRef(new Map());

  // Object URLs outlive their <img>, so they are revoked once, on unmount.
  useEffect(() => {
    const urls = localUrls.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  // The list as of the LAST render, for the writes that land after an upload.
  // `list` inside `addFiles` / `replaceImage` is the one from the render that
  // started the upload, and the owner goes on typing alt text and captions for
  // the several seconds it takes — so building the result from that captured
  // copy wrote every one of those keystrokes back out. Written through on each
  // change as well, so two writes in one tick build on each other.
  const listRef = useRef(list);
  listRef.current = list;
  const emit = (next) => {
    listRef.current = next;
    onChange(next);
  };

  const update = (i, patch) => {
    const current = listRef.current;
    emit(replaceAt(current, i, { ...current[i], ...patch }));
  };

  /**
   * Upload one or more files and append a row per success. The whole batch is
   * appended in a single `onChange`, to the list as it stands when the batch
   * finishes — not the one the drop started from, which every edit made during
   * the upload has since replaced.
   */
  async function addFiles(files) {
    const images = Array.from(files || []).filter((f) => f?.type?.startsWith('image/'));
    if (images.length === 0) {
      setStatus("That doesn't look like an image.");
      return;
    }
    setBusy(true);
    setStatus(images.length > 1 ? `Uploading ${images.length} photos…` : 'Uploading…');
    const added = [];
    const failures = [];
    for (const file of images) {
      try {
        const { blob, aspectRatio } = await uploadImageFile(agent, file);
        const cid = blobCid(blob);
        if (cid) localUrls.current.set(cid, URL.createObjectURL(file));
        added.push({ image: blob, ...(aspectRatio ? { aspectRatio } : {}) });
      } catch (err) {
        failures.push(`${file.name}: ${err?.message || err}`);
      }
    }
    if (added.length) emit([...listRef.current, ...added]);
    setBusy(false);
    setStatus(failures.length ? `Upload failed — ${failures.join('; ')}` : null);
  }

  /** Swap the bytes behind an existing row, keeping its alt text and caption. */
  async function replaceImage(i, file) {
    if (!file || !file.type.startsWith('image/')) return;
    // The row is followed by the photo it held, not by its index: a row moved or
    // removed while the bytes upload would otherwise have the new picture land
    // on whichever photo slid into its place. By identity first, and by CID when
    // the record has been re-cloned underneath (the editor's display-URL pass
    // copies the whole value), since a CID survives the copy.
    const target = list[i]?.image;
    const targetCid = blobCid(target);
    const rowNow = () => {
      const rows = listRef.current;
      const same = rows.findIndex((photo) => photo?.image === target);
      if (same >= 0 || !targetCid) return same;
      return rows.findIndex((photo) => blobCid(photo?.image) === targetCid);
    };
    setBusy(true);
    setStatus('Uploading…');
    try {
      const { blob, aspectRatio } = await uploadImageFile(agent, file);
      const cid = blobCid(blob);
      if (cid) localUrls.current.set(cid, URL.createObjectURL(file));
      const at = rowNow();
      if (at >= 0) {
        update(at, { image: blob, aspectRatio: aspectRatio || undefined });
      }
      setStatus(null);
    } catch (err) {
      setStatus(`Upload failed: ${err?.message || err}`);
    }
    setBusy(false);
  }

  return (
    <div className="rf-list pf-photos">
      {list.map((photo, i) => (
        // Index keys are correct here: a row holds no state of its own (the
        // file input is a ref, nothing more), so a reorder has nothing to
        // carry with it — and a CID key would collide the moment the same
        // photo were added twice.
        <div className="rf-card pf-card" key={i}>
          <div className="rf-card-head">
            <span className="rf-id">#{i + 1}</span>
            <RowControls
              index={i}
              length={list.length}
              onMove={(from, to) => emit(move(list, from, to))}
              onRemove={(idx) => emit(removeAt(list, idx))}
              removeLabel="Remove photo"
            />
          </div>
          <div className="pf-row">
            <PhotoThumb
              photo={photo}
              localUrls={localUrls.current}
              onPick={(file) => replaceImage(i, file)}
            />
            <div className="pf-fields">
              <label className="admin-field-label">
                Alt text
                <input
                  className="admin-input"
                  type="text"
                  value={photo?.alt || ''}
                  placeholder="Describe the photo (for screen readers)"
                  onChange={(e) => update(i, { alt: e.target.value || undefined })}
                />
              </label>
              <label className="admin-field-label">
                Caption
                <input
                  className="admin-input"
                  type="text"
                  value={photo?.caption || ''}
                  placeholder="Visible caption (optional)"
                  onChange={(e) => update(i, { caption: e.target.value || undefined })}
                />
              </label>
            </div>
          </div>
        </div>
      ))}

      <div
        className={`pf-drop${dragging ? ' is-dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer?.files);
        }}
        onClick={() => addRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            addRef.current?.click();
          }
        }}
      >
        <ImagePlus size={16} aria-hidden="true" />
        <span>{busy ? 'Uploading…' : 'Add photos — click, or drop them here'}</span>
        <input
          ref={addRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            // Copy the FileList BEFORE resetting the input. `input.files` is
            // live: clearing `value` (which is what lets the same file be
            // picked twice in a row) empties the list you are still holding,
            // so passing it straight through uploads nothing at all.
            const files = Array.from(e.target.files || []);
            e.target.value = '';
            addFiles(files);
          }}
        />
      </div>

      {status && <p className="admin-field-hint">{status}</p>}
    </div>
  );
}

function PhotoThumb({ photo, localUrls, onPick }) {
  const ref = useRef(null);
  const cid = blobCid(photo?.image);
  const src = photo?.image?._url || (cid ? localUrls.get(cid) : null);
  return (
    <div
      className={`pf-thumb${src ? ' has-image' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onPick(e.dataTransfer?.files?.[0]);
      }}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ref.current?.click();
        }
      }}
      role="button"
      tabIndex={0}
      title="Replace this photo"
      aria-label={photo?.alt ? `Replace photo: ${photo.alt}` : 'Replace this photo'}
    >
      {src ? (
        <img src={src} alt="" />
      ) : (
        <div className="pf-thumb-empty">No preview</div>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onPick(file);
        }}
      />
    </div>
  );
}
