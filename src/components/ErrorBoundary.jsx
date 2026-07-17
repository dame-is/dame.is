import { Component } from 'react';

/**
 * Render error boundary. A render throw — or a rejected lazy import — anywhere
 * in the wrapped tree is caught here so the surrounding chrome stays alive and
 * the user sees a recoverable card instead of a blank SPA.
 *
 * Props:
 *   - children:  the protected tree.
 *   - fallback:  optional node rendered in place of the default card.
 *   - resetKey:  when this value changes the boundary clears its error state,
 *                so navigating away from a broken route recovers automatically
 *                (App passes the current pathname).
 *
 * Recovery:
 *   - "Reload" hard-reloads the page (`window.location.reload()`).
 *   - A `resetKey` change (route navigation) resets the boundary in
 *     `getDerivedStateFromProps`, so leaving the broken page is enough.
 *
 * Styling is inline (with CSS-token fallbacks) so the card renders correctly
 * without depending on any external stylesheet.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, prevResetKey: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  // Clear the error when the reset key changes (e.g. route navigation) so the
  // boundary recovers without a manual reload. Runs before every render; when
  // the key is unchanged it leaves the (possibly error) state alone.
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.prevResetKey) {
      return { hasError: false, prevResetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error, info) {
    // Surface the crash for debugging; the UI itself stays on the fallback.
    console.error('ErrorBoundary caught an error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    return (
      <div
        role="alert"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: 'var(--space-4, 1rem)',
          maxWidth: '32rem',
          margin: '0 auto',
          padding: 'var(--space-6, 2rem)',
          background: 'var(--surface-raised, #e3d8ba)',
          color: 'var(--ink, #1d2419)',
          border: '1px solid var(--rule, #cabf9f)',
          borderRadius: 'var(--radius-2, 0)',
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 'var(--text-lg, 1.125rem)',
            fontWeight: 600,
          }}
        >
          Something broke on this page.
        </p>
        <p
          style={{
            margin: 0,
            fontSize: 'var(--text-sm, 0.875rem)',
            color: 'var(--ink-muted, #6f6e58)',
          }}
        >
          Reloading usually fixes it. If it keeps happening, try again in a moment.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            appearance: 'none',
            cursor: 'pointer',
            font: 'inherit',
            fontSize: 'var(--text-sm, 0.875rem)',
            padding: 'var(--space-2, 0.5rem) var(--space-4, 1rem)',
            background: 'transparent',
            color: 'var(--ink, #1d2419)',
            border: '1px solid var(--ink, #1d2419)',
            borderRadius: 'var(--radius-1, 0)',
          }}
        >
          Reload
        </button>
      </div>
    );
  }
}
