import { Link } from 'react-router-dom';
import StatusEntry from './StatusEntry.jsx';
import PostCard from './PostCard.jsx';
import BlogCard from './BlogCard.jsx';
import ListenRow from './ListenRow.jsx';
import CreatingCard from './CreatingCard.jsx';
import VerbIcon from './VerbIcon.jsx';
import { rkeyFromAtUri } from '../lib/atproto.js';

const RENDERERS = {
  logging: StatusEntry,
  posting: PostCard,
  blogging: BlogCard,
  listening: ListenRow,
  creating: CreatingCard,
};

/**
 * Verb -> per-record route on this site. Most verbs use the record's rkey;
 * blogs and creations are addressed by their human-readable slug.
 */
function recordHrefFor(item) {
  switch (item.verb) {
    case 'blogging':
    case 'creating': {
      const slug = item.payload?.slug;
      return slug ? `/${item.verb}/${slug}` : null;
    }
    case 'logging':
    case 'posting':
    case 'listening': {
      const rkey = rkeyFromAtUri(item.atUri);
      return rkey ? `/${item.verb}/${rkey}` : null;
    }
    default:
      return null;
  }
}

/**
 * Polymorphic dispatcher — pick the component for `item.verb`. The verb
 * badge doubles as the link to the underlying record page.
 */
export default function FeedItem({ item }) {
  const C = RENDERERS[item.verb];
  if (!C) return null;
  const href = recordHrefFor(item);
  return (
    <li className={`feed-item feed-item-${item.verb}`} data-verb={item.verb}>
      {href ? (
        <Link className="feed-item-verb small-caps" to={href}>
          <VerbIcon verb={item.verb} size={15} className="feed-item-verb-icon" />
          <span className="feed-item-verb-label">{item.verb}</span>
        </Link>
      ) : (
        <span className="feed-item-verb small-caps">
          <VerbIcon verb={item.verb} size={15} className="feed-item-verb-icon" />
          <span className="feed-item-verb-label">{item.verb}</span>
        </span>
      )}
      <C {...item} />
    </li>
  );
}
