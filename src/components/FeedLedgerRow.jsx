import { Link } from 'react-router-dom';
import { formatDayShortLabel, formatTime, formatWallClockTime } from '../lib/time.js';
import LedgerXrayLine from './LedgerXrayLine.jsx';
import { renderPostText } from '../lib/postRichText.jsx';
import { renderPlainTextWithTruncatedUrls } from '../lib/feedUrlFormat.jsx';
import { getReplyHint } from '../lib/postReplyHint.js';
import { recordPathFromAtUri } from '../lib/recordRoutes.js';
import { photoUrl } from '../lib/inaturalist.js';
import { avatarThumb } from '../lib/avatarThumb.js';
import {
  batchCountLabel,
  batchNameLine,
  isObservationBatch,
} from '../lib/observationBatches.js';
import { firstSightingCount } from '../lib/firstSightings.js';
import FirstSightingChip from './FirstSightingChip.jsx';
import { nsidFromAtUri } from '../lib/verbRegistry.js';
import { playArtistLine, playTrackName, playedAtOf } from '../lib/teal.js';
import { sigilSvgDataUrl } from '../lib/anisotaLab.js';
import { flushBody, isWordlessFlush } from '../lib/flushText.js';
import {
  isYearOnlyDate,
  longDay,
  sectionHref,
  shortDay,
  trimLinkEcho,
  yearOf,
} from '../lib/ledger.js';
import { dayOfLife } from '../lib/dayOfLife.js';
import InkblotFigure from './cards/InkblotFigure.jsx';
import RedactedPost from './cards/RedactedPost.jsx';
import AlbumCover from './AlbumCover.jsx';
import Time from './Time.jsx';
import PostEmbed from './PostEmbed.jsx';
import RelativeTimeText from './RelativeTimeText.jsx';
import { ME_DID, ME_HANDLE } from '../config.js';

/**
 * The home feed's second layout ("ledger"): each record renders as one
 * hairline-ruled row of three aligned columns: the verb in the margin, the
 * record, and its time, which is the row's permalink, like a page number.
 * FeedItem owns the surrounding <li> (row click, thread classes); this
 * component renders the cells inside it.
 *
 * Summaries are intentionally lossy: they compress each card down to the
 * line a reader can scan ("track — artist", "@handle"). A repost renders the
 * original post as a quote box (RepostQuote). The time links to the record
 * page, which keeps the full treatment, and the verb to its section.
 */

/**
 * A collapsed listening session (many plays batched into one row) can
 * expand into its full track list. FeedItem owns the expanded state —
 * tapping anywhere on the row toggles it — and passes it down here.
 */
export function isListenBatch(item) {
  return (
    item.verb === 'listening' &&
    (item.count || 0) > 1 &&
    Array.isArray(item.plays) &&
    item.plays.length > 1
  );
}

/* A nameless Anisota Lab piece falls back to what it *is* rather than the
   generic "a lab piece" — the ledger cousin of the card's kind label, and of
   the observation rows' "an unidentified moth". */
const CRAFT_KIND_FALLBACK = {
  'net.anisota.lab.poetry': 'a poem',
  'net.anisota.lab.redaction': 'an erasure poem',
  'net.anisota.lab.sigil': 'a sigil',
  'net.anisota.lab.carving': 'a carving',
  'net.anisota.lab.inkblot': 'an inkblot',
  'net.anisota.lab.petri': 'a culture',
  'net.anisota.lab.synth': 'a synth',
  'net.anisota.spell.custom': 'a spell',
};

/** How many specimens a collapsed run shows before the count takes over. */
const BATCH_THUMBS = 4;
/** And how many species it names. Two, not the card's three: moth names run
    long, and the ledger row's whole job is to be one row. */
const BATCH_LEDGER_NAMES = 2;

/**
 * `showVerb={false}` is a single-kind page (/posting, /logging, /listening):
 * every row is the same verb, so the margin drops it and prints only the
 * exception ("replying"). /listening fills the freed margin
 * with the session's cover, and /logging with a running date: `dayStart` is
 * the day a row opens, on a page that dates its rows in the margin instead of
 * heading each day.
 */
export default function FeedLedgerRow({
  item,
  xrayId,
  href,
  showVerb = true,
  dayStart = null,
  expanded = false,
  onToggle = null,
  onOpenLightbox = null,
}) {
  const replyHint = item.verb === 'posting' ? getReplyHint(item.payload) : null;
  // Self-thread follow-ons show no label at all: the dashed rule above the
  // row (see Feed.css) marks them as connected to the post above.
  const threadContinuation = item.verb === 'posting' && item._thread?.continuesPrev;
  const label = threadContinuation ? null : replyHint ? 'replying' : item.verb;
  // On a single-kind page the label only prints when it says something the
  // page doesn't (a reply, on /posting).
  const showLabel = Boolean(label) && (showVerb || label !== item.verb);
  const ts =
    item.createdAt || item.payload?.createdAt || item.payload?.indexedAt || null;
  // Reposts skip the inline "@handle: text" summary entirely — the
  // original post renders as a quote-style box instead (see RepostQuote).
  const isRepost = item.verb === 'reposting';
  // iNaturalist observations render a specimen thumbnail beside stacked
  // common/scientific names (see ObservationLedgerBody), not a text summary.
  const isObservation = item.verb === 'mothing' || item.verb === 'observing';
  // A run of them collapses to one row: a strip of specimens, the species it
  // turned up, and a count that opens the lot (see collapseObservations).
  const obsBatch = isObservationBatch(item);
  // Blog entries render title + a muted summary line beneath (BlogLedgerBody)
  // rather than the single-line title summary.
  const isBlog = item.verb === 'blogging';
  // Anisota Lab sigils + inkblots preview as a small themed thumbnail beside
  // their title (the way observations show a specimen thumb); other crafting
  // verbs — poems, spells — keep the plain title summary alone.
  const craftThumb = item.verb === 'crafting' ? craftingThumb(item) : null;
  // An erasure poem is a reading of a post, so — like a repost — the post it
  // was drawn from IS the row: quoted, with its blacked-out words struck.
  const isRedaction =
    item.verb === 'crafting' &&
    nsidFromAtUri(item.atUri) === 'net.anisota.lab.redaction';
  const summary =
    isRepost || isObservation || isBlog || isRedaction
      ? null
      : summarize(item);
  const embed = isRepost ? null : ledgerEmbed(item);
  // A work known only by its year shows the year, not a "12:00 am" nobody
  // recorded (see splitYearOnlyWorks, which also moves it to the ledger's end).
  const yearOnly = item.verb === 'creating' && isYearOnlyDate(ts);
  // Observations show their stored local wall-clock time-of-day directly, never
  // localized — the record's timestamp is that wall-clock pinned to `Z`, so
  // running it through `formatTime` (which localizes) would re-shift the clock
  // (a 2:59pm sighting reading 10:59am). Falls back to the localized time only
  // for the rare observation with no recorded time.
  const wallClock = isObservation ? formatWallClockTime(item.payload?.observedTime) : '';
  const timeText = yearOnly ? yearOf(ts) : wallClock || (ts ? formatTime(ts) : '');
  // What the <time> says to a machine: the instant, a floating local time for
  // a wall-clock observation, or just the year.
  const machineTime = yearOnly
    ? yearOf(ts)
    : wallClock && item.payload?.observedDate
      ? `${item.payload.observedDate}T${item.payload.observedTime}`
      : ts;
  const listening = item.verb === 'listening';
  return (
    <>
      {/* The margin. A row with nothing to say there keeps an empty cell so
          grid auto-placement still lands the body in column 2. */}
      {dayStart && !showVerb ? (
        <DiaryDate date={dayStart} />
      ) : listening && !showVerb ? (
        <span className="ledger-verb ledger-cover" aria-hidden="true">
          <AlbumCover payload={item.payload} size={100} className="ledger-cover-art" />
        </span>
      ) : showLabel ? (
        <VerbLabel label={label} className="ledger-verb" />
      ) : (
        <span className="ledger-verb" aria-hidden="true" />
      )}
      <div className="ledger-body">
        {isRepost && <RepostQuote item={item} />}
        {isRedaction && (
          <div className="ledger-embed ledger-redaction">
            <RedactedPost value={item.payload} subject={item.subject} />
          </div>
        )}
        {isObservation &&
          (obsBatch ? (
            <ObservationBatchLedgerBody item={item} expanded={expanded} onToggle={onToggle} />
          ) : (
            <ObservationLedgerBody item={item} />
          ))}
        {isBlog && <BlogLedgerBody item={item} />}
        {craftThumb ? (
          <div className="ledger-craft">
            {craftThumb}
            {summary && <p className="ledger-text">{summary}</p>}
          </div>
        ) : (
          summary && <p className="ledger-text">{summary}</p>
        )}
        {listening && isListenBatch(item) && (
          <ListenMore item={item} expanded={expanded} onToggle={onToggle} />
        )}
        {embed && (
          <div className="ledger-embed">
            <PostEmbed
              embed={embed.embed}
              did={embed.did}
              postUri={item.atUri}
            />
          </div>
        )}
      </div>
      <TimeLink className="ledger-time" href={href} dateTime={machineTime}>
        {timeText}
      </TimeLink>
      {/* X-ray marginalia: in x-ray the verb and time columns give way to
          the record's collection and its rkey over a short CID, and the row
          keeps its content (see Xray.css). */}
      {item.atUri && <LedgerXrayLine id={xrayId} atUri={item.atUri} cid={item.cid} />}
      {expanded && obsBatch && item.observations.map((obs) => (
        <ObservationChildRow
          key={obs.atUri || obs.payload?.inatId}
          item={obs}
          onOpenLightbox={onOpenLightbox}
        />
      ))}
      {/* An open session lists the rest of its songs, newest first: the
          newest is already the row's own line. */}
      {expanded && isListenBatch(item) && item.plays.slice(1).map((play) => {
        const playTs = play?.createdAt || playedAtOf(play?.payload) || null;
        const playHref = recordPathFromAtUri(play?.atUri);
        const line = trackLine(play?.payload);
        // Each play is its own compact sub-row spanning the summary + time
        // columns, split from the one above by a thin dashed rule (see
        // .ledger-track-row in Feed.css) so the song list reads tight. Its
        // time is its permalink, as a row's is.
        return (
          <div className="ledger-track-row" key={play?.atUri || playTs}>
            <p className="ledger-text ledger-track">
              {playHref ? <Link to={playHref}>{line || <em>—</em>}</Link> : line || <em>—</em>}
            </p>
            <TimeLink className="ledger-time ledger-track-time" href={playHref} dateTime={playTs}>
              {playTs ? formatTime(playTs) : ''}
            </TimeLink>
          </div>
        );
      })}
    </>
  );
}

/**
 * A time that is its record's permalink: `<a><time>`, like a page number.
 * With no page to go to (a live observation not mirrored yet) it's just the
 * time.
 */
function TimeLink({ href, dateTime, className, children }) {
  // <Time> keeps the printed text (an observation's recorded wall-clock, a
  // work's year) and adds the full moment, on Dame's clock and the reader's,
  // as its tooltip.
  const time = dateTime ? (
    <Time value={dateTime} variant="clock" tabular>
      {children}
    </Time>
  ) : (
    <time>{children}</time>
  );
  return href ? (
    <Link className={className} to={href}>
      {time}
    </Link>
  ) : (
    <span className={className}>{time}</span>
  );
}

/** The margin's gerund, linking to its section when it has one. */
function VerbLabel({ label, className = 'ledger-verb-link' }) {
  const to = sectionHref(label);
  return to ? (
    <Link className={className} to={to}>
      {label}
    </Link>
  ) : (
    <span className={className}>{label}</span>
  );
}

/**
 * /logging's running date: the first status of each day carries the day and
 * its day of life in the margin, where the page used to head the day. It keeps
 * the day header's classes, which the chrome's strip reads the day in view
 * from, and its heading, so the page still has one heading per day.
 */
function DiaryDate({ date }) {
  const label = formatDayShortLabel(date);
  const named = label === 'Today' || label === 'Yesterday';
  return (
    <header className="ledger-verb day-section-header ledger-diary-date">
      <h3 className="day-header" aria-label={longDay(date)} data-day-label={named ? label : shortDay(date)}>
        {named ? label : shortDay(date)}
      </h3>
      <span className="ledger-diary-dol">day {dayOfLife(date).toLocaleString('en-US')}</span>
    </header>
  );
}

/**
 * Post embeds (images / video / link card / quote) ride along under the
 * summary line in a condensed, height-capped form (see the .ledger-embed
 * rules in Feed.css). Only posting rows carry one — reposts render their
 * whole payload as a quote box instead (RepostQuote below).
 */
function ledgerEmbed(item) {
  if (item.verb !== 'posting') return null;
  const payload = item.payload || {};
  const embed = payload.embed || payload.embedRecord || null;
  if (!embed) return null;
  // Anisota post embeds have no author view; their blobs live on Dame's PDS.
  const did = payload.author?.did || (item.source === 'anisota' ? ME_DID : undefined);
  return { embed, did };
}

/** The address a post's link card points at, if it has one. */
function embedLinkUri(payload) {
  const embed = payload?.embed || payload?.embedRecord || null;
  const type = embed?.$type || '';
  if (type.startsWith('app.bsky.embed.external')) return embed.external?.uri || null;
  if (type.startsWith('app.bsky.embed.recordWithMedia')) {
    const media = embed.media;
    if (media?.$type?.startsWith('app.bsky.embed.external')) return media.external?.uri || null;
  }
  return null;
}

/**
 * A repost's body: the original post styled like a quote embed —
 * mirrors PostEmbed's QuoteRecord markup so it inherits the condensed
 * quote treatment wholesale. The head's timestamp links out to the
 * original on bsky.app; unlike a quote nested inside a post, the box
 * IS the row's content, so its text stays unclamped and its own media
 * renders (see the .ledger-repost overrides in Feed.css).
 */
function RepostQuote({ item }) {
  const payload = item.payload || {};
  // An Anisota repost is a reference (a pointer at another post), not a
  // carried copy of one: it has no author or text of its own to box, so it
  // reads as its subject, the way a like does.
  if (item.source === 'anisota' && item.subject) {
    return <p className="ledger-text">{summarizeSubject(item.subject, item.source)}</p>;
  }
  if (payload.subjectMissing) {
    return (
      <p className="ledger-text">
        <Placeholder>an unavailable post</Placeholder>
      </p>
    );
  }
  const author = payload.author || {};
  const ts = payload.indexedAt || null;
  const externalHref =
    author.handle && payload.subjectUri
      ? `https://bsky.app/profile/${author.handle}/post/${String(payload.subjectUri).split('/').pop()}`
      : author.handle
        ? `https://bsky.app/profile/${author.handle}`
        : null;
  const embed = payload.embed || payload.embedRecord || null;
  return (
    <div className="ledger-embed ledger-repost">
      <article className="post-embed-quote">
        <header className="post-embed-quote-head">
          {author.avatar && (
            <img
              className="post-embed-quote-avatar"
              src={avatarThumb(author.avatar)}
              alt=""
              width={20}
              height={20}
              loading="lazy"
            />
          )}
          <span className="post-embed-quote-author">
            {author.displayName && (
              <span className="post-embed-quote-name">{author.displayName}</span>
            )}
            {author.handle && (
              <span className="post-embed-quote-handle">@{author.handle}</span>
            )}
          </span>
          {ts && (
            <span className="post-embed-quote-time gutter">
              {externalHref ? (
                <a href={externalHref} target="_blank" rel="noreferrer noopener">
                  <RelativeTimeText value={ts} />
                </a>
              ) : (
                <RelativeTimeText value={ts} />
              )}
            </span>
          )}
        </header>
        {payload.text && (
          <p className="post-embed-quote-text">
            {renderPostText(payload.text, payload.facets || null)}
          </p>
        )}
        {embed && (
          <PostEmbed
            embed={embed}
            did={author.did}
            postUri={payload.subjectUri}
          />
        )}
      </article>
    </div>
  );
}

function summarize(item) {
  const payload = item.payload || {};
  switch (item.verb) {
    case 'logging':
      // A status completes the sentence the site is named for, so the name
      // runs into it in small caps: "dame.is playing tennis".
      return (
        <>
          <span className="ledger-me">{ME_HANDLE}</span>{' '}
          {plain(payload.status || payload.text, 'a status')}
        </>
      );
    case 'posting':
      return summarizePost(item);
    case 'blogging':
      return plain(payload.title || payload.name, 'an untitled entry');
    case 'listening':
      return summarizeListen(item);
    case 'creating':
      return plain(payload.title || payload.slug, 'an untitled work');
    case 'photographing': {
      const title = payload.title || payload.name || payload.description || payload.caption;
      return plain(title, 'a gallery');
    }
    // 'mothing' / 'observing' are handled separately (ObservationLedgerBody
    // renders a thumbnail + names), so they never reach this text summary.
    case 'liking':
      return summarizeSubject(item.subject, item.source);
    case 'following':
      return summarizeProfile(item.subject);
    case 'listing':
      return plain(payload.name, 'an untitled list');
    case 'feeding':
      return plain(payload.displayName, 'an untitled feed');
    case 'commenting':
      return plain(payload.text || payload.body || payload.content, 'a comment');
    case 'flushing': {
      // The verb column already reads "flushing", so a flush that never got
      // its own words would only say it a second time here. Let the emoji
      // carry that row by itself, and print the words when there are any.
      const emoji = payload.emoji ? (
        <span className="ledger-flush-emoji">{payload.emoji}</span>
      ) : null;
      if (isWordlessFlush(payload.text)) return emoji || <Placeholder>a flush</Placeholder>;
      return (
        <>
          {emoji}
          {plain(flushBody(payload.text, ME_HANDLE), 'a flush')}
        </>
      );
    }
    case 'crafting':
      // Anisota Lab piece — lead with its title, else a poem's text, else a
      // spell's description; falls back to the kind (a sigil, an inkblot, …)
      // so a nameless piece still reads as what it is. Erasure poems never
      // reach here — they render as the quoted post they blacked out.
      return plain(
        payload.name || payload.text || payload.description,
        CRAFT_KIND_FALLBACK[nsidFromAtUri(item.atUri)] || 'a lab piece',
      );
    default:
      return <Placeholder>a record</Placeholder>;
  }
}

/** Plain-text summary with URL truncation; muted placeholder when empty. */
function plain(text, fallback) {
  const t = (text || '').trim();
  if (!t) return <Placeholder>{fallback}</Placeholder>;
  return renderPlainTextWithTruncatedUrls(t);
}

function Placeholder({ children }) {
  return <em className="ledger-placeholder">{children}</em>;
}

/**
 * Posts keep their rich text (links / mentions render as anchors).
 * Text-less posts return null when an embed exists — the condensed
 * embed below carries the row on its own. A link the post's card already
 * shows isn't printed twice: a link-only post is just its card (see
 * trimLinkEcho). A post by someone else gets a leading @handle so
 * attribution survives the loss of the card's author header.
 */
function summarizePost(item) {
  const payload = item.payload || {};
  if (payload.subjectMissing) return <Placeholder>an unavailable post</Placeholder>;
  const text = trimLinkEcho(payload.text || '', embedLinkUri(payload));
  const hasEmbed = Boolean(payload.embed || payload.embedRecord);
  const body = text
    ? renderPostText(text, payload.facets || null)
    : hasEmbed
      ? null
      : <Placeholder>a post</Placeholder>;
  const author = payload.author;
  const foreignAuthor = author?.did && author.did !== ME_DID && author?.handle;
  if (!foreignAuthor) return body;
  return (
    <>
      <a
        className="ledger-handle"
        href={`https://bsky.app/profile/${author.handle}`}
        target="_blank"
        rel="noreferrer noopener"
      >
        @{author.handle}
      </a>
      {body && <>: {body}</>}
    </>
  );
}

/**
 * "track — artist": a play's line, and a session's, which leads with its
 * newest song. What else the session held is the "+ 15 more" beneath it
 * (ListenMore), which opens the rest in place.
 */
function summarizeListen(item) {
  return trackLine(item.payload || {}) || <Placeholder>a play</Placeholder>;
}

/**
 * Under a session's line: how many more songs it holds, and the control
 * that opens them ("+ 15 more"), which reads "16 songs −" once they're out.
 * FeedItem also toggles on taps anywhere else in the row.
 */
function ListenMore({ item, expanded, onToggle }) {
  const total = item.plays.length;
  const label = expanded ? (
    <>
      {total} songs
      <span className="ledger-count-caret" aria-hidden="true">
        {'\u2212'}
      </span>
    </>
  ) : (
    `+ ${total - 1} more`
  );
  return (
    <p className="ledger-count ledger-listen-more">
      {onToggle ? (
        <button
          type="button"
          className="ledger-count-toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Hide' : 'Show'} all ${total} songs`}
        >
          {label}
        </button>
      ) : (
        label
      )}
    </p>
  );
}

/** "track — artist" fragment shared by the summary line and the
    expanded per-track rows. Null when the play has neither. */
function trackLine(payload) {
  const track = playTrackName(payload);
  const artist = playArtistLine(payload);
  if (!track && !artist) return null;
  return (
    <>
      {track}
      {track && artist ? ' — ' : ''}
      {artist && <span className="ledger-accent">{artist}</span>}
    </>
  );
}

/**
 * An iNaturalist observation as a ledger body: a small square specimen
 * thumbnail beside the common and scientific names stacked, mirroring the
 * /mothing page's ledger row (MothLedgerRow). The verb cell already names
 * the activity ("mothing" / "observing") and the row's own time column
 * carries the timestamp, so this cell only owns the photo + names. Works
 * for both mirrored records and live-fetched observations — same
 * `photos: [{ id, url, … }]` / `taxon` payload shape.
 */
function ObservationLedgerBody({ item }) {
  const payload = item.payload || {};
  const photo = Array.isArray(payload.photos) ? payload.photos[0] : null;
  const thumb = photo ? photoUrl(photo, 'square') : null;
  const common = payload.taxon?.commonName;
  const sci = payload.taxon?.name;
  const name = common || sci;
  const showSci = sci && sci !== name;
  const fallback = item.verb === 'mothing' ? 'an unidentified moth' : 'an unidentified organism';
  return (
    <div className="ledger-obs">
      {thumb ? (
        <img
          className="ledger-obs-thumb"
          src={thumb}
          alt=""
          loading="lazy"
          decoding="async"
          width={36}
          height={36}
        />
      ) : (
        <span className="ledger-obs-thumb ledger-obs-thumb-empty" aria-hidden="true" />
      )}
      <span className="ledger-obs-names">
        <span className="ledger-obs-name">
          {name || <Placeholder>{fallback}</Placeholder>}
          {item._firstSighting && <FirstSightingChip size="small" />}
        </span>
        {showSci && <span className="ledger-obs-sci">{sci}</span>}
      </span>
    </div>
  );
}

/**
 * A collapsed run of observations: up to four specimens in a strip, the
 * species the run turned up, and the count — which doubles as the expand
 * toggle, exactly as a listening session's song count does. FeedItem also
 * toggles on taps anywhere else in the row.
 */
function ObservationBatchLedgerBody({ item, expanded, onToggle }) {
  const shown = (item.observations || [])
    .filter((o) => o.payload?.photos?.[0])
    .slice(0, BATCH_THUMBS);
  const names = batchNameLine(item, BATCH_LEDGER_NAMES);
  const count = batchCountLabel(item);
  // The run's tally of new species, beside its tally of sightings — the row
  // stands in for a whole night, so a first inside it has nowhere else to show
  // until the run is opened.
  const firsts = firstSightingCount(item);
  return (
    <div className="ledger-obs ledger-obs-batch">
      <span className="ledger-obs-strip" aria-hidden="true">
        {shown.length ? (
          shown.map((o) => (
            <img
              key={o.atUri || o.payload.inatId}
              className="ledger-obs-thumb"
              src={photoUrl(o.payload.photos[0], 'square')}
              alt=""
              loading="lazy"
              decoding="async"
              width={36}
              height={36}
            />
          ))
        ) : (
          <span className="ledger-obs-thumb ledger-obs-thumb-empty" />
        )}
      </span>
      <span className="ledger-obs-names">
        <span className="ledger-obs-name">
          {names || <Placeholder>unidentified</Placeholder>}
        </span>
        <span className="ledger-obs-count">
          {onToggle ? (
            <button
              type="button"
              className="ledger-count-toggle"
              onClick={onToggle}
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} all ${count}`}
            >
              {count}
              <span className="ledger-count-caret" aria-hidden="true">
                {expanded ? '\u2212' : '+'}
              </span>
            </button>
          ) : (
            count
          )}
          {firsts > 0 && <FirstSightingChip count={firsts} size="small" />}
        </span>
      </span>
    </div>
  );
}

/**
 * One sighting inside an expanded run — the same thumbnail-and-names body the
 * uncollapsed row wears, in the compact sub-row the expanded track list uses,
 * with its own wall-clock flush right. Tapping opens the feed's lightbox at
 * that photo (what a single observation row does); a photoless one falls back
 * to its record page.
 */
function ObservationChildRow({ item, onOpenLightbox }) {
  const hasPhoto = Boolean(item.payload?.photos?.[0]);
  const canLightbox = hasPhoto && typeof onOpenLightbox === 'function';
  const href = !canLightbox && item.atUri && !item._live ? recordPathFromAtUri(item.atUri) : null;
  const body = <ObservationLedgerBody item={item} />;
  const time =
    formatWallClockTime(item.payload?.observedTime) ||
    (item.createdAt ? formatTime(item.createdAt) : '');
  return (
    <div className="ledger-track-row ledger-obs-child">
      {canLightbox ? (
        <button
          type="button"
          className="ledger-obs-child-open"
          onClick={() => onOpenLightbox(item)}
          aria-label={`View photo: ${item.payload?.taxon?.commonName || item.payload?.taxon?.name || 'observation'}`}
        >
          {body}
        </button>
      ) : href ? (
        <Link className="ledger-obs-child-open" to={href}>
          {body}
        </Link>
      ) : (
        body
      )}
      <span className="ledger-time ledger-track-time">{time}</span>
    </div>
  );
}

/**
 * A crafting row's preview thumbnail — a small themed figure set beside the
 * title, mirroring how observations lead with a specimen thumb. Only the
 * figure-shaped Lab pieces get one: a sigil (its stroke SVG re-inked via a CSS
 * mask, exactly like the card) or an inkblot (duotoned into the palette by
 * InkblotFigure). Every other crafting verb — poems, erasures, spells —
 * returns null and keeps the plain title summary. Null too when the media
 * itself is absent: the static snapshot ships Lab pieces without their
 * svg/image, and the live feed fills them back in, just as the cards do.
 */
function craftingThumb(item) {
  const nsid = nsidFromAtUri(item.atUri);
  const payload = item.payload || {};
  if (nsid === 'net.anisota.lab.sigil') {
    const src = sigilSvgDataUrl(payload.svg);
    if (!src) return null;
    return (
      <span className="ledger-craft-thumb" aria-hidden="true">
        <span
          className="lab-sigil"
          style={{ WebkitMaskImage: `url("${src}")`, maskImage: `url("${src}")` }}
        />
      </span>
    );
  }
  if (nsid === 'net.anisota.lab.inkblot' && isDataImage(payload.image)) {
    return (
      <span className="ledger-craft-thumb" aria-hidden="true">
        <InkblotFigure image={payload.image} palette={payload.palette} label="" />
      </span>
    );
  }
  return null;
}

/** Only self-contained data-URL images are renderable (mirrors AnisotaLabCard). */
function isDataImage(image) {
  return typeof image === 'string' && image.startsWith('data:image/');
}

/**
 * A blog entry as a ledger body: the title on top, then a muted summary /
 * description line beneath (CSS-clamped to two lines). Mirrors the cards
 * layout (BlogCard), which already shows a summary — the ledger just did
 * title-only before. `summary` is baked by feedBuilder (an explicit summary,
 * else a synopsis of the leading text); `description` is the standard.site
 * meta description.
 */
function BlogLedgerBody({ item }) {
  const payload = item.payload || {};
  const title = (payload.title || payload.name || payload.slug || '').trim();
  const summary = (payload.summary || payload.description || '').trim();
  return (
    <>
      <p className="ledger-text">
        {title ? (
          renderPlainTextWithTruncatedUrls(title)
        ) : (
          <Placeholder>an untitled entry</Placeholder>
        )}
      </p>
      {summary && (
        <p className="ledger-text ledger-subtext">
          {renderPlainTextWithTruncatedUrls(summary)}
        </p>
      )}
    </>
  );
}

/**
 * One-line lead-in for reference records (likes, stars, favorites,
 * votes) — the ledger cousin of ReferenceCard's CompactSubject.
 */
function summarizeSubject(subject, source) {
  if (!subject) return <Placeholder>an unknown record</Placeholder>;
  if (subject.missing) return <Placeholder>an unavailable record</Placeholder>;
  switch (subject.kind) {
    case 'bsky.post': {
      const view = subject.view;
      const author = view?.author;
      if (!author?.handle) return <Placeholder>a post</Placeholder>;
      const localHref = author.did === ME_DID && view?.uri ? recordPathFromAtUri(view.uri) : null;
      const externalHref = view?.uri
        ? `https://bsky.app/profile/${author.handle}/post/${view.uri.split('/').pop()}`
        : null;
      const handle = <span className="ledger-handle">@{author.handle}</span>;
      return (
        <>
          a post by{' '}
          {localHref ? (
            <Link to={localHref}>{handle}</Link>
          ) : externalHref ? (
            <a href={externalHref} target="_blank" rel="noreferrer noopener">
              {handle}
            </a>
          ) : (
            handle
          )}
        </>
      );
    }
    case 'bsky.profile':
      return summarizeProfile(subject);
    case 'atproto': {
      const value = subject.record?.value;
      if (!value) return <Placeholder>{source ? `a ${source} record` : 'a record'}</Placeholder>;
      const title =
        value.title ||
        value.name ||
        value.displayName ||
        value.repo ||
        value.repoName ||
        (value.text ? value.text.trim().replace(/\s+/g, ' ').slice(0, 80) : null);
      if (!title) return <Placeholder>{source ? `a ${source} record` : 'a record'}</Placeholder>;
      return (
        <>
          {source ? `a ${source} record — ` : ''}
          <span className="ledger-accent">{title}</span>
        </>
      );
    }
    default:
      return <Placeholder>a record</Placeholder>;
  }
}

/** "@handle" linking out to the profile, like the screenshot's FOLLOWED row. */
function summarizeProfile(subject) {
  const view = subject?.view;
  if (subject?.missing || !view?.handle) return <Placeholder>a profile</Placeholder>;
  return (
    <a
      href={`https://bsky.app/profile/${view.handle}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className="ledger-handle">@{view.handle}</span>
    </a>
  );
}
