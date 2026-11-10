import { useEffect, useMemo, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import LeafletDocument from '../components/LeafletDocument.jsx';
import SequenceFoot from '../components/SequenceFoot.jsx';
import Time from '../components/Time.jsx';
import { DocumentSkeleton } from '../components/Skeleton.jsx';
import { InspectMargin } from '../components/XraySubstrate.jsx';
import { ReactionBar, ReactionList } from '../components/ExperimentReactions.jsx';
import OutArrow from '../components/OutArrow.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useExperimentReactions } from '../hooks/useExperimentReactions.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { smartenText } from '../lib/smartPunctuation.js';
import { formatDateShort } from '../lib/time.js';
import {
  EXPERIMENTING_PATH,
  experimentDate,
  experimentFacts,
  experimentImage,
  experimentLink,
  experimentNumbers,
  experimentPath,
  experimentStatus,
  findExperiment,
  hasWriteUp,
  isDraftExperiment,
  listExperiments,
} from '../lib/experiments.js';
import { fetchExperimentRecords } from '../lib/experimentReactions.js';
import './Blogging.css';
import './Experimenting.css';

/**
 * One experiment, at `/experimenting/{rkey}`: the pitch, the picture, where
 * to try it, the longer write-up when there is one, and then what the page is
 * for, the ask and everyone's answers to it.
 *
 * The live read lists the whole collection rather than fetching the one
 * record. It is one request either way (the collection is a handful of
 * records), and the list is what numbers this experiment and names its
 * neighbours.
 */
export default function Experiment() {
  const { rkey } = useParams();
  const { hash } = useLocation();

  const { items: records, status } = useLiveFeed({
    name: 'experimenting',
    strategy: 'snapshot-first',
    fetchLive: async () => ({ experiments: await fetchExperimentRecords() }),
    // Null while the snapshot doesn't know this record, so the page keeps
    // waiting on the live read instead of flashing "not found" for one posted
    // since the build.
    mapItems: (data) => {
      const list = Array.isArray(data?.experiments) ? data.experiments : null;
      return list && findExperiment(list, rkey, { includeDrafts: true }) ? list : null;
    },
    deps: [rkey],
  });

  const found = useMemo(
    () => findExperiment(records, rkey, { includeDrafts: true }),
    [records, rkey],
  );
  // A draft takes no reactions, so none are gathered for one.
  const reactable = useMemo(
    () => (found && !isDraftExperiment(found.value) ? [found] : []),
    [found],
  );
  const reactions = useExperimentReactions(reactable);
  const { isOwner } = reactions;
  // A draft is the owner's to see. To anyone else it isn't there, even by
  // its address.
  const record = found && (!isDraftExperiment(found.value) || isOwner) ? found : null;

  // `#react` and `#reactions` arrive from the index, and from a sign-in that
  // started here. The router doesn't scroll to a fragment by itself, and the
  // target isn't in the document until the record is.
  const scrolled = useRef(null);
  const ready = Boolean(record);
  useEffect(() => {
    if (!ready || !hash || scrolled.current === hash) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    scrolled.current = hash;
    target.scrollIntoView({ block: 'start' });
  }, [ready, hash]);

  if (status === 'loading') {
    return (
      <PageShell headTitle="An experiment — dame.is">
        <DocumentSkeleton kind="work" />
      </PageShell>
    );
  }

  // A load that failed outright (no snapshot, no PDS) must not read as "not
  // found": that would break a shared link over a blip. Keep the address and
  // offer a refresh.
  if (status === 'error') {
    return (
      <PageShell title="Couldn’t load this right now" headTitle="Couldn’t load — dame.is">
        <p>Couldn&rsquo;t load this experiment right now. Refresh to try again.</p>
        <p>
          <button type="button" onClick={() => window.location.reload()}>
            Refresh
          </button>{' '}
          <Link to={EXPERIMENTING_PATH}>Back to the bench.</Link>
        </p>
      </PageShell>
    );
  }

  if (!record) {
    return (
      <PageShell title="Experiment not found" headTitle="Not found — dame.is">
        <p>
          No experiment with the key <code>{rkey}</code>.{' '}
          <Link to={EXPERIMENTING_PATH}>Back to the bench.</Link>
        </p>
      </PageShell>
    );
  }

  const v = record.value;
  const title = smartenText(v.title);
  const date = experimentDate(record);
  const image = experimentImage(v);
  const link = experimentLink(v);
  const status_ = experimentStatus(v);
  const draft = isDraftExperiment(v);
  const number = experimentNumbers(records).get(record.uri) ?? null;
  const view = reactions.viewFor(record);

  return (
    <PageShell
      title={title}
      intro={v.pitch ? smartenText(v.pitch) : null}
      facts={
        <>
          {[...experimentFacts(record, number), date && <Time key="date" value={date} />]
            .filter(Boolean)
            .map((fact, i) => (
              <span key={typeof fact === 'string' ? fact : 'date'}>
                {i > 0 && <span aria-hidden="true"> · </span>}
                {fact}
              </span>
            ))}
          {status_.key !== 'open' && <span className="tag experiment-facts-tag">{status_.label}</span>}
          {draft && <span className="tag tag--danger experiment-facts-tag">draft</span>}
        </>
      }
      atUri={record.uri}
      cid={record.cid}
      headTitle={`${v.title} — dame.is experimenting`}
    >
      <article className="experiment-page reveal">
        <InspectMargin atUri={record.uri} cid={record.cid} />
        {image && (
          <figure className="experiment-figure experiment-figure-full">
            <img src={image.url} alt={image.alt} />
          </figure>
        )}
        {link && (
          <p className="experiment-try">
            {link.local ? (
              // A page of this site: it opens here, with no host to name.
              <Link className="btn" to={link.path}>
                Try it
              </Link>
            ) : (
              <>
                <a className="btn" href={link.href} target="_blank" rel="noreferrer noopener">
                  Try it <OutArrow />
                </a>
                <span className="experiment-try-host">{link.host}</span>
              </>
            )}
          </p>
        )}
        {hasWriteUp(v) && (
          <div className="experiment-writeup">
            <LeafletDocument doc={v.content} atUri={record.uri} cid={record.cid} />
          </div>
        )}

        {draft ? (
          <p className="experiment-react-line">
            This is a draft: only you can see it, and it takes no reactions until it&rsquo;s
            published.
          </p>
        ) : (
          <>
            {/* The anchors a link lands on. Each sits on the block it names,
                with room above it for the chrome's running head. */}
            <div id="react" className="experiment-anchor">
              <ReactionBar record={record} view={view} reactions={reactions} />
            </div>
            <div id="reactions" className="experiment-anchor">
              <ReactionList record={record} view={view} reactions={reactions} />
            </div>
          </>
        )}

        <ExperimentFoot record={record} records={records} />
      </article>
    </PageShell>
  );
}

/** Earlier and later experiments, and the way back up to the bench. */
function ExperimentFoot({ record, records }) {
  const list = listExperiments(records);
  const i = list.findIndex((r) => r.uri === record.uri);
  if (i < 0 || list.length < 2) return null;
  const entry = (r) =>
    r
      ? {
          to: experimentPath(rkeyFromAtUri(r.uri)),
          title: smartenText(r.value.title),
          meta: formatDateShort(experimentDate(r)) || null,
        }
      : null;
  return (
    <SequenceFoot
      label="Other experiments"
      earlierLabel="Earlier experiment"
      laterLabel="Later experiment"
      earlier={entry(list[i + 1])}
      later={entry(list[i - 1])}
      earlierNone="None. This is the first."
      laterNone="None. This is the latest."
      all={{ to: EXPERIMENTING_PATH, label: `All ${list.length} experiments` }}
    />
  );
}
