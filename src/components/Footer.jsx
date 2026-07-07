import RecordTimestamp from './RecordTimestamp.jsx';
import './Footer.css';

export default function Footer() {
  return (
    <footer className="page-footer" role="contentinfo">
      <div className="page-footer-inner">
        <RecordTimestamp />
        <span className="page-footer-meta">
          <span className="small-caps">Published on the AT Protocol</span>
        </span>
      </div>
    </footer>
  );
}
