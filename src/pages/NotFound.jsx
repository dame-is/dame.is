import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';

export default function NotFound() {
  // The way home rides in the intro rather than a paragraph of its own: on
  // its own it was the second paragraph on the page, and the book-style
  // paragraph indent stepped it in under the line above.
  return (
    <PageShell
      title="Nowhere to be found"
      intro={
        <>
          No record exists at this URL. Try the <Link to="/">home page</Link>.
        </>
      }
      headTitle="Not found — dame.is"
    />
  );
}
