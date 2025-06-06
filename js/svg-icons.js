// js/svg-icons.js

document.addEventListener("DOMContentLoaded", function() {
    // Mapping of original 'd' attributes to replacement SVGs and their respective classes
    const svgReplacements = {
        // Heart Icon Replacement
        "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z": {
            svg: `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                    <!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com 
                    License - https://fontawesome.com/license/free 
                    Copyright 2025 Fonticons, Inc.-->
                    <path d="M47.6 300.4L228.3 469.1c7.5 7 17.4 10.9 27.7 10.9s20.2-3.9 27.7-10.9L464.4 300.4c30.4-28.3 47.6-68 47.6-109.5v-5.8c0-69.9-50.5-129.5-119.4-141C347 36.5 300.6 51.4 268 84L256 96 244 84c-32.6-32.6-79-47.5-124.6-39.9C50.5 55.6 0 115.2 0 185.1v5.8c0 41.5 17.2 81.2 47.6 109.5z"/>
                </svg>
            `,
            className: "comment-heart"
        },

        // Repost Icon Replacement
        "M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 0 0-3.7-3.7 48.678 48.678 0 0 0-7.324 0 4.006 4.006 0 0 0-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 0 0 3.7 3.7 48.656 48.656 0 0 0 7.324 0 4.006 4.006 0 0 0 3.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3-3 3": {
            svg: `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512">
                    <!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com 
                    License - https://fontawesome.com/license/free 
                    Copyright 2025 Fonticons, Inc.-->
                    <path d="M272 416c17.7 0 32-14.3 32-32s-14.3-32-32-32l-112 0c-17.7 0-32-14.3-32-32l0-128 32 0c12.9 0 24.6-7.8 29.6-19.8s2.2-25.7-6.9-34.9l-64-64c-12.5-12.5-32.8-12.5-45.3 0l-64 64c-9.2 9.2-11.9 22.9-6.9 34.9s16.6 19.8 29.6 19.8l32 0 0 128c0 53 43 96 96 96l112 0zM304 96c-17.7 0-32 14.3-32 32s14.3 32 32 32l112 0c17.7 0 32 14.3 32 32l0 128-32 0c-12.9 0-24.6 7.8-29.6 19.8s-2.2 25.7 6.9 34.9l64 64c12.5 12.5 32.8 12.5 45.3 0l64-64c9.2-9.2 11.9-22.9 6.9-34.9s-16.6-19.8-29.6-19.8l-32 0 0-128c0-53-43-96-96-96L304 96z"/>
                </svg>
            `,
            className: "comment-repost"
        },

        // Reply Icon Replacement
        "M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 0 1-.923 1.785A5.969 5.969 0 0 0 6 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337Z": {
            svg: `
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
                    <!--!Font Awesome Free 6.7.2 by @fontawesome - https://fontawesome.com 
                    License - https://fontawesome.com/license/free 
                    Copyright 2025 Fonticons, Inc.-->
                    <path d="M205 34.8c11.5 5.1 19 16.6 19 29.2l0 64 112 0c97.2 0 176 78.8 176 176c0 113.3-81.5 163.9-100.2 174.1c-2.5 1.4-5.3 1.9-8.1 1.9c-10.9 0-19.7-8.9-19.7-19.7c0-7.5 4.3-14.4 9.8-19.5c9.4-8.8 22.2-26.4 22.2-56.7c0-53-43-96-96-96l-96 0 0 64c0 12.6-7.4 24.1-19 29.2s-25 3-34.4-5.4l-160-144C3.9 225.7 0 217.1 0 208s3.9-17.7 10.6-23.8l160-144c9.4-8.5 22.9-10.6 34.4-5.4z"/>
                </svg>
            `,
            className: "comment-reply"
        }
    };

    /**
     * Replaces SVG icons based on their 'd' attribute and assigns distinct classes.
     */
    function replaceSVGIcons() {
        // Select all SVG elements with the new class names from v0.11.1
        const svgIcons = document.querySelectorAll('svg._icon_yf3k8_31, svg[class*="_icon_"]');

        svgIcons.forEach(svg => {
            // Find the <path> element within the SVG
            const path = svg.querySelector('path');
            if (!path) return; // If no path found, skip

            const originalD = path.getAttribute('d').trim();

            // Check if this 'd' matches any in our replacement mapping
            if (svgReplacements.hasOwnProperty(originalD)) {
                const { svg: newSVGString, className } = svgReplacements[originalD];

                // Create a temporary container to parse the new SVG string
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = newSVGString.trim();
                const newSVGElement = tempDiv.firstChild;

                // Assign the specific class to the new SVG
                if (className) {
                    newSVGElement.classList.add(className);
                }

                // Retain any existing classes except the original icon classes
                svg.classList.forEach(cls => {
                    if (!cls.includes('_icon_')) {
                        newSVGElement.classList.add(cls);
                    }
                });

                // Replace the old SVG with the new one
                svg.parentNode.replaceChild(newSVGElement, svg);
            }
        });
    }

    // Initial replacement on page load
    replaceSVGIcons();

    // Observe changes in the comments section to replace SVGs in dynamically loaded content
    const commentsSection = document.getElementById('comments-section');
    if (commentsSection) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.addedNodes.length) {
                    replaceSVGIcons();
                }
            });
        });

        observer.observe(commentsSection, { childList: true, subtree: true });
    }
});
