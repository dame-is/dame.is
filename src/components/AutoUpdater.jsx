import useAutoUpdate from '../hooks/useAutoUpdate.js';

// Headless: runs the deploy-detection loop for as long as the app is
// mounted. Rendered inside the provider tree so the loop can read edit-mode
// state and defer reloads that would interrupt work in progress.
export default function AutoUpdater() {
  useAutoUpdate();
  return null;
}
