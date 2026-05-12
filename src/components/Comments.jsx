import { Suspense, lazy } from 'react';
import 'bluesky-comments/bluesky-comments.css';
import './Comments.css';

const BlueskyComments = lazy(async () => {
  const mod = await import('bluesky-comments');
  return { default: mod.BlueskyComments };
});

/**
 * Wraps the bluesky-comments npm component. Pass an at:// URI of the
 * Bluesky thread to anchor the comments at.
 */
export default function Comments({ atUri, author, emptyMessage = 'No replies yet.' }) {
  if (!atUri) return null;
  return (
    <section className="comments-section">
      <h3 className="comments-heading">
        <span className="small-caps">Comments</span>
      </h3>
      <Suspense fallback={<p className="feed-empty">Loading comments…</p>}>
        <BlueskyComments
          uri={atUri}
          author={author}
          onEmpty={() => <p className="feed-empty">{emptyMessage}</p>}
        />
      </Suspense>
    </section>
  );
}
