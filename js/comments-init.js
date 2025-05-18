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
    if (container._blueskyInitialized) {
        return;
    }
    container._blueskyInitialized = true;

    try {
        // Use handle for compatibility
        const profileHandle = 'dame.is';
        const blueskyUri = `https://bsky.app/profile/${profileHandle}/post/${uri}`;
        const deerUri = `https://deer.social/profile/${profileHandle}/post/${uri}`;
        
        console.log('Preparing BlueskyComments with URI:', blueskyUri);

        // Add the CSS for custom styling
        const style = document.createElement('style');
        style.textContent = `
            /* Style for links in the conversation message */
            .conversation-link {
                text-decoration: underline;
                font-weight: 500;
                transition: color 0.2s;
            }
            
            .bluesky-link {
                color: #3b82f6;
            }
            
            .bluesky-link:hover {
                color: #2563eb;
            }
            
            .deer-link {
                color: #22c55e;
            }
            
            .deer-link:hover {
                color: #16a34a;
            }
            
            .dark-mode .bluesky-link {
                color: #60a5fa;
            }
            
            .dark-mode .deer-link {
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

            /* Hide the duplicate h1 from the comments component */
            .bluesky-comments-header {
                display: none !important;
            }

            /* Modify the join conversation text */
            .bluesky-join-conversation {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 20px;
                flex-wrap: wrap;
            }
        `;
        document.head.appendChild(style);
        
        // Create the component and render
        const commentsComponent = createElement(BlueskyComments, { uri: blueskyUri });
        const root = createRoot(container);
        container._blueskyRoot = root;
        root.render(commentsComponent);

        // Add a MutationObserver to modify the DOM after render
        const observer = new MutationObserver((mutations, obs) => {
            // Look for the Join the conversation text
            const joinConversationElement = container.querySelector('p:contains("Join the conversation by")');
            
            // Use document.evaluate as a fallback for the selector
            if (!joinConversationElement) {
                const xpathResult = document.evaluate(
                    ".//p[contains(text(), 'Join the conversation by')]",
                    container,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                );
                
                if (xpathResult.singleNodeValue) {
                    const element = xpathResult.singleNodeValue;
                    if (!element.getAttribute('data-modified')) {
                        element.innerHTML = `Join the conversation by <a href="${blueskyUri}" target="_blank" rel="noopener noreferrer" class="conversation-link bluesky-link">replying on Bluesky</a> or <a href="${deerUri}" target="_blank" rel="noopener noreferrer" class="conversation-link deer-link">Deer</a>.`;
                        element.setAttribute('data-modified', 'true');
                    }
                }
            }
            
            // Find and hide the duplicate header
            const headers = container.querySelectorAll('h1, h2');
            headers.forEach(header => {
                // If it's not the first h2 in the page and contains "Comments"
                if (header.textContent.includes('Comments')) {
                    header.classList.add('bluesky-comments-header');
                }
            });
            
            // Disconnect after processing
            setTimeout(() => {
                obs.disconnect();
                
                // Final check for the reply link text
                const finalCheck = document.evaluate(
                    ".//p[contains(text(), 'Join the conversation by')]",
                    container,
                    null,
                    XPathResult.FIRST_ORDERED_NODE_TYPE,
                    null
                );
                
                if (finalCheck.singleNodeValue && !finalCheck.singleNodeValue.getAttribute('data-modified')) {
                    finalCheck.singleNodeValue.innerHTML = `Join the conversation by <a href="${blueskyUri}" target="_blank" rel="noopener noreferrer" class="conversation-link bluesky-link">replying on Bluesky</a> or <a href="${deerUri}" target="_blank" rel="noopener noreferrer" class="conversation-link deer-link">Deer</a>.`;
                    finalCheck.singleNodeValue.setAttribute('data-modified', 'true');
                }
            }, 1500);
        });
        
        // Start observing with a delay to ensure the component has time to render
        setTimeout(() => {
            observer.observe(container, { 
                childList: true, 
                subtree: true,
                characterData: true
            });
        }, 1000);
        
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

// Add a jQuery-like contains selector for text content
if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector || Element.prototype.webkitMatchesSelector;
}

if (typeof document !== 'undefined') {
    document.querySelectorAll = document.querySelectorAll || function(selector) {
        return Array.from(document.getElementsByTagName('*')).filter(function(element) {
            return element.matches(selector);
        });
    };
    
    // Add contains text selector
    const oldQuerySelectorAll = document.querySelectorAll;
    document.querySelectorAll = function(selector) {
        try {
            if (selector.includes(':contains(')) {
                const matches = selector.match(/:contains\("([^"]+)"\)/);
                if (matches) {
                    const containsText = matches[1];
                    const baseSelector = selector.replace(/:contains\("([^"]+)"\)/, '');
                    const elements = Array.from(oldQuerySelectorAll.call(document, baseSelector));
                    return elements.filter(el => el.textContent.includes(containsText));
                }
            }
            return oldQuerySelectorAll.call(document, selector);
        } catch (e) {
            return oldQuerySelectorAll.call(document, selector);
        }
    };
}

// Listen for a custom event dispatched by main.js after setting the URI
window.addEventListener('bluesky_uri_set', renderBlueskyComments);

// Also attempt to render comments on DOMContentLoaded for any page
document.addEventListener('DOMContentLoaded', renderBlueskyComments);
