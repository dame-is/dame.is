import { useEffect, useMemo, useState } from 'react';
import { ChevronUp, ChevronDown, Copy, GitBranch, Plus, X } from 'lucide-react';
import { COLLECTIONS } from '../config.js';
import {
  parseHighlightRef,
  makeHighlightRef,
  nextHighlightId,
  nextVariantId,
  resolveHighlightRef,
  collectHighlightUsage,
} from '../lib/resumeHelpers.js';

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

/**
 * Comma-separated tags input that keeps the caret where the user put it.
 *
 * Binding an <input> straight to `array.join(', ')` and re-parsing on every
 * keystroke makes React overwrite the field with a normalized string, which
 * yanks the caret to the end whenever you edit mid-string. Instead we hold the
 * raw text locally and only re-sync from props when the incoming value differs
 * from what the current text already parses to — i.e. on an external change (a
 * record loaded, a reset), never as an echo of the user's own typing.
 *
 * `onChange` receives the parsed array; callers decide whether an empty array
 * should be stored as `[]` or dropped.
 */
export function TagsInput({ id, value, onChange, placeholder, className = 'admin-input' }) {
  const [text, setText] = useState(() => (Array.isArray(value) ? value.join(', ') : ''));

  useEffect(() => {
    const fromProps = Array.isArray(value) ? value : [];
    // Compare with a sentinel that can't survive trimming into a tag, so
    // the check is exact and never collapses "a b" vs ["a", "b"].
    if (fromProps.join('\u0000') !== parseTags(text).join('\u0000')) {
      setText(fromProps.join(', '));
    }
    // Keyed on `value` only: re-sync on external changes, not on the local
    // edits that produced this `value` in the first place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      id={id}
      className={className}
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        onChange(parseTags(e.target.value));
      }}
    />
  );
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

/** Dedupe usage rows into short "which resumes" labels for a chip. */
function usageSummary(rows) {
  const labels = [];
  const seen = new Set();
  for (const u of rows || []) {
    if (seen.has(u.rkey)) continue;
    seen.add(u.rkey);
    labels.push(u.label);
  }
  return labels;
}

/** "Used by primary, product-design" chip, or nothing when unused. */
function UsageChip({ rows }) {
  const labels = usageSummary(rows);
  if (labels.length === 0) return null;
  return (
    <span
      className="rf-usage"
      title={`Selected by: ${labels.join(', ')}`}
    >
      used by {labels.join(', ')}
    </span>
  );
}

/**
 * Bullet editor for a job/education record's `highlights`.
 *
 * Beyond text + flags, each bullet can be forked into **variants** — alternate
 * phrasings of the same point that resumes pick individually (`h3#v2` refs).
 * When `agent`/`did`/`recordUri` are provided, every resume is scanned so each
 * bullet (and variant) shows which versions currently use it, and removals of
 * in-use bullets ask first.
 */
export function HighlightsField({ value, onChange, agent, did, recordUri, usageKeys }) {
  const list = Array.isArray(value) ? value : [];

  // Which resumes use these bullets. Only loaded when we know the record's
  // own URI (i.e. editing an existing job/education record, not a new one).
  const { records: resumes } = useCollectionRecords(
    agent,
    did,
    recordUri ? COLLECTIONS.resume : null,
  );
  const usage = useMemo(() => {
    if (!recordUri || !resumes) return new Map();
    return collectHighlightUsage({
      resumes,
      recordUri,
      listKey: usageKeys?.listKey || 'entries',
      refKey: usageKeys?.refKey || 'job',
      highlights: list,
    });
  }, [resumes, recordUri, usageKeys, list]);

  const update = (i, patch) => onChange(replaceAt(list, i, { ...list[i], ...patch }));

  const add = () =>
    onChange([
      ...list,
      { id: nextHighlightId(list), text: '', visibility: 'public', featured: false, metric: false },
    ]);

  const duplicate = (i) => {
    const src = list[i];
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = nextHighlightId(list);
    delete copy.variants; // a duplicated bullet is a new point — forks stay with the original
    const next = list.slice();
    next.splice(i + 1, 0, copy);
    onChange(next);
  };

  const remove = (i) => {
    const h = list[i];
    const used = usageSummary(usage.get(h?.id));
    if (used.length > 0) {
      const ok = window.confirm(
        `“${truncateText(h?.text, 80)}” is selected by: ${used.join(', ')}.\n` +
          'Removing it will drop the bullet from those resumes on your next save. Remove anyway?',
      );
      if (!ok) return;
    }
    onChange(removeAt(list, i));
  };

  const fork = (i) => {
    const h = list[i];
    const variants = Array.isArray(h.variants) ? h.variants : [];
    const v = { id: nextVariantId(variants), text: h.text || '', label: '' };
    update(i, { variants: [...variants, v] });
  };

  const updateVariant = (i, vi, patch) => {
    const variants = (list[i].variants || []).slice();
    variants[vi] = { ...variants[vi], ...patch };
    update(i, { variants });
  };

  const removeVariant = (i, vi) => {
    const h = list[i];
    const v = (h.variants || [])[vi];
    const rows = (usage.get(h?.id) || []).filter((u) => u.variantId === v?.id);
    const used = usageSummary(rows);
    if (used.length > 0) {
      const ok = window.confirm(
        `This phrasing is picked by: ${used.join(', ')}.\n` +
          'Those resumes will fall back to the canonical text. Remove it anyway?',
      );
      if (!ok) return;
    }
    const variants = (h.variants || []).slice();
    variants.splice(vi, 1);
    update(i, { variants: variants.length ? variants : undefined });
  };

  return (
    <div className="rf-list">
      {list.length === 0 && (
        <p className="admin-field-hint">No highlights yet. Add achievement bullets below.</p>
      )}
      {list.map((h, i) => (
        <div className="rf-card" key={h.id || i}>
          <div className="rf-card-head">
            <code className="rf-id">{h.id || '—'}</code>
            <UsageChip rows={usage.get(h.id)} />
            <div className="rf-controls">
              <button
                type="button"
                className="rf-icon-btn"
                onClick={() => fork(i)}
                aria-label="Fork into a variant phrasing"
                title="Fork — add an alternate phrasing resumes can pick"
              >
                <GitBranch size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="rf-icon-btn"
                onClick={() => duplicate(i)}
                aria-label="Duplicate as a new bullet"
                title="Duplicate as a new bullet"
              >
                <Copy size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="rf-icon-btn"
                onClick={() => onChange(move(list, i, i - 1))}
                disabled={i === 0}
                aria-label="Move up"
                title="Move up"
              >
                <ChevronUp size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="rf-icon-btn"
                onClick={() => onChange(move(list, i, i + 1))}
                disabled={i === list.length - 1}
                aria-label="Move down"
                title="Move down"
              >
                <ChevronDown size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="rf-icon-btn rf-icon-btn-danger"
                onClick={() => remove(i)}
                aria-label="Remove highlight"
                title="Remove highlight"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>
          </div>
          <textarea
            className="admin-input admin-textarea"
            rows={2}
            value={h.text ?? ''}
            placeholder="Shipped X, driving Y% growth…"
            onChange={(e) => update(i, { text: e.target.value })}
          />
          {Array.isArray(h.variants) && h.variants.length > 0 && (
            <div className="rf-variants">
              <span className="rf-inline-label">
                Variants — alternate phrasings of this same point
              </span>
              {h.variants.map((v, vi) => (
                <div className="rf-variant" key={v.id || vi}>
                  <div className="rf-card-head">
                    <code className="rf-id">{makeHighlightRef(h.id, v.id)}</code>
                    <input
                      className="admin-input rf-variant-label"
                      type="text"
                      value={v.label ?? ''}
                      placeholder="label, e.g. design-focused"
                      onChange={(e) => updateVariant(i, vi, { label: e.target.value || undefined })}
                    />
                    <UsageChip
                      rows={(usage.get(h.id) || []).filter((u) => u.variantId === v.id)}
                    />
                    <div className="rf-controls">
                      <button
                        type="button"
                        className="rf-icon-btn rf-icon-btn-danger"
                        onClick={() => removeVariant(i, vi)}
                        aria-label="Remove variant"
                        title="Remove variant"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <textarea
                    className="admin-input admin-textarea"
                    rows={2}
                    value={v.text ?? ''}
                    placeholder="The same achievement, framed differently…"
                    onChange={(e) => updateVariant(i, vi, { text: e.target.value })}
                  />
                </div>
              ))}
            </div>
          )}
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
            <TagsInput
              value={h.tags}
              placeholder="growth, leadership"
              onChange={(tags) => update(i, { tags: tags.length ? tags : undefined })}
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

function truncateText(s, n) {
  const str = String(s || '');
  return str.length <= n ? str : `${str.slice(0, n - 1).trimEnd()}…`;
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
        const refs = explicit ? entry.highlightIds : defaultHighlightIds(rec);
        // Map of base highlight id → the full ref selecting it (bare or #variant).
        const refByBase = new Map(refs.map((r) => [parseHighlightRef(r).id, r]));
        const naturalIndex = new Map(highlights.map((h, idx) => [h.id, idx]));

        const setCustomize = (on) => {
          if (on) update(i, { highlightIds: defaultHighlightIds(rec) });
          else {
            const next = { ...list[i] };
            delete next.highlightIds;
            onChange(replaceAt(list, i, next));
          }
        };

        // Toggle a bullet without disturbing the rest of the selection's
        // order (a custom order set in the tailoring workbench survives).
        // A newly checked bullet slots in at its natural position.
        const toggleHighlight = (id, on) => {
          const current = refs.slice();
          if (!on) {
            update(i, { highlightIds: current.filter((r) => parseHighlightRef(r).id !== id) });
            return;
          }
          const idx = naturalIndex.get(id) ?? Infinity;
          let insertAt = current.length;
          for (let k = 0; k < current.length; k += 1) {
            const other = naturalIndex.get(parseHighlightRef(current[k]).id) ?? Infinity;
            if (other > idx) {
              insertAt = k;
              break;
            }
          }
          current.splice(insertAt, 0, id);
          update(i, { highlightIds: current });
        };

        // Swap which phrasing an included bullet uses (canonical or a variant),
        // keeping its position in the selection.
        const setVariant = (id, variantId) => {
          update(i, {
            highlightIds: refs.map((r) =>
              parseHighlightRef(r).id === id ? makeHighlightRef(id, variantId || null) : r,
            ),
          });
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
                  {highlights.map((h) => {
                    const selectedRef = refByBase.get(h.id);
                    const included = refByBase.has(h.id);
                    const { variantId } = parseHighlightRef(selectedRef || h.id);
                    const variants = Array.isArray(h.variants) ? h.variants : [];
                    const shownText = included && selectedRef
                      ? resolveHighlightRef(rec?.value, selectedRef)?.text ?? h.text
                      : h.text;
                    return (
                      <li key={h.id} className="rf-highlight-row">
                        <label className="admin-checkbox rf-checkbox">
                          <input
                            type="checkbox"
                            disabled={!explicit}
                            checked={included}
                            onChange={(e) => toggleHighlight(h.id, e.target.checked)}
                          />
                          <span className="rf-highlight-text">
                            {shownText || <em>(empty)</em>}
                            {(h.visibility && h.visibility !== 'public') && (
                              <span className="rf-badge">{h.visibility}</span>
                            )}
                            {h.featured && <span className="rf-badge rf-badge-accent">featured</span>}
                          </span>
                        </label>
                        {explicit && included && variants.length > 0 && (
                          <label className="rf-inline-field rf-variant-pick">
                            <span className="rf-inline-label">Phrasing</span>
                            <select
                              className="admin-input rf-select-sm"
                              value={variantId || ''}
                              onChange={(e) => setVariant(h.id, e.target.value || null)}
                            >
                              <option value="">canonical</option>
                              {variants.map((v) => (
                                <option key={v.id} value={v.id}>
                                  {v.label || v.id}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                      </li>
                    );
                  })}
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
            <TagsInput
              value={group.items}
              placeholder="React, TypeScript, Figma"
              onChange={(items) => update(i, { items })}
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
