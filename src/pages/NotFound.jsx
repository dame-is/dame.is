import { Link } from 'react-router-dom';
import PageShell from '../components/PageShell.jsx';

export default function NotFound() {
  return (
    <PageShell
      verb="missing"
      title={<><span className="gerund">Dame is&hellip;</span> nowhere to be found</>}
      intro="No record exists at this URL."
      headTitle="Not found — Dame is…"
    >
      <p>
        Try the <Link to="/">home page</Link>.
      </p>
    </PageShell>
  );
}
