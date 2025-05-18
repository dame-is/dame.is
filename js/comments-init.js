// js/comments-init.js

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BlueskyComments } from 'https://unpkg.com/bluesky-comments@0.9.0/dist/bluesky-comments.es.js';

/**
 * Renders the BlueskyComments component on any page that has a blueskyUri in its frontmatter.
 * Works with any URL path structure across the site.
 */
function renderBlueskyComments() {
    const container = document.getElementById('bluesky-comments');
    if (!container) return;
    
    const uri = container.getAttribute('data-uri');

    if (!uri) {
        container.innerHTML = '<p>No comments are currently available. Check back later.</p>';
        return;
    }

    // Prevent multiple renders
    if (container._blueskyRoot) {
        return;
    }

    // Use the permanent DID instead of the handle
    const profileDid = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';
    const fullUri = `https://bsky.app/profile/${profileDid}/post/${uri}`;
    console.log('Rendering BlueskyComments with URI:', fullUri);

    const root = createRoot(container);
    container._blueskyRoot = root; // Store reference to prevent re-rendering

    root.render(
        createElement(BlueskyComments, {
            uri: fullUri,
        })
    );
}

// Listen for a custom event dispatched by main.js after setting the URI
window.addEventListener('bluesky_uri_set', renderBlueskyComments);

// Also attempt to render comments on DOMContentLoaded for any page
document.addEventListener('DOMContentLoaded', renderBlueskyComments);
