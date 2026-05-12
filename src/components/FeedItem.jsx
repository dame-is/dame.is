import StatusEntry from './StatusEntry.jsx';
import PostCard from './PostCard.jsx';
import BlogCard from './BlogCard.jsx';
import ListenRow from './ListenRow.jsx';
import CreatingCard from './CreatingCard.jsx';

const RENDERERS = {
  logging: StatusEntry,
  posting: PostCard,
  blogging: BlogCard,
  listening: ListenRow,
  creating: CreatingCard,
};

/**
 * Polymorphic dispatcher — pick the component for `item.verb`.
 */
export default function FeedItem({ item }) {
  const C = RENDERERS[item.verb];
  if (!C) return null;
  return (
    <li className={`feed-item feed-item-${item.verb}`} data-verb={item.verb}>
      <span className="feed-item-verb small-caps">{item.verb}</span>
      <C {...item} />
    </li>
  );
}
