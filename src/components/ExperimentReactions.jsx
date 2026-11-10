import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SectionHead from './SectionHead.jsx';
import Time from './Time.jsx';
import { avatarThumb } from '../lib/avatarThumb.js';
import { graphemeLength } from '../lib/guestbook.js';
import { holdReload } from '../lib/reloadHold.js';
import {
  REACTIONS,
  REACTION_TEXT_MAX_GRAPHEMES,
  reactionCountLabel,
  reactionDate,
  reactionFor,
  takesReactions,
  tallyLine,
} from '../lib/experiments.js';
import '../pages/Experimenting.css';

const DEFAULT_ASK = 'What do you make of it?';
const HOP_HINT =
  'You’ll approve one permission on your PDS, saving your reactions here, and land back on this page with it saved. It’s a record on your own PDS, and yours to take back.';

/** "@handle", or a shortened DID for an account whose handle won't resolve. */
function nameOf(person, did) {
  const handle = person?.handle && person.handle !== 'handle.invalid' ? person.handle : null;
  if (handle) return `@${handle}`;
  const id = String(did || person?.did || '');
  return id.length > 24 ? `${id.slice(0, 12)}…${id.slice(-6)}` : id || 'someone';
}

/**
 * The ask and its three answers: the place a visitor reacts to an experiment.
 *
 * The verdicts are buttons that carry their own counts, so the tally and the
 * way to add to it are one row. Signed in, a tap is the whole act: the
 * reaction is written to the visitor's PDS at once, the button they chose
 * takes the "on" look, and tapping it again takes the reaction back. Signed
 * out, a tap picks the verdict and opens the line under it for a handle; the
 * reaction then goes by way of the visitor's PDS and is written when they
 * land back here.
 *
 * `compact` is the index's: no note field (the experiment's own page has it,
 * one link away). An experiment that has stopped taking reactions shows what
 * it got, as words, and no buttons.
 *
 * `reactions` is useExperimentReactions' whole return; `view` is its
 * viewFor(record).
 */
export function ReactionBar({ record, view, reactions, compact = false, detailHref = null }) {
  const ids = useId();
  const subject = record.uri;
  const open = takesReactions(record.value);
  const ask = String(record.value?.ask || '').trim() || DEFAULT_ASK;
  const { signedIn, restoring, signer, busy, errors, react, retract, signOut } = reactions;
  const working = busy === subject;
  const error = errors[subject] || null;
  const mine = view.mine;
  const myVerdict = mine?.value?.reaction || null;
  const myNote = mine?.value?.text || '';

  // The verdict a signed-out visitor has picked, waiting on their handle.
  const [picked, setPicked] = useState(null);
  const [handle, setHandle] = useState('');
  const handleRef = useRef(null);
  // The note as it is being written; null until the visitor touches it, so it
  // follows their saved note until then.
  const [draft, setDraft] = useState(null);
  const note = draft ?? myNote;
  const noteLength = graphemeLength(note);
  const noteOver = noteLength > REACTION_TEXT_MAX_GRAPHEMES;
  const noteChanged = draft !== null && draft.trim() !== myNote;

  // An unsent note is work in progress, and a deploy landing mid-sentence must
  // not reload it away.
  useEffect(() => (noteChanged ? holdReload('experiment-note') : undefined), [noteChanged]);

  // A handle field that has just appeared takes the cursor, at a desk. On a
  // touch screen that would throw the keyboard up over the row just tapped.
  useEffect(() => {
    if (!picked || signedIn) return;
    if (!window.matchMedia?.('(pointer: fine)').matches) return;
    handleRef.current?.focus({ preventScroll: true });
  }, [picked, signedIn]);

  if (!open) {
    const line = tallyLine(view.tally);
    return (
      <div className={`experiment-react is-closed${compact ? ' is-compact' : ''}`}>
        <p className="experiment-react-closed">
          {line
            ? `Reactions are closed. It got ${line}.`
            : 'Reactions are closed, and it got none.'}
        </p>
      </div>
    );
  }

  async function choose(key) {
    if (working || restoring) return;
    if (!signedIn) {
      setPicked((cur) => (cur === key ? null : key));
      return;
    }
    if (myVerdict === key && !noteChanged) {
      await retract(subject);
      setDraft(null);
      return;
    }
    // On the experiment's own page a note being written goes with the
    // verdict; on the index there is no field, so the saved note is kept.
    const ok = await react(subject, key, compact ? undefined : { text: note.trim() });
    if (ok) setDraft(null);
  }

  async function submitSignedOut(event) {
    event.preventDefault();
    if (!picked || working) return;
    if (!handle.trim()) {
      handleRef.current?.focus();
      return;
    }
    await react(subject, picked, { handle: handle.trim(), text: compact ? '' : note.trim() });
  }

  async function saveNote(event) {
    event.preventDefault();
    if (!myVerdict || noteOver || working) return;
    const ok = await react(subject, myVerdict, { text: note.trim() });
    if (ok) setDraft(null);
  }

  const chosen = signedIn ? myVerdict : picked;
  const counted = view.status !== 'loading' && view.status !== 'error';
  const status = working
    ? signedIn
      ? 'Saving to your PDS…'
      : 'Off to your PDS…'
    : restoring
      ? 'Restoring your session…'
      : null;

  return (
    <div className={`experiment-react${compact ? ' is-compact' : ''}`}>
      <p className="experiment-ask" id={`${ids}-ask`}>
        {ask}
      </p>
      <div className="experiment-verdicts" role="group" aria-labelledby={`${ids}-ask`}>
        {REACTIONS.map((r) => {
          const count = counted ? view.tally[r.key] : 0;
          return (
            <button
              key={r.key}
              type="button"
              className={`btn btn--sm experiment-verdict${chosen === r.key ? ' is-on' : ''}`}
              aria-pressed={chosen === r.key}
              title={r.hint}
              disabled={working || restoring}
              onClick={() => choose(r.key)}
            >
              {r.label}
              {count > 0 && (
                <span className="experiment-verdict-count">
                  <span className="visually-hidden">, chosen by </span>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {view.status === 'error' && (
        <p className="experiment-react-line">
          The reactions so far couldn’t be counted just now. Yours will still save.
        </p>
      )}

      {!compact && (signedIn || picked) && (
        <form className="experiment-note" onSubmit={signedIn ? saveNote : submitSignedOut}>
          <label className="visually-hidden" htmlFor={`${ids}-note`}>
            A note to go with your reaction (optional)
          </label>
          <textarea
            id={`${ids}-note`}
            className="experiment-note-write"
            rows={3}
            placeholder="Add a note: what would make it better, what it reminds you of, why not… (optional)"
            value={note}
            onChange={(e) => setDraft(e.target.value)}
            disabled={working}
            aria-describedby={`${ids}-count`}
          />
          <div className="experiment-note-foot">
            <span
              id={`${ids}-count`}
              className={`experiment-note-count${noteOver ? ' is-over' : ''}`}
              aria-live={noteOver ? 'polite' : 'off'}
            >
              {noteLength} / {REACTION_TEXT_MAX_GRAPHEMES}
            </span>
            {signedIn && (
              <button
                type="submit"
                className={`btn btn--sm${noteChanged && myVerdict && !noteOver ? ' btn--primary' : ''}`}
                disabled={!noteChanged || !myVerdict || noteOver || working}
                title={myVerdict ? undefined : 'Pick a reaction to go with it'}
              >
                {myNote ? 'Save changes' : 'Save note'}
              </button>
            )}
          </div>
          {signedIn && !myVerdict && note.trim() && (
            <p className="experiment-react-line">Pick a reaction above and the note goes with it.</p>
          )}
        </form>
      )}

      {!signedIn && picked && !restoring && (
        <form className="experiment-signin" onSubmit={submitSignedOut}>
          <label className="experiment-signin-label" htmlFor={`${ids}-handle`}>
            Sign it
          </label>
          {/* The same guards as the guestbook's field: iOS otherwise
              capitalizes and autocorrects a handle as if it were prose. */}
          <input
            id={`${ids}-handle`}
            ref={handleRef}
            className="experiment-signin-input"
            type="text"
            autoComplete="username"
            autoCorrect="off"
            autoCapitalize="none"
            inputMode="url"
            enterKeyHint="go"
            spellCheck={false}
            placeholder="your atproto handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={working}
          />
          <button type="submit" className="btn btn--sm btn--primary" disabled={working || noteOver}>
            {working ? 'Redirecting…' : (
              <>
                React with atproto <span aria-hidden="true">→</span>
              </>
            )}
          </button>
          <p className="experiment-react-line experiment-signin-help">{HOP_HINT}</p>
        </form>
      )}

      {signedIn && !restoring && (
        <p className="experiment-react-line" aria-live="polite">
          {status || (
            <>
              {myVerdict ? (
                <>
                  You said <strong>{reactionFor(myVerdict)?.tally || myVerdict}</strong>, as{' '}
                  {nameOf(signer)}.{' '}
                  {compact && detailHref && (
                    <>
                      <Link to={`${detailHref}#react`}>{myNote ? 'Edit your note' : 'Add a note'}</Link>
                      <span aria-hidden="true"> · </span>
                    </>
                  )}
                  <button
                    type="button"
                    className="experiment-link-button"
                    onClick={() => retract(subject).then(() => setDraft(null))}
                  >
                    Take it back
                  </button>
                </>
              ) : (
                <>Reacting as {nameOf(signer)}.</>
              )}{' '}
              <button type="button" className="experiment-link-button" onClick={() => signOut?.()}>
                Not you?
              </button>
            </>
          )}
        </p>
      )}
      {!signedIn && status && (
        <p className="experiment-react-line" aria-live="polite">
          {status}
        </p>
      )}

      {error && (
        <p className="experiment-react-line is-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Who said what: one line per person, newest first. The verdict in words
 * beside the handle, the note under it when they left one.
 *
 * A note the language filter flags is left off (the verdict still counts and
 * still shows). The owner sees those, and the reactions on the experiment's
 * hidden list, dimmed and tagged, with a control to hide or restore each: the
 * reaction is the reactor's record and can't be deleted from here, only left
 * out.
 */
export function ReactionList({ record, view, reactions }) {
  const { isOwner } = reactions;
  const rows = isOwner ? view.people : view.standing;
  const total = view.tally.total;
  const loading = view.status === 'loading';
  const meta = loading
    ? null
    : total === 0
      ? 'none yet'
      : `${reactionCountLabel(total)}${view.truncated ? ' and counting' : ''}, newest first`;

  return (
    <section className="experiment-reactions" aria-labelledby="experiment-reactions-h">
      <SectionHead id="experiment-reactions-h" title="Reactions" meta={meta} />
      {loading ? (
        <p className="experiment-react-line">Gathering reactions…</p>
      ) : rows.length === 0 ? (
        <p className="experiment-reactions-empty">
          {view.status === 'error'
            ? 'The backlink index is unreachable right now. The reactions are safe on their authors’ PDSes.'
            : takesReactions(record.value)
              ? 'Nobody has reacted yet. The first one is yours.'
              : 'Nobody reacted to this one.'}
        </p>
      ) : (
        <ul className="experiment-reaction-list reveal-stagger">
          {rows.map((reaction) => (
            <ReactionRow
              key={reaction.uri}
              record={record}
              reaction={reaction}
              hidden={view.hidden.has(reaction.uri)}
              reactions={reactions}
            />
          ))}
        </ul>
      )}
      {view.status === 'stale' && (
        <p className="experiment-source gutter">
          The backlink index is unreachable, so these are the reactions as they stood at the last
          build. Anything since is missing, not lost.
        </p>
      )}
      <p className="experiment-source gutter">
        Each reaction is a record on its author’s own PDS, gathered from backlinks by{' '}
        <a href="https://microcosm.blue" target="_blank" rel="noopener noreferrer">
          microcosm
        </a>
        .
      </p>
    </section>
  );
}

function ReactionRow({ record, reaction, hidden, reactions }) {
  const { isOwner, setHidden } = reactions;
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState(null);
  const person = reaction.profile;
  const handle = person?.handle && person.handle !== 'handle.invalid' ? person.handle : null;
  const verdict = reactionFor(reaction.value.reaction);
  const when = reactionDate(reaction);
  const flagged = reaction.flagged && !hidden;
  // The note shows unless the filter flagged it, which only the owner sees.
  const text = reaction.value.text && (!reaction.flagged || isOwner) ? reaction.value.text : '';

  async function toggle() {
    if (toggling) return;
    setToggling(true);
    setError(null);
    try {
      await setHidden(record, reaction.uri, !hidden);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setToggling(false);
    }
  }

  return (
    <li
      className={`experiment-reaction${hidden || flagged ? ' is-suppressed' : ''}`}
      data-atproto=""
      data-at-uri={reaction.uri}
    >
      <span className="experiment-reaction-avatar" aria-hidden="true">
        {person?.avatar ? (
          <img src={avatarThumb(person.avatar)} alt="" loading="lazy" width={40} height={40} />
        ) : (
          <span className="experiment-reaction-avatar-fallback">@</span>
        )}
      </span>
      <div className="experiment-reaction-body">
        <p className="experiment-reaction-who">
          <span className="experiment-reaction-handle">
            {handle ? (
              <a
                href={`https://bsky.app/profile/${handle}`}
                target="_blank"
                rel="noreferrer noopener"
                title={person?.displayName ? `${person.displayName} · @${handle}` : `@${handle}`}
              >
                @{handle}
              </a>
            ) : (
              nameOf(person, reaction.did)
            )}
          </span>{' '}
          <span className="experiment-reaction-said">
            {verdict ? verdict.said : `said “${reaction.value.reaction}”`}
          </span>
          {when && (
            <>
              {' '}
              <span className="experiment-reaction-time">
                <Time value={when} variant="relative" />
              </span>
            </>
          )}
        </p>
        {text && <p className="experiment-reaction-text">{text}</p>}
        {isOwner && (
          <p className="experiment-reaction-controls">
            {hidden && <span className="tag">hidden</span>}
            {flagged && (
              <span className="tag tag--danger" title="Its note is kept from public view: flagged by the language filter">
                note auto-hidden
              </span>
            )}
            <button
              type="button"
              className="experiment-link-button"
              onClick={toggle}
              disabled={toggling}
              title={
                hidden
                  ? 'Count and show this reaction again'
                  : 'Leave this reaction out of the tally and the list. Their record is untouched.'
              }
            >
              {toggling ? '…' : hidden ? 'unhide' : 'hide'}
            </button>
            {error && <span className="experiment-reaction-error">{error}</span>}
          </p>
        )}
      </div>
    </li>
  );
}
