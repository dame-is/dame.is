import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';

export default function NotFound() {
  return (
    <PageShell
      title="Nowhere to be found"
      intro="No record exists at this URL."
      headTitle="Not found — dame.is"
    >
      <p>
        Try the <Link to="/">home page</Link>.
      </p>
    </PageShell>
  );
}
