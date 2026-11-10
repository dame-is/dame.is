import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import Time from '../components/Time.jsx';
import SectionHead from '../components/SectionHead.jsx';
import { FlatLedgerSkeleton } from '../components/Skeleton.jsx';
import { ReactionBar } from '../components/ExperimentReactions.jsx';
import OutArrow from '../components/OutArrow.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { usePageContent } from '../hooks/usePageContent.js';
import { useExperimentReactions } from '../hooks/useExperimentReactions.js';
import { rkeyFromAtUri } from '../lib/atproto.js';
import { smartenText } from '../lib/smartPunctuation.js';
import {
  experimentDate,
  experimentFacts,
  experimentImage,
  experimentLink,
  experimentNumbers,
  experimentPath,
  experimentStatus,
  hasWriteUp,
  isDraftExperiment,
  listExperiments,
} from '../lib/experiments.js';
import { fetchExperimentRecords } from '../lib/experimentReactions.js';
import { ME_DID, EXPERIMENT_NSID } from '../config.js';
import '../components/Feed.css';
import './Experimenting.css';

/** Where the owner writes a new one: the admin's editor for the collection. */
const NEW_EXPERIMENT_HREF = `/admin?c=${encodeURIComponent(EXPERIMENT_NSID)}&mode=new`;

/**
 * The bench: quick prototypes and concepts, newest first, each with the
 * question it is asking and the three answers a visitor can give.
 *
 * An experiment is an `is.dame.experiment` record on my repo. It is posted to
 * find out what people make of it before any more gets built, so each entry
 * carries its own reactions, and a visitor can leave theirs from here without
 * opening it: the tally and the way to add to it are the same row of buttons
 * (ReactionBar). The reactions are records on the reactors' own PDSes,
 * gathered from backlinks; see lib/experimentReactions.js.
 *
 * The page paints from the build's snapshot and confirms against the PDS, as
 * the other record-backed pages do.
 */
export default function Experimenting() {
  const { title, intro } = usePageContent('experimenting');

  const { items: records, status } = useLiveFeed({
    name: 'experimenting',
    strategy: 'snapshot-first',
    fetchLive: async () => ({ experiments: await fetchExperimentRecords() }),
    mapItems: (data) => (Array.isArray(data?.experiments) ? data.experiments : null),
  });

  const reactions = useExperimentReactions(
    // Drafts are the owner's to see, and nobody's to react to.
    useMemo(() => listExperiments(records), [records]),
  );
  const { isOwner } = reactions;
  const list = useMemo(
    () => listExperiments(records, { includeDrafts: isOwner }),
    [records, isOwner],
  );
  const numbers = useMemo(() => experimentNumbers(records), [records]);

  // Back from a sign-in with a reaction just written: bring the experiment it
  // was for into view, since the page reloaded at the top.
  const returned = useRef(null);
  useEffect(() => {
    const uri = reactions.returnedFor;
    if (!uri || returned.current === uri) return;
    returned.current = uri;
    document
      .getElementById(`experiment-${rkeyFromAtUri(uri)}`)
      ?.scrollIntoView({ block: 'center' });
  }, [reactions.returnedFor]);

  const loading = status === 'loading';

  return (
    <PageShell
      title={title}
      intro={intro}
      atUri={`at://${ME_DID}/is.dame.page/experimenting`}
      headTitle="dame.is experimenting"
    >
      {isOwner && (
        <p className="experiment-owner-line">
          <Link className="btn btn--sm" to={NEW_EXPERIMENT_HREF}>
            Post an experiment
          </Link>
          <span className="gutter">Only you can see this.</span>
        </p>
      )}
      {loading ? (
        <FlatLedgerSkeleton rows={4} timeWidth="5rem" label="Loading the experiments" />
      ) : status === 'error' ? (
        // Neither the snapshot nor the PDS answered. That is not an empty
        // bench, and saying so would tell a reader it was.
        <p className="feed-empty">
          Couldn&rsquo;t load the experiments right now.{' '}
          <button type="button" onClick={() => window.location.reload()}>
            Refresh
          </button>
        </p>
      ) : list.length === 0 ? (
        <div className="empty-note experiment-empty">
          <p className="experiment-empty-eyebrow">{EXPERIMENT_NSID} · no records yet</p>
          <p className="experiment-empty-line">
            Nothing on the bench yet. The first experiment will land here.
          </p>
        </div>
      ) : (
        <section className="experiment-bench" aria-labelledby="experiment-bench-h">
          <SectionHead
            id="experiment-bench-h"
            title="On the bench"
            meta={`${numbers.size.toLocaleString('en-US')}, newest first`}
          />
          <ul className="experiment-list reveal-stagger">
            {list.map((record) => (
              <ExperimentEntry
                key={record.uri}
                record={record}
                number={numbers.get(record.uri) ?? null}
                view={reactions.viewFor(record)}
                reactions={reactions}
              />
            ))}
          </ul>
        </section>
      )}
    </PageShell>
  );
}

/**
 * One experiment on the bench: its number and date in the margin, then the
 * title, the pitch, the picture if it has one, where to try it, and the ask.
 * Everything a visitor needs to have an opinion, without a click; the title
 * and the picture lead to its own page, where the write-up and everyone's
 * reactions are.
 */
function ExperimentEntry({ record, number, view, reactions }) {
  const v = record.value;
  const rkey = rkeyFromAtUri(record.uri);
  const href = experimentPath(rkey);
  const date = experimentDate(record);
  const image = experimentImage(v);
  const link = experimentLink(v);
  const status = experimentStatus(v);
  const draft = isDraftExperiment(v);
  const facts = experimentFacts(record);
  const title = smartenText(v.title);

  return (
    <li
      id={`experiment-${rkey}`}
      className={`experiment-entry${draft ? ' is-draft' : ''}`}
      data-nsid={EXPERIMENT_NSID}
      data-atproto=""
      data-at-uri={record.uri}
    >
      <div className="experiment-entry-margin">
        {number != null && (
          <span className="experiment-number">
            <span className="visually-hidden">Experiment </span>
            {number}
          </span>
        )}
        {date && (
          <span className="experiment-date">
            <Time value={date} variant="dateShort" />
          </span>
        )}
      </div>
      <div className="experiment-entry-body">
        <p className="experiment-facts">
          {facts.map((fact) => (
            <span key={fact} className="small-caps">
              {fact}
            </span>
          ))}
          {status.key !== 'open' && <span className="tag">{status.label}</span>}
          {draft && <span className="tag tag--danger">draft</span>}
        </p>
        <h2 className="experiment-title">
          <Link to={href}>{title}</Link>
        </h2>
        {v.pitch && <p className="experiment-pitch">{smartenText(v.pitch)}</p>}
        {image && (
          <Link to={href} className="experiment-figure" tabIndex={-1} aria-hidden="true">
            <img src={image.url} alt="" loading="lazy" />
          </Link>
        )}
        {(link || hasWriteUp(v)) && (
          <p className="experiment-links">
            {link &&
              (link.local ? (
                // A page of this site: it opens here, and isn't "at" anywhere.
                <Link to={link.path}>
                  Try it <span aria-hidden="true">→</span>
                </Link>
              ) : (
                <a href={link.href} target="_blank" rel="noreferrer noopener">
                  Try it at {link.host} <OutArrow />
                </a>
              ))}
            {hasWriteUp(v) && (
              <Link to={href}>
                Read the write-up <span aria-hidden="true">→</span>
              </Link>
            )}
          </p>
        )}
        {!draft && (
          <ReactionBar record={record} view={view} reactions={reactions} compact detailHref={href} />
        )}
        {!draft && view.tally.total > 0 && (
          <p className="experiment-entry-more">
            <Link to={`${href}#reactions`}>
              See {view.tally.total === 1 ? 'the reaction' : `all ${view.tally.total} reactions`}{' '}
              <span aria-hidden="true">→</span>
            </Link>
          </p>
        )}
      </div>
    </li>
  );
}
