// js/comments-init.js

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BlueskyComments } from 'https://unpkg.com/bluesky-comments@0.9.0/dist/bluesky-comments.es.js';

/**
 * Renders the BlueskyComments component once the `bluesky_uri` is set.
 */
function renderBlueskyComments() {
    const container = document.getElementById('bluesky-comments');
    const uri = container.getAttribute('data-uri');

    if (!uri) {
        container.innerHTML = '<p>No comments are currently available. Check back later.</p>';
        return;
    }

    // Prevent multiple renders
    if (container._blueskyRoot) {
        return;
    }

    const root = createRoot(container);
    container._blueskyRoot = root; // Store reference to prevent re-rendering

    root.render(
        createElement(BlueskyComments, {
            uri: `https://bsky.app/profile/dame.is/post/${uri}`,
        })
    );
}

// Listen for a custom event dispatched by main.js after setting the URI
window.addEventListener('bluesky_uri_set', renderBlueskyComments);
