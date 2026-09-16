// On-disk state: where the firehose got to, and what has already been answered.
//
// THE ANSWERED SET IS NOT AN OPTIMISATION. Jetstream replays from a cursor, and
// this consumer reconnects on a timer, so the same trigger post arrives again
// routinely. Without a record of what has been answered, every reconnect posts
// the analysis a second time — publicly, under someone else's thread. One
// duplicate public reply is worse than one missed one, which is why this file
// exists and why the cursor is written BEFORE the reply rather than after.

import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import { logger } from './logger.js';

const cursorPath = path.resolve(config.stateDir, config.cursorFile);
const answeredPath = path.resolve(config.stateDir, config.answeredFile);

let answered = new Set();
let lastCursor = null;

export function loadState() {
  try {
    const raw = fs.readFileSync(cursorPath, 'utf8').trim();
    if (raw) lastCursor = raw;
  } catch {
    // No cursor is the normal first run.
  }
  try {
    const raw = JSON.parse(fs.readFileSync(answeredPath, 'utf8'));
    if (Array.isArray(raw)) answered = new Set(raw);
  } catch {
    answered = new Set();
  }
  logger.info('State loaded', {
    cursor: lastCursor ?? '(live tail)',
    answered: answered.size,
  });
  return { cursor: lastCursor, answered: answered.size };
}

export function getCursor() {
  return lastCursor;
}

/**
 * Remember the firehose position.
 *
 * Unlike the indexing consumers on this box, this one does NOT hold the cursor
 * behind un-durable work. Those replay on restart because a replayed upsert is
 * free. Here a replayed event is a second public post, so the cursor moves as
 * soon as an event is seen and the answered set covers the replay that a
 * reconnect causes anyway.
 */
export function setCursor(timeUs) {
  if (timeUs == null) return;
  lastCursor = String(timeUs);
  try {
    fs.writeFileSync(cursorPath, lastCursor);
  } catch (err) {
    logger.error('Could not save cursor', { err });
  }
}

export function hasAnswered(uri) {
  return answered.has(uri);
}

export function markAnswered(uri) {
  answered.add(uri);
  if (answered.size > config.answeredKeep) {
    // Insertion-ordered, so the oldest go first.
    const trimmed = [...answered].slice(-config.answeredKeep);
    answered = new Set(trimmed);
  }
  try {
    fs.writeFileSync(answeredPath, JSON.stringify([...answered]));
  } catch (err) {
    logger.error('Could not save the answered set', { err });
  }
}
