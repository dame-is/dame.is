import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import Lightbox from '../components/Lightbox.jsx';
import { MothTile } from '../components/MothTile.jsx';
import Figures from '../components/Figures.jsx';
import SequenceFoot from '../components/SequenceFoot.jsx';
import { MothingSkeleton } from '../components/Skeleton.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { fetchMothData, fetchMothSignature } from '../lib/inaturalist.js';
import { firstSightingIds } from '../lib/firstSightings.js';
import {
  findNight,
  formatNightDate,
  formatNightDay,
  isCalendarDate,
  mothLightboxImages,
  nightBeyondReach,
  nightLength,
  nightPath,
  nightSpanCompact,
  weekdayOf,
} from '../lib/mothing.js';
import { fetchSnapshot } from '../lib/snapshot.js';
import { INATURALIST_USER, INATURALIST_URL } from '../config.js';
import '../components/Feed.css';
import './Mothing.css';

/**
 * One mothing session — a single night at the light — as a card gallery.
 *
 * The night's date IS its address (`/mothing/2026-08-18`), which is what
 * makes it shareable: a session isn't a record on the PDS, it's a grouping
 * the site derives from the observations that fall inside one 8pm–3am window
 * (see `buildSessions`). So this page derives it again from the same data the
 * index reads, rather than fetching anything of its own.
 *
 * `/mothing/:slug` is one route serving two things — a date lands here, an
 * iNaturalist observation id lands on Record.jsx. See App.jsx.
 */
// "This date genuinely had no session at the light." Distinct from null,
// which keeps useLiveFeed at `loading` while the live pull is still out.
const NO_SESSION = { session: null };

const NO_FIRSTS = new Set();

export default function MothingNight() {
  const { rkey: date } = useParams();

  const { items, status } = useLiveFeed({
    name: 'mothing',
    strategy: 'snapshot-first',
    deps: [date],
    // Same two-step the index uses: the build snapshot is at most six hours
    // old, so take a cheap signature first and only re-pull everything when
    // iNaturalist has actually moved.
    fetchLive: async () => {
      const snap = await fetchSnapshot('mothing');
      if (snap?.sync?.latestUpdatedAt) {
        try {
          const sig = await fetchMothSignature({ user: INATURALIST_USER });
          if (sig.count === snap.sync.count && sig.latestUpdatedAt === snap.sync.latestUpdatedAt) {
            return snap;
          }
        } catch {
          // Signature check failed — fall through to a normal full fetch.
        }
      }
      return fetchMothData({ user: INATURALIST_USER });
    },
    mapItems: (data) => {
      const observations = Array.isArray(data?.observations) ? data.observations : null;
      if (!observations) return null;
      // A date-shaped slug the calendar doesn't have (`2026-13-45`) can never
      // hold a session — say so now rather than wait on the live pull.
      if (!isCalendarDate(date)) return NO_SESSION;
      const found = findNight(observations, date);
      // Which of this night's moths were lifers has to be decided against
      // every OTHER night as well, so it's settled here, where the whole pull
      // is in hand, rather than inside the night — and not at all from a pull
      // that stopped short, which is missing the oldest sightings, the firsts.
      if (found) {
        return {
          ...found,
          firstIds: data.truncated ? NO_FIRSTS : firstSightingIds(observations),
        };
      }
      // A miss means one of two things, and they want opposite treatment. If
      // the date is past what this copy can answer for, the copy is simply
      // behind — hold at `loading` (null does that) so a night logged since
      // the last build shows a skeleton until the live pull answers, instead
      // of flashing "no night here" and then filling in. Any older date is a
      // real miss and should say so at once.
      return nightBeyondReach(observations, date) ? null : NO_SESSION;
    },
  });

  const night = items || null;
  const session = night?.session || null;
  const firstIds = night?.firstIds || NO_FIRSTS;

  const lightboxImages = useMemo(
    () => mothLightboxImages(session?.observations || []),
    [session],
  );
  // The active lightbox index, -1 when closed. Keyed on the night's own
  // observations, so prev/next walks this night and stops at its edges.
  const [lightbox, setLightbox] = useState(-1);
  const indexById = useMemo(() => {
    const map = new Map();
    (session?.observations || []).filter((o) => o.photos?.[0]).forEach((o, i) => map.set(o.id, i));
    return map;
  }, [session]);

  // The way back up to every night is the pinned breadcrumb, as on every
  // detail page (see ChromeBar), so there's no "← Mothing" eyebrow here.
  if (status === 'loading') {
    return (
      <PageShell
        headTitle={`Night of ${formatNightDate(date) || date} — dame.is`}
      >
        <MothingSkeleton sessions={1} cells={8} />
      </PageShell>
    );
  }

  // Not reaching iNaturalist (or the snapshot) isn't "no night here": a shared
  // link that fails for a moment should say so and offer another go, as the
  // other detail pages do, rather than call the night missing.
  if (status === 'error') {
    return (
      <PageShell
        title="Couldn’t load this right now"
        headTitle="Couldn’t load — dame.is"
      >
        <p>
          Couldn&rsquo;t load this night&rsquo;s observations right now —
          refresh to try again.
        </p>
        <p>
          <button type="button" onClick={() => window.location.reload()}>
            Refresh
          </button>{' '}
          <Link to="/mothing">Back to every night.</Link>
        </p>
      </PageShell>
    );
  }

  if (!session) {
    return (
      <PageShell title="No night here" headTitle="Not found — dame.is">
        <p>
          No mothing session on <strong>{formatNightDate(date) || date}</strong>. A session is
          one night at the light, so only the nights that were spent there have a page.{' '}
          <Link to="/mothing">Back to every night.</Link>
        </p>
      </PageShell>
    );
  }

  const span = nightSpanCompact(session);
  const { newer, older, total } = night;
  const firsts = session.observations.filter((o) => firstIds.has(o.id)).length;
  // Species seen more than once tonight, for the species figure's note.
  const tally = new Map();
  for (const o of session.observations) {
    const id = o.taxon?.id;
    if (id != null) tally.set(id, (tally.get(id) || 0) + 1);
  }
  const repeats = [...tally.values()].filter((n) => n > 1);
  const repeatNote = repeats.length
    ? `${repeats.length} of them seen ${repeats.every((n) => n === 2) ? 'twice' : 'more than once'}`
    : null;

  return (
    <PageShell
      title={`Night of ${formatNightDate(session.date)}`}
      headTitle={`Night of ${formatNightDate(session.date)} — dame.is`}
      crumb={formatNightDay(session.date)}
    >
      <Figures
        layout="inline"
        label="This night in figures"
        items={[
          {
            key: 'night',
            value: `No. ${session.number}`,
            label: 'night',
            note: total ? `of ${total}${session.number === total ? ', the latest' : ''}` : null,
          },
          {
            key: 'moths',
            value: session.observationCount,
            label: 'moths',
            note: firsts ? `${firsts} first ${firsts === 1 ? 'sighting' : 'sightings'}` : null,
          },
          { key: 'species', value: session.speciesCount, label: 'species', note: repeatNote },
          { key: 'light', value: span, label: 'at the light', note: nightLength(session) || null, wide: true },
        ]}
      />

      <ul className="mothing-grid reveal-stagger">
        {session.observations.map((obs) => (
          <MothTile
            key={obs.id}
            obs={obs}
            onOpen={(o) => setLightbox(indexById.get(o.id) ?? -1)}
            first={firstIds.has(obs.id)}
          />
        ))}
      </ul>

      <SequenceFoot
        label="Other nights"
        earlierLabel="Earlier night"
        laterLabel="Later night"
        earlier={
          older
            ? { to: nightPath(older.date), title: formatNightDate(older.date), meta: `${weekdayOf(older.date)} · No. ${older.number}` }
            : null
        }
        later={
          newer
            ? { to: nightPath(newer.date), title: formatNightDate(newer.date), meta: `${weekdayOf(newer.date)} · No. ${newer.number}` }
            : null
        }
        earlierNone="None. This was the first night."
        laterNone="None yet. This is the latest night."
        all={{ to: '/mothing', label: `All ${total} nights` }}
      />

      <p className="mothing-source gutter">
        Mirrored from{' '}
        <a href={INATURALIST_URL} target="_blank" rel="noopener noreferrer">
          iNaturalist
        </a>
        .
      </p>

      <Lightbox
        open={lightbox >= 0}
        index={Math.max(0, lightbox)}
        onClose={() => setLightbox(-1)}
        images={lightboxImages}
      />
    </PageShell>
  );
}
