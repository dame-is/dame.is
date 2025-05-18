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

        // Add the CSS for custom styling
        const style = document.createElement('style');
        style.textContent = `
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
            
            /* Style for the Deer link that we'll add to the existing message */
            a.deer-link {
                color: #22c55e;
                text-decoration: underline;
                font-weight: 500;
                transition: color 0.2s;
            }
            
            a.deer-link:hover {
                color: #16a34a;
            }
            
            .dark-mode a.deer-link {
                color: #4ade80;
            }
            
            .dark-mode a.deer-link:hover {
                color: #34d399;
            }
        `;
        document.head.appendChild(style);
        
        // Create a div for the comments component
        const commentsComponentDiv = document.createElement('div');
        commentsComponentDiv.id = 'bluesky-comments-component';
        container.innerHTML = '';
        container.appendChild(commentsComponentDiv);

        const root = createRoot(commentsComponentDiv);
        container._blueskyRoot = root; // Store reference to prevent re-rendering

        root.render(
            createElement(BlueskyComments, {
                uri: blueskyUri,
            })
        );
        
        // Create a mutation observer to watch for the built-in "Join the conversation" message
        // and modify it to include Deer as an option
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    // Look for the text node that says "Join the conversation by replying on Bluesky."
                    const joinMessage = document.evaluate(
                        "//text()[contains(., 'Join the conversation by replying on Bluesky')]",
                        container,
                        null,
                        XPathResult.FIRST_ORDERED_NODE_TYPE,
                        null
                    ).singleNodeValue;
                    
                    if (joinMessage) {
                        // Get the parent element containing the message
                        const messageContainer = joinMessage.parentElement;
                        
                        if (messageContainer && !messageContainer.getAttribute('data-modified')) {
                            // Replace the text with a new message that includes both Bluesky and Deer
                            messageContainer.innerHTML = `Join the conversation by <a href="${blueskyUri}" target="_blank" rel="noopener noreferrer">replying on Bluesky</a> or <a href="${deerUri}" target="_blank" rel="noopener noreferrer" class="deer-link">Deer</a>.`;
                            
                            // Mark this element as modified to avoid repeated modifications
                            messageContainer.setAttribute('data-modified', 'true');
                            
                            // Disconnect the observer once we've found and modified the message
                            observer.disconnect();
                        }
                    }
                }
            });
        });
        
        // Start observing the container for changes
        observer.observe(container, { 
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
