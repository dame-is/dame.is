// /experimenting/unblocking: who has been unblocked on Bluesky, and by whom.
//
// Plenty of tools show who blocks you. This one watches for a block being
// taken away. A consumer on a droplet (services/unblock-consumer) keeps every
// live block on the network, and when one is deleted it knows who was just
// let back in; what it concludes reaches this page through api/unblocked.js.
//
// Two things to do here: look an account up, and read the ranking of the
// accounts the most people have unblocked. And one thing to read, at the
// bottom, about how much of the picture this is. The tracker can only put a
// name to an unblock if it saw the block being made, so it starts out knowing
// almost nothing and the page says how much it knows.
//
// It is an experiment, and lives under the bench where an experiment's record
// key would be (UNBLOCKING_PATH in lib/experiments.js). Like /culturing it is
// a page of the site, and what puts it on the bench is an `is.dame.experiment`
// record whose "Try it" points here.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';
import SectionHead from '../components/SectionHead.jsx';
import Time from '../components/Time.jsx';
import { useLiveFeed } from '../hooks/useLiveFeed.js';
import { useProfiles } from '../hooks/useProfiles.js';
import { useAtprotoSession } from '../hooks/useAtprotoSession.jsx';
import { resolveHandle, rkeyFromAtUri } from '../lib/atproto.js';
import { avatarThumb } from '../lib/avatarThumb.js';
import {
  EXPERIMENTING_PATH,
  UNBLOCKING_PATH,
  experimentForPage,
  experimentPath,
} from '../lib/experiments.js';
import { fetchExperimentRecords } from '../lib/experimentReactions.js';
import {
  QUICK_SECONDS,
  cleanActor,
  countPeople,
  fetchBoard,
  fetchLookup,
  heldWords,
  isStale,
  placedShare,
  shareWords,
  usableHandle,
} from '../lib/unblocking.js';
// A person here is set the way a reaction is on an experiment's page: a
// portrait, then who and what on one line.
import './Experimenting.css';
import './Unblocking.css';

const TITLE = 'Unblocking';
const INTRO =
  'Plenty of tools will tell you who blocks you on Bluesky. This one watches for the other thing: a block being taken away. Look up an account to see who has let it back in, and when.';

const QUICK_WORDS = heldWords(QUICK_SECONDS);

/** The ranking and the tracker's status, asked once. */
function useBoard() {
  const [state, setState] = useState({ phase: 'loading', board: null });
  useEffect(() => {
    let live = true;
    fetchBoard().then(
      (board) => live && setState({ phase: 'ready', board }),
      () => live && setState({ phase: 'unavailable', board: null }),
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/**
 * One account's unblocks, for whatever is in the address bar's `who`.
 *
 * phase: idle (nothing asked), loading, ready, unknown (no such account),
 * invalid (not a handle or a DID), unavailable (the tracker can't be reached).
 */
function useLookup(who) {
  const actor = useMemo(() => cleanActor(who), [who]);
  const [state, setState] = useState({ phase: 'idle', actor: '', did: null, result: null });

  useEffect(() => {
    if (!who) {
      setState({ phase: 'idle', actor: '', did: null, result: null });
      return undefined;
    }
    if (!actor) {
      setState({ phase: 'invalid', actor: who, did: null, result: null });
      return undefined;
    }
    let live = true;
    setState({ phase: 'loading', actor, did: null, result: null });
    (async () => {
      let did = actor;
      if (!actor.startsWith('did:')) {
        did = await resolveHandle(actor).catch(() => null);
        if (!did) {
          if (live) setState({ phase: 'unknown', actor, did: null, result: null });
          return;
        }
      }
      try {
        const result = await fetchLookup(did);
        if (live) setState({ phase: 'ready', actor, did, result });
      } catch {
        if (live) setState({ phase: 'unavailable', actor, did, result: null });
      }
    })();
    return () => {
      live = false;
    };
  }, [who, actor]);

  return state;
}

export default function Unblocking() {
  const [params, setParams] = useSearchParams();
  const who = params.get('who') || '';
  const { phase: boardPhase, board } = useBoard();
  const lookup = useLookup(who);
  const { did: myDid } = useAtprotoSession();

  // The experiment record that points here, for the way to its reactions.
  const { items: records } = useLiveFeed({
    name: 'experimenting',
    strategy: 'snapshot-first',
    fetchLive: async () => ({ experiments: await fetchExperimentRecords() }),
    mapItems: (data) => (Array.isArray(data?.experiments) ? data.experiments : null),
  });
  const record = useMemo(() => experimentForPage(records, UNBLOCKING_PATH), [records]);

  const dids = useMemo(() => {
    const out = (board?.leaderboard || []).map((row) => row.did);
    if (lookup.did) out.push(lookup.did);
    for (const event of lookup.result?.events || []) out.push(event.did);
    return out;
  }, [board, lookup.did, lookup.result]);
  const profiles = useProfiles(dids);

  function lookUp(value) {
    const next = String(value || '').trim();
    setParams(next ? { who: cleanActor(next) || next } : {}, { replace: false });
  }

  // Picked from the ranking, an account's answer is further up the page than
  // the row that was tapped. Bring the lookup into view for it.
  const lookupRef = useRef(null);
  function pick(actor) {
    lookUp(actor);
    lookupRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  return (
    <PageShell
      title={TITLE}
      intro={INTRO}
      facts={
        <>
          <span>
            <Link to={EXPERIMENTING_PATH}>An experiment</Link>
          </span>
          {record && (
            <span>
              <span aria-hidden="true"> · </span>
              <Link to={`${experimentPath(rkeyFromAtUri(record.uri))}#react`}>
                Say what you make of it
              </Link>
            </span>
          )}
        </>
      }
      headTitle={`${TITLE} — dame.is experimenting`}
    >
      <div className="unblocking">
        <section className="unblocking-section unblocking-lookup-section" aria-labelledby="unblocking-lookup-h" ref={lookupRef}>
          <SectionHead id="unblocking-lookup-h" title="Look an account up" />
          <LookupForm key={who} initial={who} onLookUp={lookUp} myDid={myDid} asked={lookup.did} />
          <LookupResult lookup={lookup} profiles={profiles} status={board?.status} />
        </section>

        <section className="unblocking-section" aria-labelledby="unblocking-board-h">
          <SectionHead
            id="unblocking-board-h"
            title="Most unblocked"
            meta={
              boardPhase === 'ready' && board.unblocks > 0
                ? `${board.unblocks.toLocaleString('en-US')} unblocks on record`
                : null
            }
          />
          <Board phase={boardPhase} board={board} profiles={profiles} onPick={pick} />
        </section>

        <section className="unblocking-section" aria-labelledby="unblocking-notes-h">
          <SectionHead id="unblocking-notes-h" title="What this can and can’t see" />
          <Notes phase={boardPhase} status={board?.status} />
        </section>
      </div>
    </PageShell>
  );
}

/* ── looking an account up ────────────────────────────────────────────────── */

function LookupForm({ initial, onLookUp, myDid, asked }) {
  const ids = useId();
  const [value, setValue] = useState(initial);

  return (
    <form
      className="unblocking-lookup"
      onSubmit={(event) => {
        event.preventDefault();
        onLookUp(value);
      }}
    >
      <label className="unblocking-lookup-label" htmlFor={`${ids}-who`}>
        Handle
      </label>
      {/* The guards the site's other handle fields carry: iOS otherwise
          capitalizes and autocorrects a handle as if it were prose. */}
      <input
        id={`${ids}-who`}
        className="unblocking-lookup-input"
        type="text"
        name="who"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        inputMode="url"
        enterKeyHint="search"
        spellCheck={false}
        placeholder="yours, or anyone’s"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="submit" className="btn btn--sm btn--primary">
        Look up
      </button>
      {myDid && asked !== myDid && (
        <p className="unblocking-lookup-self">
          <button type="button" className="btn btn--text" onClick={() => onLookUp(myDid)}>
            Look yourself up
          </button>
        </p>
      )}
    </form>
  );
}

/** "@handle" once the profile has answered; the name as typed until then. */
function nameFor(did, profiles, fallback = '') {
  const handle = usableHandle(profiles[did]);
  if (handle) return `@${handle}`;
  if (fallback && !fallback.startsWith('did:')) return `@${fallback}`;
  return 'this account';
}

function LookupResult({ lookup, profiles, status }) {
  const { phase, actor, did, result } = lookup;
  if (phase === 'idle') return null;

  if (phase === 'loading') {
    return (
      <p className="unblocking-line" aria-live="polite">
        Looking…
      </p>
    );
  }
  if (phase === 'invalid') {
    return (
      <p className="unblocking-line" role="alert">
        “{actor}” doesn’t read as a handle. Try one like <span className="ident">name.bsky.social</span>.
      </p>
    );
  }
  if (phase === 'unknown') {
    return (
      <p className="unblocking-line" role="alert">
        No account answers to <span className="ident">{actor}</span>.
      </p>
    );
  }
  if (phase === 'unavailable') {
    return (
      <p className="unblocking-line" role="alert">
        The tracker can’t be reached right now, so there is nothing to show for {nameFor(did, profiles, actor)}.
      </p>
    );
  }

  const name = nameFor(did, profiles, actor);
  const stood = result.total - result.quick;
  const since = status?.horizonAt || status?.startedAt || null;

  return (
    <div className="unblocking-result" aria-live="polite">
      {result.total === 0 ? (
        <>
          <p className="unblocking-headline">Nobody has unblocked {name}, as far as the tracker has seen.</p>
          <p className="unblocking-aside">
            That isn’t the same as nobody having done it.
            {since ? (
              <>
                {' '}
                It can only name an unblock if the block was made after{' '}
                <Time value={since} variant="dateShort" />, when it began keeping them.
              </>
            ) : (
              ' It can only name an unblock if it saw the block being made.'
            )}
          </p>
        </>
      ) : (
        <>
          <p className="unblocking-headline">
            {stood > 0 ? (
              <>
                {countPeople(stood)} {stood === 1 ? 'has' : 'have'} unblocked {name}.
              </>
            ) : (
              <>Nobody has unblocked {name} after a block that lasted.</>
            )}
          </p>
          {result.quick > 0 && (
            <p className="unblocking-aside">
              {stood > 0 ? 'Another ' : ''}
              {countPeople(result.quick)} blocked and unblocked within {QUICK_WORDS}. That is usually a soft
              block, done to remove a follower, so {result.quick === 1 ? 'it is' : 'they are'} listed but not
              counted.
            </p>
          )}
          <ul className="experiment-reaction-list unblocking-list">
            {result.events.map((event) => (
              <UnblockRow key={event.did} event={event} person={profiles[event.did]} />
            ))}
          </ul>
          {result.events.length < result.total && (
            <p className="unblocking-aside">
              These are the newest {result.events.length.toLocaleString('en-US')} of{' '}
              {result.total.toLocaleString('en-US')}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Portrait({ person }) {
  return (
    <span className="experiment-reaction-avatar" aria-hidden="true">
      {person?.avatar ? (
        <img src={avatarThumb(person.avatar)} alt="" loading="lazy" width={40} height={40} />
      ) : (
        <span className="experiment-reaction-avatar-fallback">@</span>
      )}
    </span>
  );
}

/** An account by its handle, linked to its profile; its DID until that is known. */
function Handle({ did, person }) {
  const handle = usableHandle(person);
  if (!handle) return <span className="ident">{did}</span>;
  return (
    <a
      href={`https://bsky.app/profile/${handle}`}
      target="_blank"
      rel="noreferrer noopener"
      title={person.displayName ? `${person.displayName} · @${handle}` : `@${handle}`}
    >
      @{handle}
    </a>
  );
}

function UnblockRow({ event, person }) {
  return (
    <li className={`experiment-reaction${event.quick ? ' unblocking-quick' : ''}`}>
      <Portrait person={person} />
      <div className="experiment-reaction-body">
        <p className="experiment-reaction-who">
          <span className="experiment-reaction-handle">
            <Handle did={event.did} person={person} />
          </span>{' '}
          <span>
            {event.quick
              ? `blocked and unblocked within ${heldWords(event.heldSeconds)}`
              : `unblocked after ${heldWords(event.heldSeconds)}`}
          </span>{' '}
          <span className="experiment-reaction-time">
            <Time value={event.unblockedAt} variant="relative" />
          </span>
        </p>
      </div>
    </li>
  );
}

/* ── the ranking ──────────────────────────────────────────────────────────── */

function Board({ phase, board, profiles, onPick }) {
  if (phase === 'loading') {
    return (
      <p className="unblocking-line" aria-live="polite">
        Asking the tracker…
      </p>
    );
  }
  if (phase === 'unavailable') {
    return <p className="empty-note">The tracker can’t be reached right now.</p>;
  }
  if (board.leaderboard.length === 0) {
    return (
      <p className="empty-note">
        {board.status
          ? 'Nobody yet. It takes a block and then an unblock, both since the tracker began, to get on this list.'
          : 'The tracker hasn’t reported in yet.'}
      </p>
    );
  }

  return (
    <>
      <ol className="unblocking-board reveal-stagger">
        {board.leaderboard.map((row, i) => {
          const person = profiles[row.did];
          return (
            <li key={row.did} className="unblocking-board-row">
              <span className="unblocking-rank">{i + 1}</span>
              <Portrait person={person} />
              <span className="unblocking-who">
                {person?.displayName && <span className="unblocking-name">{person.displayName}</span>}
                <span className="unblocking-handle">
                  <Handle did={row.did} person={person} />
                </span>
              </span>
              <button
                type="button"
                className="btn btn--text unblocking-count"
                onClick={() => onPick(usableHandle(person) || row.did)}
                title="See who"
              >
                {countPeople(row.count)}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="unblocking-aside">
        Ranked by how many different accounts have unblocked each one. A block undone within {QUICK_WORDS}{' '}
        isn’t counted.
      </p>
    </>
  );
}

/* ── how much of the picture this is ──────────────────────────────────────── */

function Notes({ phase, status }) {
  const share = placedShare(status);
  const sameDay = status && status.horizonAt.slice(0, 10) === status.startedAt.slice(0, 10);

  return (
    <ul className="unblocking-notes">
      {status && (
        <li>
          It has been watching since <Time value={status.startedAt} variant="date" />. A deleted block doesn’t
          say who it was on, so the tracker can only name an unblock if it saw the block being made
          {sameDay ? (
            '.'
          ) : (
            <>
              , and it keeps blocks back to <Time value={status.horizonAt} variant="date" />.
            </>
          )}
          {share != null && (
            <>
              {' '}
              Of the {status.deletesSeen.toLocaleString('en-US')} blocks it has seen deleted, it could put a
              name to {status.deletesPlaced.toLocaleString('en-US')} ({shareWords(share)}). That share grows
              the longer it runs.
            </>
          )}
        </li>
      )}
      {status && isStale(status) && (
        <li>
          It last heard from the network <Time value={status.lastEventAt} variant="relative" />, which is
          longer than it should be. It may have stopped, and anything since then is missing.
        </li>
      )}
      {phase === 'ready' && !status && (
        <li>The tracker hasn’t reported in yet, so there is nothing here to qualify.</li>
      )}
      <li>
        An unblock stays on this page until the same account blocks the same person again. Then it comes off:
        this is who has let someone back in, and somebody who has since changed their mind isn’t one of them.
      </li>
      <li>
        A block that is undone within {QUICK_WORDS} is set apart. Blocking and then unblocking straight away
        removes someone as a follower without leaving them blocked, which is a different thing from thinking
        better of a block. Where the line falls is a guess that hasn’t been checked against much yet.
      </li>
      <li>
        Only one account blocking another is watched. Blocking a whole list is a different record, and coming
        off a list someone blocks doesn’t show up here.
      </li>
      <li>
        An account deleting itself isn’t counted as that account unblocking anybody, and what was said here
        about a deleted account is removed.
      </li>
      <li>
        None of this is private information. A block is a public record on Bluesky and so is deleting one;
        anything on this page can be read off the network by anyone who watches it.
      </li>
    </ul>
  );
}
