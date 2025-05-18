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

    try {
        // Use handle instead of DID for compatibility
        const profileHandle = 'dame.is';
        const blueskyUri = `https://bsky.app/profile/${profileHandle}/post/${uri}`;
        const deerUri = `https://deer.social/profile/${profileHandle}/post/${uri}`;
        
        console.log('Rendering BlueskyComments with URI:', blueskyUri);

        // Add the CSS styles for the join conversation section
        const style = document.createElement('style');
        style.textContent = `
            .custom-conversation-links {
                margin-bottom: 20px;
                margin-top: 10px;
                font-size: 0.9em;
                padding: 12px 16px;
                background-color: #f5f5f5;
                border-radius: 8px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            .dark-mode .custom-conversation-links {
                background-color: #2d3748;
                color: #e2e8f0;
            }
            
            .conversation-text {
                margin: 0;
            }
            
            .conversation-buttons {
                display: flex;
                gap: 10px;
            }
            
            .app-button {
                padding: 6px 12px;
                border-radius: 4px;
                text-decoration: none;
                transition: background-color 0.2s, color 0.2s;
                font-weight: 500;
            }
            
            .bluesky-app-button {
                background-color: #f0f7ff;
                color: #3b82f6;
                border: 1px solid #3b82f6;
            }
            
            .bluesky-app-button:hover {
                background-color: #dbeafe;
            }
            
            .deer-app-button {
                background-color: #f0fff4;
                color: #22c55e;
                border: 1px solid #22c55e;
            }
            
            .deer-app-button:hover {
                background-color: #dcfce7;
            }
            
            .dark-mode .bluesky-app-button {
                background-color: #1e293b;
                color: #60a5fa;
            }
            
            .dark-mode .deer-app-button {
                background-color: #1e293b;
                color: #4ade80;
            }
            
            .comments-error {
                padding: 10px;
                margin-top: 10px;
                background-color: #fff5f5;
                color: #e53e3e;
                border: 1px solid #fc8181;
                border-radius: 4px;
            }
            
            .dark-mode .comments-error {
                background-color: #3b1818;
                color: #fc8181;
                border-color: #fc8181;
            }
            
            /* Add observer to insert our custom links after component loads */
            .bluesky-comments-header + div {
                position: relative;
            }
        `;
        document.head.appendChild(style);

        // Create the div for the comments component
        const commentsComponentDiv = document.createElement('div');
        commentsComponentDiv.id = 'bluesky-comments-component';
        
        // Clear and add content
        container.innerHTML = '';
        container.appendChild(commentsComponentDiv);

        const root = createRoot(commentsComponentDiv);
        container._blueskyRoot = root; // Store reference to prevent re-rendering

        root.render(
            createElement(BlueskyComments, {
                uri: blueskyUri,
            })
        );
        
        // Set up a mutation observer to add our custom links after the BlueskyComments component renders
        const observer = new MutationObserver((mutations, obs) => {
            // Look for the first div after the component's own header text
            const commentHeader = commentsComponentDiv.querySelector('div > div:first-child');
            
            if (commentHeader) {
                // Create our custom links container
                const linksContainer = document.createElement('div');
                linksContainer.className = 'custom-conversation-links';
                
                // Create text element
                const textElement = document.createElement('p');
                textElement.className = 'conversation-text';
                textElement.textContent = 'Join this conversation via:';
                
                // Create buttons container
                const buttonsContainer = document.createElement('div');
                buttonsContainer.className = 'conversation-buttons';
                
                // Create Bluesky button
                const blueskyButton = document.createElement('a');
                blueskyButton.href = blueskyUri;
                blueskyButton.className = 'app-button bluesky-app-button';
                blueskyButton.textContent = 'Bluesky';
                blueskyButton.target = '_blank';
                blueskyButton.rel = 'noopener noreferrer';
                
                // Create Deer button
                const deerButton = document.createElement('a');
                deerButton.href = deerUri;
                deerButton.className = 'app-button deer-app-button';
                deerButton.textContent = 'Deer';
                deerButton.target = '_blank';
                deerButton.rel = 'noopener noreferrer';
                
                // Assemble the elements
                buttonsContainer.appendChild(blueskyButton);
                buttonsContainer.appendChild(deerButton);
                linksContainer.appendChild(textElement);
                linksContainer.appendChild(buttonsContainer);
                
                // Insert our links after the header
                commentHeader.insertAdjacentElement('afterend', linksContainer);
                
                // Disconnect the observer once we've inserted our links
                obs.disconnect();
            }
        });
        
        // Start observing the comments component
        observer.observe(commentsComponentDiv, {
            childList: true,
            subtree: true
        });
    } catch (error) {
        console.error('Error rendering Bluesky comments:', error);
        
        // Display an error message
        const errorDiv = document.createElement('div');
        errorDiv.className = 'comments-error';
        errorDiv.innerHTML = `
            <p><strong>Error loading comments</strong></p>
            <p>Something went wrong while loading the comments. Please try refreshing the page.</p>
            <p><small>Technical details: ${error.message}</small></p>
        `;
        
        container.innerHTML = '';
        container.appendChild(errorDiv);
    }
}

// Listen for a custom event dispatched by main.js after setting the URI
window.addEventListener('bluesky_uri_set', renderBlueskyComments);

// Also attempt to render comments on DOMContentLoaded for any page
document.addEventListener('DOMContentLoaded', renderBlueskyComments);
