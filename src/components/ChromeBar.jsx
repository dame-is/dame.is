import { Link } from 'react-router-dom';
import './ChromeBar.css';
import NowStatus from './NowStatus.jsx';
import NowPlaying from './NowPlaying.jsx';
import DayOfLifeTicker from './DayOfLifeTicker.jsx';
import ProfileStats from './ProfileStats.jsx';

export default function ChromeBar() {
  return (
    <header className="chrome-bar" role="banner">
      <Link to="/" className="chrome-title">
        <span className="chrome-mark">&#x2767;</span>
        <span className="chrome-name">dame.is</span>
      </Link>
      <div className="chrome-signals">
        <NowStatus />
        <NowPlaying />
        <DayOfLifeTicker />
        <ProfileStats />
      </div>
    </header>
  );
}
