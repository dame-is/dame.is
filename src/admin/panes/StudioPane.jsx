// The single dispatch point for every studio surface — the bespoke tools that
// own their own state (sky, nav, publications, guestbook, pages, resume,
// ratioed, listening, analytics, legacy blogs) as opposed to the generic
// record list.
//
// Everything in this file exists to make ONE promise to the studios: you are a
// body, not a page. The pane draws the title, the blurb and the surface's NSID;
// the rail is the way back; the status strip owns Save and Delete. A studio that
// still renders its own PageShell, its own "← All collections" link, or its own
// save bar is fighting the shell for the same job.
//
// Prop signatures are preserved verbatim from what each component already takes,
// so the studios themselves change as little as possible:
//
//   { agent, did }            SkyThemeStudio, RatioedPanel, RatioedStudio,
//                             NavMenuPanel, ResumeStudio, PagesOverview,
//                             LegacyBlogMigration, ListeningManager,
//                             AnalyticsStudio
//   { agent }                 GuestbookModerationPanel — it derives the repo from
//                             agent.assertDid inside setEntryHidden
//   { agent, did, rkey, isNew, onPaneMeta }
//                             PublicationsManager — selection moved into the URL,
//                             and it renames this pane's head while a record is open
//   { agent, did, rkey, bundle } ResumeWorkbench
//   { agent, did, bundle }    ResumeStudio
//
// Two structural decisions, both load-bearing:
//
//  1. **StudioPane itself is never keyed.** It stays mounted across
//     `view=resume` → `view=resume-tailor`, which is what lets the resume bundle
//     be fetched once for both.
//  2. **The child studio element IS keyed on `surface.key`.** That is what
//     unmounts RatioedStudio — and closes its Jetstream socket, ~166 KB/s — the
//     moment another surface is selected.

import { createElement, useCallback, useRef, useState } from 'react';
import AnalyticsStudio from '../../components/AnalyticsStudio.jsx';
import GuestbookModerationPanel from '../../components/GuestbookModerationPanel.jsx';
import LegacyBlogMigration from '../../components/LegacyBlogMigration.jsx';
import ListeningManager from '../../components/ListeningManager.jsx';
import NavMenuPanel from '../../components/NavMenuPanel.jsx';
import PagesOverview from '../../components/PagesOverview.jsx';
import PublicationsManager from '../../components/PublicationsManager.jsx';
import RatioedPanel from '../../components/RatioedPanel.jsx';
import RatioedStudio from '../../components/RatioedStudio.jsx';
import SkyThemeStudio from '../../components/SkyThemeStudio.jsx';
import ResumeStudio from '../../components/resume/ResumeStudio.jsx';
import ResumeWorkbench from '../../components/resume/ResumeWorkbench.jsx';
import { useResumeBundle } from '../../components/resume/useResumeBundle.js';
import './StudioPane.css';

/** surface.key → the component that renders it. */
const STUDIOS = {
  listening: ListeningManager,
  pages: PagesOverview,
  nav: NavMenuPanel,
  sky: SkyThemeStudio,
  publications: PublicationsManager,
  guestbook: GuestbookModerationPanel,
  resume: ResumeStudio,
  'resume-tailor': ResumeWorkbench,
  'ratioed-studio': RatioedStudio,
  ratioed: RatioedPanel,
  analytics: AnalyticsStudio,
  'legacy-blogs': LegacyBlogMigration,
};

/**
 * Which extra props each studio takes beyond `{ agent, did }`. Kept as data so
 * the render body stays one expression and adding a studio is one line in two
 * tables rather than a new branch.
 */
const NEEDS_RKEY = new Set(['publications', 'resume-tailor']);
const NEEDS_BUNDLE = new Set(['resume', 'resume-tailor']);
/** GuestbookModerationPanel takes `agent` alone and derives the repo itself. */
const NO_DID = new Set(['guestbook']);
/**
 * Studios that own a SUBJECT of their own inside the surface, and so get
 * `onPaneMeta` to rename this pane's head.
 *
 * A studio surface's label and blurb describe the LIST — "Publications" / "The
 * publications behind the Standard Site embeds." — which is the wrong caption
 * once you are editing one record inside it. The head kept saying that while
 * the record's own name was set 12px high in a leftover toolbar row underneath,
 * i.e. the smallest text on the screen named the thing being edited and the
 * 28px heading named the list you had left. A studio in this set may hand the
 * pane a `{ title, blurb }` and the head draws that instead.
 */
const NEEDS_PANE_META = new Set(['publications']);

/**
 * @param {object} props
 * @param {import('../surfaces.js').AdminSurface} props.surface
 * @param {object} props.agent
 * @param {string} props.did
 * @param {string|null} props.rkey   The `r` param — legal on a `?view=` surface.
 * @param {boolean} props.isNew      `mode === 'new'`.
 */
export default function StudioPane({ surface, agent, did, rkey = null, isNew = false }) {
  const isResume = NEEDS_BUNDLE.has(surface.key);
  // Unconditional call — hooks cannot be conditional, and the hook's own
  // `if (!agent || !did) return undefined` guard makes this a ZERO-REQUEST no-op
  // on every other surface. Without that guard, mounting any studio would fire
  // four fully-paginated listRecords sweeps.
  const bundle = useResumeBundle(isResume ? agent : null, isResume ? did : null);

  const Studio = STUDIOS[surface.key] || null;

  // What the studio wants the head to say, stamped with the SUBJECT it was
  // reported for. Stamping is what makes a stale title impossible: the studio
  // publishes from an effect, so between the URL changing and that effect
  // running there is one render where the old title would otherwise still be on
  // screen over the new record. The stamp is compared below and a mismatch
  // simply falls back to the surface's own label.
  const subject = `${surface.key}|${rkey || ''}|${isNew ? 'new' : ''}`;
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  const [meta, setMeta] = useState(null);
  // Identity-stable, like the shell's own registration callbacks: a studio puts
  // this in an effect's dep array, and one that changed every render would loop.
  const onPaneMeta = useCallback(
    (next) => setMeta(next ? { ...next, subject: subjectRef.current } : null),
    [],
  );
  const active = meta && meta.subject === subject ? meta : null;

  const props = { agent };
  if (!NO_DID.has(surface.key)) props.did = did;
  if (NEEDS_RKEY.has(surface.key)) {
    props.rkey = rkey;
    props.isNew = isNew;
  }
  if (NEEDS_PANE_META.has(surface.key)) props.onPaneMeta = onPaneMeta;
  if (isResume) props.bundle = bundle;

  const title = active?.title || surface.label;
  const blurb = active ? active.blurb : surface.blurb;

  return (
    <div className="wb-studio">
      <div className="wb-pane-head">
        <h1 className="wb-pane-title">{title}</h1>
        {surface.nsid && <code className="admin-collection-nsid">{surface.nsid}</code>}
      </div>
      {blurb && <p className="wb-pane-blurb">{blurb}</p>}
      {Studio ? (
        // Keyed on the surface, so switching surfaces genuinely unmounts the
        // previous studio (sockets, timers, scans) rather than reusing its
        // instance under new props.
        createElement(Studio, { key: surface.key, ...props })
      ) : (
        <p className="placeholder-card">
          No studio is registered for <code className="admin-collection-nsid">{surface.key}</code>.
        </p>
      )}
    </div>
  );
}
