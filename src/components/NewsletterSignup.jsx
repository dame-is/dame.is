import { useEffect, useId, useRef, useState } from 'react';
import {
  LEAFLET_EMAIL_LOGIN,
  emailAction,
  emailRedirect,
  isReturnTo,
  returnCookie,
  withoutReturnMarker,
} from '../lib/newsletter.js';
import './NewsletterSignup.css';

/**
 * The newsletter's email form (src/lib/newsletter.js has the whole flow). It
 * submits straight to Leaflet, so nothing here handles an address: the submit
 * handler only points the form back at this page and notes the page in a
 * cookie for the trip home.
 *
 * `id` is where the reader comes back to, so it must be unique on the page:
 * a document numbers its signup blocks (signupBlockIds), and the page-level
 * forms use SUBSCRIBE_ID. Back from Leaflet at this form, it says thanks
 * instead of asking again.
 *
 * `title` replaces the "Newsletter" label and `className` adds to the box's,
 * for a page that sets the form as its whole subject (BloggingSubscribe.jsx).
 */
export default function NewsletterSignup({ id, style, title = 'Newsletter', className = '' }) {
  const fallbackId = useId();
  const formId = id || `subscribe-${fallbackId.replace(/[^a-z0-9]/gi, '')}`;
  const rootRef = useRef(null);
  // Read once, from the real address: a confirmed reader lands here with
  // ?subscribed=email#<this form>.
  const [returned] = useState(
    () =>
      typeof window !== 'undefined' &&
      isReturnTo(window.location.search, window.location.hash, formId),
  );

  useEffect(() => {
    if (!returned) return;
    // The marker comes off the address so a reload or a shared link doesn't
    // thank anybody again. Straight through history, not the router: the
    // page is already the right one and must not re-render as a navigation.
    const { pathname, search, hash } = window.location;
    window.history.replaceState(window.history.state, '', withoutReturnMarker(pathname, search, hash));
    // The page was drawn after the browser looked for #id, so it never
    // scrolled here on its own.
    rootRef.current?.scrollIntoView({ block: 'center' });
  }, [returned]);

  function handleSubmit(event) {
    const form = event.currentTarget;
    const { origin, pathname, protocol } = window.location;
    // Set as the form leaves, so a post reached by client-side navigation
    // still sends the reader back to itself.
    const redirect = emailRedirect(origin, pathname, formId);
    form.elements.redirect.value = redirect;
    const cookie = returnCookie(redirect, { secure: protocol === 'https:' });
    if (cookie) document.cookie = cookie;
  }

  return (
    <aside
      ref={rootRef}
      className={`newsletter ${className}`.trim()}
      id={formId}
      data-newsletter-signup=""
      aria-labelledby={`${formId}-label`}
      style={style || undefined}
    >
      <p className="newsletter-title" id={`${formId}-label`}>
        {title}
      </p>
      {returned ? (
        <p className="newsletter-done" role="status">
          You&rsquo;re subscribed. New posts and updates will come to your inbox.
        </p>
      ) : (
        <form className="newsletter-form" method="get" onSubmit={handleSubmit}>
          <input type="hidden" name="action" value={emailAction()} />
          <input
            type="hidden"
            name="redirect"
            defaultValue={
              typeof window !== 'undefined'
                ? emailRedirect(window.location.origin, window.location.pathname, formId)
                : ''
            }
          />
          <div className="newsletter-row">
            <label className="visually-hidden" htmlFor={`${formId}-email`}>
              Your email
            </label>
            <input
              id={`${formId}-email`}
              className="newsletter-input"
              type="email"
              name="email"
              placeholder="you@example.com"
              autoComplete="email"
              aria-describedby={`${formId}-fine`}
              required
            />
            {/* Leaflet's address rides on the button, not the form: Safari
                reads a lone email field in a form posting to
                ".../auth/email-login" as a sign-in, focuses it as the page
                loads and offers saved passwords. */}
            <button type="submit" className="btn btn--primary" formAction={LEAFLET_EMAIL_LOGIN}>
              Subscribe
            </button>
          </div>
          <p className="newsletter-fine" id={`${formId}-fine`}>
            Sent through Leaflet, where you&rsquo;ll confirm your address first. There&rsquo;s
            also an <a href="/feed.xml">RSS feed</a>.
          </p>
        </form>
      )}
    </aside>
  );
}
