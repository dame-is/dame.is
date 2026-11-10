// The results for the island being played: who has posted one, quickest
// first, and a way to add your own.
//
// The game doesn't know how results are posted or where they are kept. That
// is the host's business, handed in as `social`:
//
//   viewer     who is signed in ({ did, handle, displayName, avatar }) or null
//   restoring  true while a remembered sign-in is being picked back up
//   busy       true while a post is on its way
//   error      why the last post didn't go, in words, or null
//   posted     { [board key]: days } for what this visit has posted
//   post(result, { handle })   post a finished island; signed out, `handle`
//              is who to sign in as, and the page may leave and come back
//   board(result)              everyone's results: { entries, total, truncated }
//   boardKey(result)           the key of the board a result belongs on
//   signOut()
//
// and a result is `{ island, date, days }` (farm.result()).

import { useEffect, useState } from 'react';
import { CheckIcon, ResultsIcon } from './icons.jsx';

function Who({ profile, did }) {
  const name =
    profile?.displayName ||
    (profile?.handle ? `@${profile.handle}` : 'Someone');
  return (
    <>
      <span className="sunfarm-board-face" aria-hidden="true">
        {profile?.avatar ? (
          <img
            src={profile.avatar}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          '@'
        )}
      </span>
      <span className="sunfarm-board-who">
        <span className="sunfarm-board-name">{name}</span>
        {profile?.handle && profile.displayName ? (
          <span className="sunfarm-board-handle">@{profile.handle}</span>
        ) : !profile?.handle ? (
          <span className="sunfarm-board-handle">
            {String(did).slice(0, 20)}…
          </span>
        ) : null}
      </span>
    </>
  );
}

export default function Board({ farm, social, island, done }) {
  const result = farm.result();
  const which = { island: island.id, date: island.date };
  const key = social.boardKey(which);
  const mine = key ? social.posted[key] : undefined;
  const [handle, setHandle] = useState('');
  const [state, setState] = useState({
    status: 'loading',
    entries: [],
    total: 0,
  });

  // Read the board when it is opened, and again when a result is posted.
  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({
      ...prev,
      status: prev.entries.length ? 'refreshing' : 'loading',
    }));
    Promise.resolve(
      social.board({ island: island.id, date: island.date }),
    ).then(
      (found) => {
        if (cancelled) return;
        if (!found) setState({ status: 'error', entries: [], total: 0 });
        else setState({ status: 'ready', ...found });
      },
      () => {
        if (!cancelled) setState({ status: 'error', entries: [], total: 0 });
      },
    );
    return () => {
      cancelled = true;
    };
    // `social.board` is stable; the board is re-read for a new island or post.
  }, [island.id, island.date, mine]); // eslint-disable-line react-hooks/exhaustive-deps

  const viewer = social.viewer;
  const myLine = viewer
    ? state.entries.find((entry) => entry.did === viewer.did)
    : null;
  const posted = mine !== undefined || Boolean(myLine);
  const better = result && myLine && result.days < myLine.days;

  const submit = (event) => {
    event?.preventDefault();
    if (!result || social.busy) return;
    social.post(result, viewer ? {} : { handle });
  };

  return (
    <div className="sunfarm-board">
      <p className="sunfarm-card-lede">
        {island.daily ? `Today’s island, ${island.date}` : island.name}: days
        taken to get it off diesel and onto the sun.
      </p>

      {state.status === 'loading' && (
        <p className="sunfarm-board-note">Gathering results…</p>
      )}
      {state.status === 'error' && (
        <p className="sunfarm-board-note">
          The results couldn’t be reached just now.
        </p>
      )}
      {state.status !== 'loading' &&
        state.status !== 'error' &&
        state.entries.length === 0 && (
          <p className="sunfarm-board-note">
            Nobody has posted a result for this island yet.
          </p>
        )}
      {state.entries.length > 0 && (
        <ol className="sunfarm-board-list">
          {state.entries.map((entry, i) => (
            <li
              key={entry.did}
              className={
                viewer && entry.did === viewer.did ? 'is-me' : undefined
              }
            >
              <span className="sunfarm-board-rank">{i + 1}</span>
              <Who profile={entry.profile} did={entry.did} />
              <span className="sunfarm-board-days">
                {entry.days} {entry.days === 1 ? 'day' : 'days'}
              </span>
            </li>
          ))}
        </ol>
      )}
      {state.truncated && (
        <p className="sunfarm-board-note">
          There are more than are shown here.
        </p>
      )}

      <div className="sunfarm-board-mine">
        {!done || !result ? (
          <p className="sunfarm-board-note">
            Finish the island and your result can go here, signed with your
            atproto account.
          </p>
        ) : posted && !better ? (
          <p className="sunfarm-board-posted">
            <CheckIcon size={16} />
            Your result is posted: {myLine ? myLine.days : mine} days.
          </p>
        ) : (
          <form className="sunfarm-board-form" onSubmit={submit}>
            <p className="sunfarm-board-yours">
              {better ? 'A quicker run than the one you posted' : 'Your result'}
              : <strong>{result.days} days</strong>
            </p>
            {!viewer && !social.restoring && (
              <label className="sunfarm-board-field">
                <span>Your atproto handle</span>
                <input
                  type="text"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="you.bsky.social"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck="false"
                  inputMode="url"
                  enterKeyHint="go"
                />
              </label>
            )}
            <button
              type="submit"
              className="sunfarm-btn sunfarm-btn--primary"
              disabled={social.busy || social.restoring}
            >
              <ResultsIcon size={18} />
              {social.busy
                ? 'Posting…'
                : viewer
                  ? better
                    ? 'Post the quicker result'
                    : 'Post my result'
                  : 'Sign in and post'}
            </button>
          </form>
        )}
        {social.error && (
          <p className="sunfarm-board-error" role="alert">
            {social.error}
          </p>
        )}
      </div>

      <p className="sunfarm-card-small">
        A result is a small record on your own account’s server, which you can
        delete. Nobody checks it: it is what your game said.
        {viewer && (
          <>
            {' '}
            Signed in as {viewer.handle
              ? `@${viewer.handle}`
              : 'your account'}.{' '}
            <button
              type="button"
              className="sunfarm-link"
              onClick={() => social.signOut()}
            >
              Sign out
            </button>
          </>
        )}
      </p>
    </div>
  );
}
