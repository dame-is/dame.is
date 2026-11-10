// What each event does to the index. The whole of the service's judgement is
// in this file; store.js only keeps what it is told to.
//
// An unblock is recorded when a block record is deleted AND the index knows
// who that record blocked AND the same account holds no other block on them.
// It stands until that account blocks them again, at which point it is taken
// back: the count this feeds is "people who blocked you and then let you back
// in", and somebody who has since blocked you again is not one of them.
//
// Written against a small transaction interface rather than against SQLite,
// so the rules can be tested on any Node (memoryStore.js is the same
// interface over Maps) and the SQL in store.js stays a list of statements.
//
// EVERY BRANCH IS SAFE TO REPEAT. Jetstream delivers at least once and a
// cursor resumes inclusively, so the same event arriving twice is ordinary.
// A repeated put finds the block it already wrote and does nothing; a
// repeated delete finds nothing to delete and is counted as one it could not
// place, which is the only trace a repeat leaves.

/** Fresh counters. Each is a running total since the index was created. */
export function newCounters() {
  return {
    // Block records seen created.
    blocks: 0,
    // Block records seen deleted, whether or not the index could place them.
    deletes: 0,
    // Deletes of a block the index knew, which became an unblock.
    placed: 0,
    // Deletes of a block made before the index began, or since pruned from
    // it. The record is gone and nothing says who it blocked.
    unplaced: 0,
    // Deletes that undid nothing: the account holds a second block record on
    // the same person.
    duplicate: 0,
    // Deletes of a block on an account that has since been deleted. The
    // index knew who, and there is nobody left to say it about.
    moot: 0,
    // Block records rewritten in place to name somebody else (or nobody),
    // which ended a block without a delete. Kept apart from `placed`, so that
    // what is said about deletes (how many, and how many could be placed) is
    // only ever about deletes.
    rewritten: 0,
    // Unblocks taken back because the account blocked the person again.
    reblocked: 0,
    // Accounts deleted outright while the index held something of theirs.
    gone: 0,
  };
}

/**
 * Apply one event (see events.js for the shapes).
 *
 * @param tx        the store's transaction interface
 * @param event     a normalized event
 * @param counters  mutated in place
 */
export function fold(tx, event, counters) {
  if (event.type === 'put') return foldPut(tx, event, counters);
  if (event.type === 'delete') return foldDelete(tx, event, counters);
  if (event.type === 'void') return foldVoid(tx, event, counters);
  if (event.type === 'gone') return foldGone(tx, event, counters);
  return undefined;
}

function foldPut(tx, { did: blocker, rkey, subject, at }, counters) {
  const prev = tx.getBlock(blocker, rkey);
  if (prev && prev.subject === subject) return; // a repeat, or a rewrite that changed nothing

  if (prev) {
    // The record was rewritten to name somebody else. That is one block
    // ending and another beginning, under one key.
    tx.updateBlock(blocker, rkey, subject, at);
    const ended = settle(tx, { blocker, subject: prev.subject, blockedAt: prev.seen, at });
    if (ended === 'unblock') counters.rewritten += 1;
  } else {
    tx.insertBlock(blocker, rkey, subject, at);
  }
  counters.blocks += 1;

  // Blocked again: an earlier unblock of this person by this account no
  // longer stands.
  if (tx.hasUnblock(subject, blocker)) {
    tx.deleteUnblock(subject, blocker);
    tx.emit({ op: 'reblock', subject, blocker });
    counters.reblocked += 1;
  }
}

function foldDelete(tx, { did: blocker, rkey, at }, counters) {
  counters.deletes += 1;
  const prev = tx.getBlock(blocker, rkey);
  if (!prev) {
    counters.unplaced += 1;
    return;
  }
  tx.deleteBlock(blocker, rkey);
  const ended = settle(tx, { blocker, subject: prev.subject, blockedAt: prev.seen, at });
  if (ended === 'unblock') counters.placed += 1;
  else if (ended === 'duplicate') counters.duplicate += 1;
  else counters.moot += 1;
}

/**
 * The record still exists but no longer blocks anybody: it was rewritten to
 * name something that isn't an account, or its own author. Whoever it named
 * before is no longer blocked by it, and nothing takes their place.
 */
function foldVoid(tx, { did: blocker, rkey, at }, counters) {
  const prev = tx.getBlock(blocker, rkey);
  if (!prev) return;
  tx.deleteBlock(blocker, rkey);
  const ended = settle(tx, { blocker, subject: prev.subject, blockedAt: prev.seen, at });
  if (ended === 'unblock') counters.rewritten += 1;
}

/**
 * A block has ended. Says what that came to:
 *
 *   'unblock'    recorded, and sent on
 *   'duplicate'  a second record still blocks the same person, so nothing
 *                has been undone
 *   'gone'       the person it blocked has deleted their account
 */
function settle(tx, { blocker, subject, blockedAt, at }) {
  if (tx.blocksStill(blocker, subject)) return 'duplicate';
  if (tx.isGone(subject)) return 'gone';
  // A block can't end before it began. Clocks being what they are, hold the
  // unblock to no earlier than the block.
  const unblockedAt = Math.max(at, blockedAt);
  tx.putUnblock(subject, blocker, blockedAt, unblockedAt);
  tx.emit({ op: 'unblock', subject, blocker, blockedAt, unblockedAt });
  return 'unblock';
}

function foldGone(tx, { did, at }, counters) {
  // An account deleting itself is not that account forgiving everyone it had
  // blocked, so its blocks leave the index without becoming unblocks. And
  // what the tool had said about a deleted account goes with it, in both
  // directions.
  //
  // It is also remembered as gone. Other people's blocks ON it are still in
  // the index (finding them would mean reading the whole table), and when
  // one of those is tidied away later it must not come out as somebody
  // unblocking an account that no longer exists. The store lets go of the
  // memory once the index no longer reaches back that far.
  tx.markGone(did, at);
  const blocks = tx.deleteBlocksBy(did);
  const unblocks = tx.forgetUnblocks(did);
  if (unblocks > 0) tx.emit({ op: 'forget', did });
  if (blocks > 0 || unblocks > 0) counters.gone += 1;
}
