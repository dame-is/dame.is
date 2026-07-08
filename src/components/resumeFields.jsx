import { useEffect, useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, Plus, X } from 'lucide-react';

/**
 * Structured form controls for the resume lexicons, replacing the raw-JSON
 * fields that used to back a job's `highlights` and a resume's `entries`,
 * `education`, `skills`, and `contact`. Each is a controlled component: it
 * receives the current array/object value and calls `onChange` with the whole
 * next value (matching how RecordEditor's `json` field behaves), so the outer
 * save path is unchanged.
 *
 * The RecordEditor "Edit JSON" toggle still works as an escape hatch for any
 * shape these editors don't cover.
 */

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

function move(arr, from, to) {
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function replaceAt(arr, index, item) {
  const next = arr.slice();
  next[index] = item;
  return next;
}

function removeAt(arr, index) {
  const next = arr.slice();
  next.splice(index, 1);
  return next;
}

/** Small ▲ / ▼ / ✕ control cluster shared by every list row. */
function RowControls({ index, length, onMove, onRemove, removeLabel = 'Remove' }) {
  return (
    <div className="rf-controls">
      <button
        type="button"
        className="rf-icon-btn"
        onClick={() => onMove(index, index - 1)}
        disabled={index === 0}
        aria-label="Move up"
        title="Move up"
      >
        <ChevronUp size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="rf-icon-btn"
        onClick={() => onMove(index, index + 1)}
        disabled={index === length - 1}
        aria-label="Move down"
        title="Move down"
      >
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="rf-icon-btn rf-icon-btn-danger"
        onClick={() => onRemove(index)}
        aria-label={removeLabel}
        title={removeLabel}
      >
        <X size={15} aria-hidden="true" />
      </button>
    </div>
  );
}

function parseTags(text) {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Load every record of a collection once, for the ref pickers. */
function useCollectionRecords(agent, did, collection) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!agent || !did || !collection) return undefined;
    setRecords(null);
    setError(null);
    (async () => {
      try {
        const all = [];
        let cursor;
        do {
          const res = await agent.com.atproto.repo.listRecords({
            repo: did,
            collection,
            limit: 100,
            cursor,
          });
          const data = res?.data || res;
          all.push(...(data?.records || []));
          cursor = data?.cursor;
        } while (cursor);
        if (!cancelled) setRecords(all);
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || String(err));
          setRecords([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent, did, collection]);

  return { records, error };
}

/* ------------------------------------------------------------------ */
/* Highlights (job / education achievement bullets)                     */
/* ------------------------------------------------------------------ */

/** Next unique `hN` id for a new highlight in this list. */
function nextHighlightId(list) {
  const used = new Set(list.map((h) => h?.id).filter(Boolean));
  let n = list.length + 1;
  while (used.has(`h${n}`)) n += 1;
  return `h${n}`;
}

export function HighlightsField({ value, onChange }) {
  const list = Array.isArray(value) ? value : [];

  const update = (i, patch) => onChange(replaceAt(list, i, { ...list[i], ...patch }));

  const add = () =>
    onChange([
      ...list,
      { id: nextHighlightId(list), text: '', visibility: 'public', featured: false, metric: false },
    ]);

  return (
    <div className="rf-list">
      {list.length === 0 && (
        <p className="admin-field-hint">No highlights yet. Add achievement bullets below.</p>
      )}
      {list.map((h, i) => (
        <div className="rf-card" key={h.id || i}>
          <div className="rf-card-head">
            <code className="rf-id">{h.id || '—'}</code>
            <RowControls
              index={i}
              length={list.length}
              onMove={(from, to) => onChange(move(list, from, to))}
              onRemove={(idx) => onChange(removeAt(list, idx))}
              removeLabel="Remove highlight"
            />
          </div>
          <textarea
            className="admin-input admin-textarea"
            rows={2}
            value={h.text ?? ''}
            placeholder="Shipped X, driving Y% growth…"
            onChange={(e) => update(i, { text: e.target.value })}
          />
          <div className="rf-inline">
            <label className="admin-checkbox rf-checkbox">
              <input
                type="checkbox"
                checked={Boolean(h.featured)}
                onChange={(e) => update(i, { featured: e.target.checked })}
              />
              <span>Featured</span>
            </label>
            <label className="admin-checkbox rf-checkbox">
              <input
                type="checkbox"
                checked={Boolean(h.metric)}
                onChange={(e) => update(i, { metric: e.target.checked })}
              />
              <span>Metric</span>
            </label>
            <label className="rf-inline-field">
              <span className="rf-inline-label">Visibility</span>
              <select
                className="admin-input rf-select-sm"
                value={h.visibility || 'public'}
                onChange={(e) => update(i, { visibility: e.target.value })}
              >
                <option value="public">public</option>
                <option value="unlisted">unlisted</option>
                <option value="private">private</option>
              </select>
            </label>
          </div>
          <label className="rf-inline-field rf-inline-field-block">
            <span className="rf-inline-label">Tags</span>
            <input
              className="admin-input"
              type="text"
              value={Array.isArray(h.tags) ? h.tags.join(', ') : ''}
              placeholder="growth, leadership"
              onChange={(e) => {
                const tags = parseTags(e.target.value);
                update(i, { tags: tags.length ? tags : undefined });
              }}
            />
          </label>
        </div>
      ))}
      <button type="button" className="rf-add" onClick={add}>
        <Plus size={15} aria-hidden="true" /> Add highlight
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Record refs (resume → jobs / education) with highlight selection     */
/* ------------------------------------------------------------------ */

function labelForRecord(refKey, rec) {
  const v = rec?.value || {};
  if (refKey === 'job') {
    return [v.title, v.organization].filter(Boolean).join(' · ') || rec.uri;
  }
  return [v.institution, v.studyType || v.area].filter(Boolean).join(' · ') || rec.uri;
}

/** Non-private highlights of a record, in natural order (the default set). */
function defaultHighlightIds(rec) {
  const hs = Array.isArray(rec?.value?.highlights) ? rec.value.highlights : [];
  return hs.filter((h) => (h.visibility || 'public') !== 'private').map((h) => h.id);
}

export function RecordRefsField({ field, value, onChange, agent, did }) {
  const refKey = field.refKey; // 'job' | 'education'
  const overrides = Boolean(field.overrides);
  const list = Array.isArray(value) ? value : [];
  const { records, error } = useCollectionRecords(agent, did, field.refCollection);

  const byUri = useMemo(() => {
    const m = new Map();
    for (const r of records || []) m.set(r.uri, r);
    return m;
  }, [records]);

  const update = (i, patch) => onChange(replaceAt(list, i, { ...list[i], ...patch }));

  const add = () => {
    const first = records?.[0]?.uri || '';
    onChange([...list, { [refKey]: first }]);
  };

  if (error) {
    return <p className="admin-field-hint admin-error-inline">Couldn’t load {refKey} records: {error}</p>;
  }
  if (records == null) {
    return <p className="admin-field-hint">Loading {refKey} records…</p>;
  }

  return (
    <div className="rf-list">
      {list.length === 0 && (
        <p className="admin-field-hint">Nothing added yet. Pick a {refKey} below.</p>
      )}
      {list.map((entry, i) => {
        const uri = entry[refKey];
        const rec = byUri.get(uri);
        const highlights = Array.isArray(rec?.value?.highlights) ? rec.value.highlights : [];
        const explicit = Array.isArray(entry.highlightIds);
        const includedSet = new Set(explicit ? entry.highlightIds : defaultHighlightIds(rec));

        const setCustomize = (on) => {
          if (on) update(i, { highlightIds: defaultHighlightIds(rec) });
          else {
            const next = { ...list[i] };
            delete next.highlightIds;
            onChange(replaceAt(list, i, next));
          }
        };

        const toggleHighlight = (id, on) => {
          // Rebuild in the job's natural order so display order stays stable.
          const ordered = highlights
            .map((h) => h.id)
            .filter((hid) => (hid === id ? on : includedSet.has(hid)));
          update(i, { highlightIds: ordered });
        };

        return (
          <div className="rf-card" key={i}>
            <div className="rf-card-head">
              <select
                className="admin-input rf-ref-select"
                value={uri || ''}
                onChange={(e) => update(i, { [refKey]: e.target.value })}
              >
                <option value="">— pick a {refKey} —</option>
                {(records || []).map((r) => (
                  <option key={r.uri} value={r.uri}>
                    {labelForRecord(refKey, r)}
                  </option>
                ))}
              </select>
              <RowControls
                index={i}
                length={list.length}
                onMove={(from, to) => onChange(move(list, from, to))}
                onRemove={(idx) => onChange(removeAt(list, idx))}
                removeLabel={`Remove ${refKey}`}
              />
            </div>

            {uri && !rec && (
              <p className="admin-field-hint admin-error-inline">
                Referenced record not found: <code>{uri}</code>
              </p>
            )}

            {overrides && (
              <div className="rf-overrides">
                <label className="rf-inline-field rf-inline-field-block">
                  <span className="rf-inline-label">Title override</span>
                  <input
                    className="admin-input"
                    type="text"
                    value={entry.titleOverride ?? ''}
                    placeholder={rec?.value?.title || 'Falls back to the job title'}
                    onChange={(e) => update(i, { titleOverride: e.target.value || undefined })}
                  />
                </label>
                <label className="rf-inline-field rf-inline-field-block">
                  <span className="rf-inline-label">Summary override</span>
                  <textarea
                    className="admin-input admin-textarea"
                    rows={2}
                    value={entry.summaryOverride ?? ''}
                    placeholder={rec?.value?.summary || 'Falls back to the job summary'}
                    onChange={(e) => update(i, { summaryOverride: e.target.value || undefined })}
                  />
                </label>
              </div>
            )}

            {highlights.length > 0 && (
              <div className="rf-highlights">
                <label className="admin-checkbox rf-checkbox">
                  <input
                    type="checkbox"
                    checked={explicit}
                    onChange={(e) => setCustomize(e.target.checked)}
                  />
                  <span>Choose which highlights show (default: all)</span>
                </label>
                <ul className="rf-highlight-list">
                  {highlights.map((h) => (
                    <li key={h.id} className="rf-highlight-row">
                      <label className="admin-checkbox rf-checkbox">
                        <input
                          type="checkbox"
                          disabled={!explicit}
                          checked={includedSet.has(h.id)}
                          onChange={(e) => toggleHighlight(h.id, e.target.checked)}
                        />
                        <span className="rf-highlight-text">
                          {h.text || <em>(empty)</em>}
                          {(h.visibility && h.visibility !== 'public') && (
                            <span className="rf-badge">{h.visibility}</span>
                          )}
                          {h.featured && <span className="rf-badge rf-badge-accent">featured</span>}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      })}
      <button
        type="button"
        className="rf-add"
        onClick={add}
        disabled={records.length === 0}
      >
        <Plus size={15} aria-hidden="true" /> Add {refKey}
      </button>
      {records.length === 0 && (
        <p className="admin-field-hint">No {refKey} records exist yet — create some first.</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Skill groups                                                         */
/* ------------------------------------------------------------------ */

export function SkillGroupsField({ value, onChange }) {
  const list = Array.isArray(value) ? value : [];
  const update = (i, patch) => onChange(replaceAt(list, i, { ...list[i], ...patch }));
  const add = () => onChange([...list, { category: '', items: [] }]);

  return (
    <div className="rf-list">
      {list.length === 0 && (
        <p className="admin-field-hint">No skill groups yet.</p>
      )}
      {list.map((group, i) => (
        <div className="rf-card" key={i}>
          <div className="rf-card-head">
            <input
              className="admin-input rf-ref-select"
              type="text"
              value={group.category ?? ''}
              placeholder="Category (e.g. AI & tooling) — optional"
              onChange={(e) => update(i, { category: e.target.value })}
            />
            <RowControls
              index={i}
              length={list.length}
              onMove={(from, to) => onChange(move(list, from, to))}
              onRemove={(idx) => onChange(removeAt(list, idx))}
              removeLabel="Remove group"
            />
          </div>
          <label className="rf-inline-field rf-inline-field-block">
            <span className="rf-inline-label">Skills (comma separated)</span>
            <input
              className="admin-input"
              type="text"
              value={Array.isArray(group.items) ? group.items.join(', ') : ''}
              placeholder="React, TypeScript, Figma"
              onChange={(e) => update(i, { items: parseTags(e.target.value) })}
            />
          </label>
        </div>
      ))}
      <button type="button" className="rf-add" onClick={add}>
        <Plus size={15} aria-hidden="true" /> Add skill group
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Contact block                                                        */
/* ------------------------------------------------------------------ */

function isEmptyContact(c) {
  if (!c) return true;
  const hasScalar = ['email', 'phone', 'location'].some((k) => c[k]?.trim?.());
  const hasLinks = Array.isArray(c.links) && c.links.length > 0;
  return !hasScalar && !hasLinks;
}

export function ContactField({ value, onChange }) {
  const c = value && typeof value === 'object' ? value : {};
  const links = Array.isArray(c.links) ? c.links : [];

  // Emit undefined for an empty contact so the record omits it (and the resume
  // falls back to the site profile), rather than saving an empty object.
  const commit = (next) => onChange(isEmptyContact(next) ? undefined : next);

  const setField = (key, val) => commit({ ...c, [key]: val || undefined });
  const setLinks = (nextLinks) => commit({ ...c, links: nextLinks.length ? nextLinks : undefined });

  return (
    <div className="rf-contact">
      <label className="rf-inline-field rf-inline-field-block">
        <span className="rf-inline-label">Email</span>
        <input
          className="admin-input"
          type="email"
          value={c.email ?? ''}
          onChange={(e) => setField('email', e.target.value)}
        />
      </label>
      <label className="rf-inline-field rf-inline-field-block">
        <span className="rf-inline-label">Location</span>
        <input
          className="admin-input"
          type="text"
          value={c.location ?? ''}
          placeholder="City, Country"
          onChange={(e) => setField('location', e.target.value)}
        />
      </label>
      <label className="rf-inline-field rf-inline-field-block">
        <span className="rf-inline-label">Phone</span>
        <input
          className="admin-input"
          type="text"
          value={c.phone ?? ''}
          onChange={(e) => setField('phone', e.target.value)}
        />
      </label>

      <div className="rf-inline-label rf-links-label">Links</div>
      <div className="rf-list">
        {links.map((link, i) => (
          <div className="rf-card rf-link-row" key={i}>
            <input
              className="admin-input"
              type="text"
              value={link.label ?? ''}
              placeholder="Label (e.g. Website)"
              onChange={(e) => setLinks(replaceAt(links, i, { ...link, label: e.target.value }))}
            />
            <input
              className="admin-input"
              type="url"
              value={link.url ?? ''}
              placeholder="https://…"
              onChange={(e) => setLinks(replaceAt(links, i, { ...link, url: e.target.value }))}
            />
            <RowControls
              index={i}
              length={links.length}
              onMove={(from, to) => setLinks(move(links, from, to))}
              onRemove={(idx) => setLinks(removeAt(links, idx))}
              removeLabel="Remove link"
            />
          </div>
        ))}
        <button
          type="button"
          className="rf-add"
          onClick={() => setLinks([...links, { label: '', url: '' }])}
        >
          <Plus size={15} aria-hidden="true" /> Add link
        </button>
      </div>
    </div>
  );
}
