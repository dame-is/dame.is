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
    const blueskyUri = `https://bsky.app/profile/${profileDid}/post/${uri}`;
    const deerUri = `https://deer.social/profile/${profileDid}/post/${uri}`;
    
    console.log('Rendering BlueskyComments with URI:', blueskyUri);

    // Add the CSS styles for the join conversation section
    const style = document.createElement('style');
    style.textContent = `
        .join-conversation-links {
            margin-bottom: 20px;
            font-size: 0.9em;
            padding: 12px 16px;
            background-color: #f5f5f5;
            border-radius: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .dark-mode .join-conversation-links {
            background-color: #2d3748;
            color: #e2e8f0;
        }
        
        .join-conversation-text {
            margin: 0;
        }
        
        .join-conversation-buttons {
            display: flex;
            gap: 10px;
        }
        
        .join-button {
            padding: 6px 12px;
            border-radius: 4px;
            text-decoration: none;
            transition: background-color 0.2s, color 0.2s;
            font-weight: 500;
        }
        
        .bluesky-button {
            background-color: #f0f7ff;
            color: #3b82f6;
            border: 1px solid #3b82f6;
        }
        
        .bluesky-button:hover {
            background-color: #dbeafe;
        }
        
        .deer-button {
            background-color: #f0fff4;
            color: #22c55e;
            border: 1px solid #22c55e;
        }
        
        .deer-button:hover {
            background-color: #dcfce7;
        }
        
        .dark-mode .bluesky-button {
            background-color: #1e293b;
            color: #60a5fa;
        }
        
        .dark-mode .deer-button {
            background-color: #1e293b;
            color: #4ade80;
        }
    `;
    document.head.appendChild(style);

    // Create the "Join the conversation" links
    const joinLinksDiv = document.createElement('div');
    joinLinksDiv.className = 'join-conversation-links';
    
    // Create text element
    const textElement = document.createElement('p');
    textElement.className = 'join-conversation-text';
    textElement.textContent = 'Join the conversation:';
    
    // Create buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'join-conversation-buttons';
    
    // Create Bluesky button
    const blueskyButton = document.createElement('a');
    blueskyButton.href = blueskyUri;
    blueskyButton.className = 'join-button bluesky-button';
    blueskyButton.textContent = 'Bluesky';
    blueskyButton.target = '_blank';
    blueskyButton.rel = 'noopener noreferrer';
    
    // Create Deer button
    const deerButton = document.createElement('a');
    deerButton.href = deerUri;
    deerButton.className = 'join-button deer-button';
    deerButton.textContent = 'Deer';
    deerButton.target = '_blank';
    deerButton.rel = 'noopener noreferrer';
    
    // Assemble the elements
    buttonsContainer.appendChild(blueskyButton);
    buttonsContainer.appendChild(deerButton);
    joinLinksDiv.appendChild(textElement);
    joinLinksDiv.appendChild(buttonsContainer);
    
    // Clear and add the links
    container.innerHTML = '';
    container.appendChild(joinLinksDiv);
    
    // Create a div for the actual comments component
    const commentsComponentDiv = document.createElement('div');
    commentsComponentDiv.id = 'bluesky-comments-component';
    container.appendChild(commentsComponentDiv);

    const root = createRoot(commentsComponentDiv);
    container._blueskyRoot = root; // Store reference to prevent re-rendering

    root.render(
        createElement(BlueskyComments, {
            uri: blueskyUri,
        })
    );
}

// Listen for a custom event dispatched by main.js after setting the URI
window.addEventListener('bluesky_uri_set', renderBlueskyComments);

// Also attempt to render comments on DOMContentLoaded for any page
document.addEventListener('DOMContentLoaded', renderBlueskyComments);
