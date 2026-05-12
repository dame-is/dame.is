import { Link } from 'react-router-dom';

export default function BlogCard({ payload, atUri }) {
  const slug = payload?.slug;
  const title = payload?.title || slug || 'Untitled';
  const summary = payload?.summary || (payload?.body ? payload.body.slice(0, 280) : '');
  return (
    <article className="blog-card feed-card" data-at-uri={atUri}>
      <header className="blog-card-head">
        <h3 className="blog-card-title">
          {slug ? <Link to={`/blogging/${slug}`}>{title}</Link> : title}
        </h3>
      </header>
      {summary && <p className="blog-card-summary">{summary}</p>}
    </article>
  );
}
