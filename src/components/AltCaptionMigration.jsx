// Alt text to captions: give the older documents back the words under their
// pictures.
//
// An image block with no caption used to print its alt text in that place, and
// some documents were written to it (a painting's title and size, a figure's
// source). The page now prints only a block's caption, so this lists every
// document with images that have alt text and no caption, shows what that text
// says, and copies it into the caption for the documents ticked. Nothing is
// ticked to begin with: whether an alt is a caption or a description of the
// picture is the author's call, and copying a description would print it under
// the picture again.
//
// The alt text stays. Each document is written whole and swapped against the
// version this list read, so one edited elsewhere since is left alone.

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { stampAutoTimestamps } from '../admin/recordFields.js';
import { lexiconFor } from '../lib/lexicons.js';
import { uncaptionedImages, withAltCaptions } from '../lib/altCaptions.js';
import { canonicalWorkPath, isPortfolioDoc } from '../lib/publications.js';
import { isSwapConflict } from '../lib/recordWrites.js';
import Button from './Button.jsx';
import './siteStudios.css';
import './AltCaptionMigration.css';

const STANDARD_DOC = 'site.standard.document';
// Alt texts shown before the rest fold away; a gallery of eighteen paintings
// would otherwise make one row a page long.
const PREVIEW = 3;

const rkeyOf = (uri) => String(uri || '').split('/').pop();

/** Where the document reads on the site. */
function publicPath(value, rkey) {
  return isPortfolioDoc(value) ? canonicalWorkPath(value, rkey) : `/blogging/${rkey}`;
}

/** Every site.standard.document in the repo, a page of 100 at a time. */
async function listDocuments(agent, did) {
  const out = [];
  let cursor;
  for (let i = 0; i < 50; i += 1) {
    const res = await agent.com.atproto.repo.listRecords({
      repo: did,
      collection: STANDARD_DOC,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    const data = res?.data || res;
    out.push(...(data?.records || []));
    cursor = data?.cursor;
    if (!cursor || !data?.records?.length) break;
  }
  return out;
}

export default function AltCaptionMigration({ agent, did }) {
  // The Front Desk counts and the Blogging and Creating lists read this
  // collection; a write here drops their cached copy (see LegacyBlogMigration).
  const { invalidate } = useAdminShell();
  const [docs, setDocs] = useState(null); // [{ rkey, uri, cid, value, alts }]
  const [loadError, setLoadError] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [state, setState] = useState({}); // rkey → { status, message }
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const records = await listDocuments(agent, did);
      setDocs(
        records
          .map((r) => ({
            rkey: rkeyOf(r.uri),
            uri: r.uri,
            cid: r.cid,
            value: r.value,
            alts: uncaptionedImages(r.value).map((img) => img.alt),
          }))
          .filter((d) => d.alts.length > 0)
          .sort((a, b) => String(a.value?.title || a.rkey).localeCompare(String(b.value?.title || b.rkey))),
      );
    } catch (err) {
      setLoadError(err?.message || String(err));
      setDocs([]);
    }
  }, [agent, did]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (rkey, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(rkey);
      else next.delete(rkey);
      return next;
    });

  const run = useCallback(async () => {
    setRunning(true);
    const lex = lexiconFor(STANDARD_DOC);
    let wrote = false;
    // One at a time, so each row's result reads in order and a failure stops
    // nothing but its own document.
    for (const doc of docs || []) {
      if (!picked.has(doc.rkey)) continue;
      setState((s) => ({ ...s, [doc.rkey]: { status: 'running', message: 'Copying…' } }));
      try {
        const { value, count } = withAltCaptions(doc.value);
        const record = stampAutoTimestamps(lex, value);
        const res = await agent.com.atproto.repo.putRecord({
          repo: did,
          collection: STANDARD_DOC,
          rkey: doc.rkey,
          record,
          swapRecord: doc.cid,
        });
        wrote = true;
        const cid = (res?.data || res)?.cid;
        setDocs((prev) =>
          prev.map((d) => (d.rkey === doc.rkey ? { ...d, value: record, cid } : d)),
        );
        setPicked((prev) => {
          const next = new Set(prev);
          next.delete(doc.rkey);
          return next;
        });
        setState((s) => ({
          ...s,
          [doc.rkey]: {
            status: 'done',
            message: `${count} caption${count === 1 ? '' : 's'} added.`,
          },
        }));
      } catch (err) {
        setState((s) => ({
          ...s,
          [doc.rkey]: {
            status: 'error',
            message: isSwapConflict(err)
              ? 'Changed since this list loaded, so it was left as it is. Reload the list and try again.'
              : err?.message || String(err),
          },
        }));
      }
    }
    if (wrote) invalidate(STANDARD_DOC);
    setRunning(false);
  }, [agent, did, docs, picked, invalidate]);

  const pickedCount = picked.size;
  const imageCount = (docs || [])
    .filter((d) => picked.has(d.rkey))
    .reduce((n, d) => n + d.alts.length, 0);

  return (
    <>
      <p className="ss-note">
        These documents have pictures with alt text and no caption. The page
        used to print that alt text as the caption; it now prints captions only.
        Tick the documents whose alt text is really a caption, a title or a
        source, and copy it across. The alt text stays as it is.
      </p>

      <div className="ss-actions">
        <Button variant="primary" onClick={run} disabled={running || pickedCount === 0}>
          {running
            ? 'Copying…'
            : pickedCount === 0
              ? 'Copy alt text to captions'
              : `Copy alt text to ${imageCount} caption${imageCount === 1 ? '' : 's'}`}
        </Button>
        <Button variant="text" size="sm" onClick={load} disabled={running}>
          Reload the list
        </Button>
      </div>

      {loadError && <p className="ss-error">Couldn’t read the documents: {loadError}</p>}

      {docs == null ? (
        <p className="ss-hint">Reading your documents…</p>
      ) : docs.length === 0 && !loadError ? (
        <p className="ss-empty">Every picture with alt text has a caption of its own.</p>
      ) : (
        <ul className="ss-rows acm-list">
          {docs.map((doc) => {
            const st = state[doc.rkey];
            const done = st?.status === 'done';
            const href = publicPath(doc.value, doc.rkey);
            const title = doc.value?.title || doc.rkey;
            const shown = doc.alts.slice(0, PREVIEW);
            const rest = doc.alts.slice(PREVIEW);
            return (
              <li key={doc.rkey} className={`ss-row acm-row${done ? ' is-done' : ''}`}>
                <label className="admin-checkbox acm-check">
                  <input
                    type="checkbox"
                    checked={picked.has(doc.rkey)}
                    disabled={running || done}
                    onChange={(e) => toggle(doc.rkey, e.target.checked)}
                    aria-label={`Copy alt text to captions in “${title}”`}
                  />
                </label>
                <div className="acm-main">
                  <span className="acm-title">{title}</span>
                  <div className="acm-meta">
                    {href && (
                      <Link to={href} className="ident">
                        {href}
                      </Link>
                    )}
                    <span>
                      {doc.alts.length} picture{doc.alts.length === 1 ? '' : 's'} without a caption
                    </span>
                  </div>
                  <ul className="acm-alts">
                    {shown.map((alt, i) => (
                      <li key={i}>{alt}</li>
                    ))}
                  </ul>
                  {rest.length > 0 && (
                    <details className="acm-more">
                      <summary>{rest.length} more</summary>
                      <ul className="acm-alts">
                        {rest.map((alt, i) => (
                          <li key={i}>{alt}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {st?.message && (
                    <p
                      className={`acm-status${st.status === 'error' ? ' ss-error' : ''}${
                        done ? ' ss-saved' : ''
                      }`}
                    >
                      {st.message}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
