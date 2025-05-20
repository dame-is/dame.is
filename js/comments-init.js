// js/comments-init.js

import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BlueskyComments } from 'https://unpkg.com/bluesky-comments@0.11.1/dist/bluesky-comments.es.js';

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
        
        console.log('Rendering BlueskyComments with URI:', blueskyUri);

        // Add styles for comments and error messages
        const style = document.createElement('style');
        style.textContent = `
            /* Remove margins from comment containers */
            ._commentContainer_yf3k8_90 {
                margin: 1rem 0;
                font-size: .875rem;
                margin-bottom: 0px;
            }
            
            /* Add a subtle border to replies container */
            ._repliesContainer_yf3k8_142 {
                border-left: 0px !important;
            }
            
            /* Hide the actions container */
            ._actionsContainer_yf3k8_90 {
                display: none !important;
            }
            
            /* Alignment classes for stats bar and reply text */
            .nav-align-left ._statsBar_yf3k8_12,
            .nav-align-left ._replyText_yf3k8_56 {
                text-align: left;
                justify-content: flex-start;
            }

            .nav-align-center ._statsBar_yf3k8_12,
            .nav-align-center ._replyText_yf3k8_56 {
                text-align: center;
                justify-content: center;
            }

            .nav-align-right ._statsBar_yf3k8_12,
            .nav-align-right ._replyText_yf3k8_56 {
                text-align: right;
                justify-content: flex-end;
            }
            
            /* Error styles */
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
            
            /* Dark mode support for reply container border */
            .dark-mode ._repliesContainer_yf3k8_142 {
                border-left-color: #52525280 !important;
            }

            /* Author link styles */
            ._authorLink_yf3k8_102 {
                display: flex;
                flex-direction: row;
                justify-content: flex-start;
                gap: .5rem;
            }

            /* Author name styles */
            ._authorName_yf3k8_50 {
                margin-bottom: 0px;
            }
            /* Remove reply stats */
            ._actionsContainer_yf3k8_147 {
                display: none !important;
            }

            /* Comments list styles */
            ._commentsList_yf3k8_65 p {
                margin-bottom: 0px;
            }

            ._commentContent_yf3k8_95 {
                padding: 0.4rem 0 0 !important;
                margin: 10px !important;
                margin-top: 0.2rem !important;
                margin-bottom: 0px !important;
            }

            ._commentContainer_yf3k8_90 {
                margin: 0.5rem 0 !important;
            }

            /* Individual comment margins */
            ._commentContent_yf3k8_95 {
                margin: 10px !important;
            }

            ._divider_yf3k8_61 {
            	display: none !important;
            }
        `;
        document.head.appendChild(style);
        
        // Create a div for the comments component
        const commentsComponentDiv = document.createElement('div');
        commentsComponentDiv.id = 'bluesky-comments-component';
        
        // Replace the container's content
        container.innerHTML = '';
        container.appendChild(commentsComponentDiv);

        const root = createRoot(commentsComponentDiv);
        container._blueskyRoot = root; // Store reference to prevent re-rendering

        root.render(
            createElement(BlueskyComments, {
                uri: blueskyUri,
            })
        );
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
