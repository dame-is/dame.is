import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { pageDefault } from '../lib/pageRegistry.js';
import { blankRecordFor } from '../lib/lexicons.js';
import { COLLECTIONS } from '../config.js';
import { getRecordIfExists, isSwapConflict } from '../lib/recordWrites.js';
import { useAdminShell } from '../admin/useAdminShell.jsx';
import { Skeleton } from './Skeleton.jsx';
import Button from './Button.jsx';
import Tag from './Tag.jsx';
import './siteStudios.css';
import './PageContentPanel.css';

/**
 * Link props for one `is.dame.page` record on the GENERIC records surface —
 * which is where page records are actually edited — as both the `to` a real
 * `<Link>` needs and an onClick that routes through the shell's `go`.
 *
 * The explicit `view: null` is the load-bearing part. `go` is merge-only, and a
 * leftover `view=pages` beats `c` in `resolveSurface`'s precedence, so without
 * it "Edit" pressed inside the Site-pages studio would resolve straight back to
 * that studio and read as a dead click. Going through `go` rather than letting
 * the `<Link>` navigate is what runs the unsaved-changes guard — this panel has
 * no edits of its own, but it renders beside a detail pane that may.
 *
 * Modified and non-primary clicks are left to the browser, so cmd-click still
 * opens a record in a new tab.
 *
 * @param {(patch: object) => void} go   from `useAdminShell()`
 * @param {string|null} rkey             the page slug, or null for a new record
 * @param {{mode?: string|null}} [opts]
 */
export function pageRecordLink(go, rkey, { mode = null } = {}) {
  const patch = { view: null, c: COLLECTIONS.page, r: rkey, mode, for: null };
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(patch)) if (value != null) query.set(key, value);
  return {
    to: `/admin?${query}`,
    onClick: (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
      event.preventDefault();
      go(patch);
    },
  };
}

/**
 * Local-vs-PDS control for a single page's chrome (title / intro / body).
 *
 * Shows whether an `is.dame.page/<slug>` record exists and lets the owner
 * migrate the hardcoded defaults onto the PDS, edit the record, or revert
 * back to local (delete the record).
 *
 * Used in two places, both of them inside the admin shell:
 *   - embedded atop a backing collection's record list (self-fetches status)
 *   - the standalone Site-pages studio (status seeded via the `exists` prop
 *     from one batched listRecords, so it skips the per-panel getRecord)
 *
 * Either way it is one ruled row: the page, where its title and intro come
 * from (a Tag and the record's path), and the actions. `inList` is the
 * studio's case, where a "Page content" head above the rows already says what
 * each row is about; embedded on its own, the row names it.
 */
export default function PageContentPanel({ agent, did, slug, exists: initialExists, inList = false }) {
  const { go } = useAdminShell();
  const def = pageDefault(slug);
  const [exists, setExists] = useState(initialExists);
  const [checking, setChecking] = useState(initialExists === undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // A status check that failed for any reason but "no such record". The card
  // then says it does not know, rather than calling the page local.
  const [checkError, setCheckError] = useState(null);
  const [checkNonce, setCheckNonce] = useState(0);

  // Self-fetch status when the caller didn't supply it (embedded usage).
  useEffect(() => {
    if (initialExists !== undefined) {
      setExists(initialExists);
      setChecking(false);
      setCheckError(null);
      return undefined;
    }
    let cancelled = false;
    setChecking(true);
    setCheckError(null);
    getRecordIfExists(agent, {
      repo: did,
      collection: COLLECTIONS.page,
      rkey: slug,
    })
      .then((res) => {
        if (!cancelled) setExists(Boolean(res));
      })
      .catch((err) => {
        if (cancelled) return;
        setExists(undefined);
        setCheckError(err?.message || String(err));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agent, did, slug, initialExists, checkNonce]);
  const unknown = !checking && Boolean(checkError);

  /* --- focus survives the card rebuilding itself -------------------------- */

  // Migrate and Revert each REPLACE the control that was pressed: the card's
  // action row swaps between "Edit + Revert to local" and "Migrate to PDS", so
  // the button the owner activated is unmounted by their own click and focus
  // lands on <body>. Getting back then costs the full tab run past the top bar
  // and the whole rail. So the card claims focus for whatever now stands where
  // the pressed control was — its new primary.
  const primaryRef = useRef(null);
  const wantFocus = useRef(false);
  useLayoutEffect(() => {
    const el = primaryRef.current;
    // Left armed rather than cleared when the target is momentarily disabled
    // (`busy`), so the focus still lands on the commit that re-enables it.
    if (!wantFocus.current || !el || el.disabled) return;
    wantFocus.current = false;
    el.focus();
  });

  const migrate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const record = { ...blankRecordFor(COLLECTIONS.page), title: def.title, intro: def.intro };
      if (def.body) record.body = def.body;
      await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: COLLECTIONS.page,
        rkey: slug,
        record,
        // Only if there is no record yet. "Migrate" is offered whenever the
        // status check above came back with anything but a record — a network
        // error included — and a plain put would then replace the real, edited
        // page with the hardcoded defaults.
        swapRecord: null,
      });
      wantFocus.current = true;
      setExists(true);
    } catch (err) {
      if (isSwapConflict(err)) {
        setExists(true);
        setError(
          `is.dame.page/${slug} is already on your PDS, so it was left as it is.`,
        );
      } else {
        setError(err?.message || String(err));
      }
    } finally {
      setBusy(false);
    }
  }, [agent, did, slug, def]);

  const revert = useCallback(async () => {
    if (
      !window.confirm(
        `Revert "${def.label}" to local? This deletes is.dame.page/${slug} from your PDS; the page falls back to its hardcoded title and intro.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await agent.com.atproto.repo.deleteRecord({ repo: did, collection: COLLECTIONS.page, rkey: slug });
      wantFocus.current = true;
      setExists(false);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }, [agent, did, slug, def]);

  if (!def) return null;

  return (
    <div className="pcp-wrap">
      <div className="pcp">
        <span className="pcp-name">{inList ? def.label : `${def.label} page content`}</span>
        <span className="pcp-source">
          {checking ? (
            <Skeleton width="11rem" height="0.85em" />
          ) : unknown ? (
            <span className="reveal pcp-source-line">
              <Tag tone="danger">unknown</Tag>
              <span>
                Couldn’t check for <span className="ident">is.dame.page/{slug}</span>: {checkError}
              </span>
            </span>
          ) : exists ? (
            <span className="reveal pcp-source-line">
              <Tag on>on PDS</Tag>
              <span className="ident">is.dame.page/{slug}</span>
            </span>
          ) : (
            <span className="reveal pcp-source-line">
              <Tag>built in</Tag>
              <span>hardcoded in the site</span>
            </span>
          )}
        </span>
        <span className="pcp-actions">
          {unknown ? (
            <Button
              ref={primaryRef}
              size="sm"
              onClick={() => {
                // This button is replaced while the check runs; hand focus to
                // whatever stands in its place once it is settled. The check is
                // marked as running here, in the click's own commit, so the
                // focus is not spent on this button before it goes.
                wantFocus.current = true;
                setChecking(true);
                setCheckError(null);
                setCheckNonce((n) => n + 1);
              }}
            >
              Check again
            </Button>
          ) : exists ? (
            <>
              <Button as={Link} ref={primaryRef} size="sm" {...pageRecordLink(go, slug)}>
                Edit
              </Button>
              <Button size="sm" variant="danger" onClick={revert} disabled={busy}>
                {busy ? 'Reverting…' : 'Revert to local'}
              </Button>
            </>
          ) : (
            <Button ref={primaryRef} size="sm" onClick={migrate} disabled={busy || checking}>
              {busy ? 'Migrating…' : 'Migrate to PDS'}
            </Button>
          )}
        </span>
        {error && <p className="ss-error pcp-error">{error}</p>}
      </div>
    </div>
  );
}
