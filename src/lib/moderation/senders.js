// Who is this message from, and what are they allowed to ask for?
//
// ONE MODULE BECAUSE IT IS ONE QUESTION. The public path and the DM path each
// had their own answer, and they had already drifted: `classify()` checked the
// configurable `MOD_OWNER_DID` while the DM loop checked the hardcoded
// `ME_DID`, so setting the env var moved the boundary on one surface and left
// it where it was on the other. `loadReference` existing in three copies is the
// cautionary tale this repo has already paid for; a security boundary is a
// worse thing to keep three copies of.
//
// TWO TIERS, NOT ONE LIST.
//
//   owner    everything, including writes to the list
//   writer   answered, and may write. The upgrade path. Empty by default
//   allowed  answered, read-only
//
// The tiers exist because "can talk to the bot" and "can add someone to a block
// list" are different powers and only one of them is cheap to grant. A guest
// account is by nature the less carefully secured one, and a write from it
// lands on a live list real people subscribe to. So being answered is the
// default and writing is the exception, rather than one flag that means both.
//
// WHAT A READ-ONLY GUEST CAN STILL REACH is worth being honest about. They get
// the analyst, which reads author feeds and the follow graph, and reports that
// print bands, vouch counts and follower numbers for third parties. That is
// dame's private read of her own social graph. Adding someone here hands them
// that, and on the public path it hands it to everyone in the thread. The tier
// limits what they can CHANGE, not what they can SEE.

/** DIDs out of a comma or whitespace separated env value. */
export function parseDids(value) {
  return [
    ...new Set(
      String(value ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^did:[a-z]+:[a-zA-Z0-9._%-]+$/.test(s)),
    ),
  ];
}

/**
 * Build the roster.
 *
 * `answers` and `writes` are predicates rather than exported sets so callers
 * cannot accidentally mutate the boundary, and so a missing DID is a plain
 * `false` rather than a crash on an undefined set.
 *
 * @param {object} opts
 * @param {string} opts.owner           the account that owns the list
 * @param {string[]} [opts.writers]     may also write
 * @param {string[]} [opts.allowed]     answered, read-only
 */
export function makeRoster({ owner, writers = [], allowed = [] } = {}) {
  const canWrite = new Set([owner, ...writers].filter(Boolean));
  // A writer is answered without having to be named twice. Requiring both
  // lists would eventually mean an account that may write and is never heard.
  const answered = new Set([...canWrite, ...allowed].filter(Boolean));

  return {
    owner: owner ?? null,
    /** Is this DID answered at all? */
    answers: (did) => Boolean(did) && answered.has(did),
    /** May this DID run a command that changes the list? */
    writes: (did) => Boolean(did) && canWrite.has(did),
    /** Everyone answered — this is what the Jetstream subscription asks for. */
    all: [...answered],
    /** Everyone who may write, owner included. */
    allWriters: [...canWrite],
    /** Is anyone here besides the owner? Cheap enough to log at boot. */
    hasGuests: answered.size > canWrite.size || canWrite.size > 1,
  };
}

/**
 * The roster the environment describes.
 *
 * `fallbackOwner` is `ME_DID`, passed in rather than imported so this module
 * stays pure and the config that reads it keeps deciding what the default is.
 */
export function rosterFromEnv(env = process.env, fallbackOwner = null) {
  return makeRoster({
    owner: env.MOD_OWNER_DID || fallbackOwner,
    writers: parseDids(env.MOD_WRITER_DIDS),
    allowed: parseDids(env.MOD_ALLOWED_DIDS),
  });
}
