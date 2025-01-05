// scripts/main.js

const GITHUB_USERNAME = 'damedotblog'; // Your GitHub username
const GITHUB_REPO = 'dame.is'; // Your repository name
const GITHUB_BRANCH = 'main'; // Your branch name

// Create a Promise that resolves when marked.js is loaded
const markedLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    script.onload = () => {
        console.log('Marked.js loaded successfully.');
        resolve();
    };
    script.onerror = () => {
        console.error('Failed to load marked.js.');
        reject(new Error('marked.js failed to load.'));
    };
    document.head.appendChild(script);
});

// Function to load HTML components
function loadComponent(id, url) {
    fetch(url)
        .then(response => response.text())
        .then(data => {
            document.getElementById(id).innerHTML = data;
            if (id === 'nav') {
                initializeNav();
            }
            if (id === 'footer') {
                initializeFooter();
            }
        })
        .catch(err => console.error(`Error loading ${url}:`, err));
}

// Load navigation and footer
document.addEventListener('DOMContentLoaded', () => {
    loadComponent('nav', 'components/nav.html');
    loadComponent('footer', 'components/footer.html');

    // If on index.html, load recent posts
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/') {
        initializePostLoader(); // Initialize the post loader with pagination
    }

    // If on log.html, load all posts as logs
    if (window.location.pathname.endsWith('log.html')) {
        initializeLogLoader();
    }

    // If on about.html or ethos.html, load Markdown content
    if (window.location.pathname.endsWith('about.html') || window.location.pathname.endsWith('ethos.html')) {
        loadMarkdownContent();
    }
});

// Initialize Navigation functionalities
function initializeNav() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    themeToggle.addEventListener('click', toggleTheme);
    // Set initial theme based on localStorage
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
        themeToggle.textContent = 'light mode';
    } else {
        themeToggle.textContent = 'dark mode';
    }

    // Fetch Bluesky stats
    fetchBlueskyStats();

    // Assign active class to current page link
    setActiveNavLink();
}

// Toggle Dark/Light Mode
function toggleTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
        themeToggle.textContent = 'light mode';
        localStorage.setItem('theme', 'dark');
    } else {
        themeToggle.textContent = 'dark mode';
        localStorage.setItem('theme', 'light');
    }
}

// Fetch Bluesky Stats
async function fetchBlueskyStats() {
    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Your actual actor identifier
    const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        document.getElementById('followers').textContent = data.followersCount;
        document.getElementById('following').textContent = data.followsCount;
        document.getElementById('posts').textContent = data.postsCount;
    } catch (error) {
        console.error('Error fetching Bluesky stats:', error);
    }
}

// Initialize Footer functionalities
function initializeFooter() {
    // Set version number and last updated
    fetchFooterData();
}

// Fetch Footer Data (Version and Last Updated)
async function fetchFooterData() {
    const apiUrlTags = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/tags`;
    const apiUrlCommits = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
    const apiUrlLastUpdated = 'last-updated.json'; // Path to the JSON file

    try {
        // Fetch the latest tag
        const responseTags = await fetch(apiUrlTags);
        if (!responseTags.ok) throw new Error(`GitHub Tags API error: ${responseTags.status}`);
        const tagsData = await responseTags.json();

        let version = 'No Tags';
        let lastUpdated = 'N/A';

        if (tagsData.length > 0) {
            // Assuming the tags are returned in descending order
            version = tagsData[0].name;
            // Fetch commit details for the latest tag
            const commitSha = tagsData[0].commit.sha;
            const apiUrlTagCommit = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/commits/${commitSha}`;
            const responseTagCommit = await fetch(apiUrlTagCommit);
            if (responseTagCommit.ok) {
                const tagCommitData = await responseTagCommit.json();
                const commitDate = new Date(tagCommitData.commit.committer.date);
                const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                lastUpdated = commitDate.toLocaleDateString(undefined, options);
            }
        } else {
            // If no tags exist, fallback to the latest commit
            const responseCommits = await fetch(apiUrlCommits);
            if (!responseCommits.ok) throw new Error(`GitHub Commits API error: ${responseCommits.status}`);
            const commitsData = await responseCommits.json();
            const latestCommit = commitsData;
            version = latestCommit.sha.substring(0, 7); // Short SHA for version
            const commitDate = new Date(latestCommit.commit.committer.date);
            const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
            lastUpdated = commitDate.toLocaleDateString(undefined, options);
        }

        // Fetch last-updated.json
        const responseLastUpdated = await fetch(apiUrlLastUpdated);
        if (!responseLastUpdated.ok) throw new Error(`Failed to fetch last-updated.json: ${responseLastUpdated.status}`);
        const lastUpdatedData = await responseLastUpdated.json();

        // Determine the current page
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';

        // Get the last updated date for the current page
        const pageLastUpdatedISO = lastUpdatedData[currentPage];
        let pageLastUpdated = 'N/A';
        if (pageLastUpdatedISO) {
            const date = new Date(pageLastUpdatedISO);
            pageLastUpdated = date.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
        }

        // Update the footer elements
        document.getElementById('version').textContent = version;
        document.getElementById('last-updated').textContent = pageLastUpdated;
    } catch (error) {
        console.error('Error fetching footer data:', error);
        document.getElementById('version').textContent = 'N/A';
        document.getElementById('last-updated').textContent = 'N/A';
    }
}

// Variables to manage pagination state
let currentBatchCursor = null; // To store the cursor for the next batch
const POSTS_PER_BATCH = 20; // Number of posts to fetch per batch
let isLoadingPosts = false; // Flag to prevent multiple simultaneous fetches

// Initialize Post Loader with Pagination
function initializePostLoader() {
    console.log('Initializing Post Loader with Pagination'); // Debugging
    // Initial load
    loadRecentPosts();

    // Create and append the "See More Posts" button
    const postsList = document.getElementById('recent-posts');
    if (!postsList) {
        console.error('Element with ID "recent-posts" not found.');
        return;
    }

    const seeMoreButton = document.createElement('button');
    seeMoreButton.id = 'see-more-posts';
    seeMoreButton.textContent = 'See More Posts';
    seeMoreButton.classList.add('see-more-button'); // Add a class for styling
    seeMoreButton.addEventListener('click', loadMorePosts);
    
    // Use insertAdjacentElement to place the button after the posts list
    postsList.insertAdjacentElement('afterend', seeMoreButton);
    console.log('"See More Posts" button created and appended.');
}

// Function to load recent posts with pagination
async function loadRecentPosts(cursor = null) {
    console.log('Loading recent posts', cursor ? `with cursor: ${cursor}` : '');
    if (isLoadingPosts) {
        console.log('Already loading posts. Exiting.');
        return; // Prevent multiple fetches
    }
    isLoadingPosts = true;

    // -------------------------
    // 1. Pluralization Helper
    // -------------------------
    /**
     * Formats a count with the appropriate singular or plural noun.
     * @param {number} count - The count of items.
     * @param {string} singular - The singular form of the noun.
     * @param {string} [plural] - The plural form of the noun. If not provided, 'singular' + 's' is used.
     * @returns {string} - Formatted string with count and correct noun form.
     */
    function formatCount(count, singular, plural = null) {
        const actualPlural = plural || `${singular}s`;
        return `${count} ${count === 1 ? singular : actualPlural}`;
    }

    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Your actual actor identifier
    let apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${POSTS_PER_BATCH}&filter=posts_no_replies`;

    if (cursor) {
        apiUrl += `&cursor=${encodeURIComponent(cursor)}`;
    }

    try {
        console.log(`Fetching posts from API: ${apiUrl}`);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            throw new Error(`Network response was not ok: ${response.status}`);
        }
        const data = await response.json();
        console.log('Posts fetched successfully:', data);

        // Update the cursor for the next batch
        currentBatchCursor = data.cursor || null;
        console.log('Current batch cursor updated to:', currentBatchCursor);

        const postsList = document.getElementById('recent-posts');

        // **Filter out reposts before processing**
        const filteredFeed = data.feed.filter(item => {
            // Exclude if 'reason' exists and its '$type' is 'app.bsky.feed.defs#reasonRepost'
            return !(item.reason && item.reason.$type === "app.bsky.feed.defs#reasonRepost");
        });

        // Iterate over the filtered feed
        filteredFeed.forEach(item => {
            const post = item.post; // Access the 'post' object

            // Ensure 'post' and 'record' exist
            if (post && post.record) {
                // Create a container for each post
                const postContainer = document.createElement('div');
                postContainer.classList.add('post');

                // ============================
                // 1. Handle Post Text
                // ============================
                const postText = post.record.text && post.record.text.trim() !== '' ? post.record.text : null;

                if (postText) {
                    const postTextContainer = document.createElement('div');
                    postTextContainer.classList.add('post-text-container');

                    // Split the text by double line breaks to create paragraphs
                    const paragraphs = postText.split('\n\n');

                    paragraphs.forEach(paragraph => {
                        const p = document.createElement('p');
                        // Replace single line breaks with spaces within paragraphs
                        const formattedParagraph = paragraph.replace(/\n/g, ' ');
                        p.textContent = formattedParagraph;
                        postTextContainer.appendChild(p);
                    });

                    postContainer.appendChild(postTextContainer);
                } else {
                    console.log('Post has no content. Skipping post-text-container.');
                }

                // ============================
                // 2. Handle Image Embeds
                // ============================
                if (post.embed && post.embed.$type === "app.bsky.embed.images#view" && Array.isArray(post.embed.images)) {
                    const images = post.embed.images.slice(0, 4); // Limit to 4 images

                    images.forEach(imageData => {
                        if (imageData.fullsize && imageData.alt) {
                            const img = document.createElement('img');
                            img.src = imageData.fullsize;
                            img.alt = imageData.alt;
                            img.loading = 'lazy';
                            img.classList.add('post-image'); // Add a class for styling
                            postContainer.appendChild(img);
                        }
                    });
                }

                // ============================
                // 3. Handle Created At Date
                // ============================
                const postDate = document.createElement('p');
                postDate.classList.add('post-date');

                // Extract the Post ID from the URI
                const uri = post.uri; // e.g., "at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.feed.post/3lep2fdto622v"
                if (uri) {
                    const postId = uri.split('/').pop(); // Extracts "3lep2fdto622v"

                    // Construct the Bluesky URL
                    const blueskyUrl = `https://bsky.app/profile/dame.bsky.social/post/${postId}`;

                    // Format the Date
                    const date = new Date(post.record.createdAt || Date.now());
                    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                    const formattedDate = date.toLocaleDateString(undefined, options);

                    // Create the link element
                    const dateLink = document.createElement('a');
                    dateLink.href = blueskyUrl;
                    dateLink.textContent = formattedDate;
                    dateLink.target = '_blank'; // Opens the link in a new tab
                    dateLink.rel = 'noopener noreferrer'; // Security best practices

                    // Append "Posted on" text and the link
                    postDate.textContent = 'Posted on ';
                    postDate.appendChild(dateLink);
                } else {
                    // Handle posts without a URI
                    const date = new Date(post.record.createdAt || Date.now());
                    const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                    const formattedDate = date.toLocaleDateString(undefined, options);
                    postDate.textContent = `Posted on ${formattedDate}`;
                }

                postContainer.appendChild(postDate);

                // ============================
                // 4. Handle Counts (Replies, Quotes, Reposts, Likes)
                // ============================
                const countsContainer = document.createElement('div');
                countsContainer.classList.add('post-counts');

                // Reply Count
                const replyCount = document.createElement('span');
                const replies = post.replyCount || 0;
                replyCount.textContent = formatCount(replies, 'reply');
                countsContainer.appendChild(replyCount);

                // Quote Count
                const quoteCount = document.createElement('span');
                const quotes = post.quoteCount || 0;
                quoteCount.textContent = formatCount(quotes, 'quote');
                countsContainer.appendChild(quoteCount);

                // Repost Count
                const repostCount = document.createElement('span');
                const reposts = post.repostCount || 0;
                repostCount.textContent = formatCount(reposts, 'repost');
                countsContainer.appendChild(repostCount);

                // Like Count
                const likeCount = document.createElement('span');
                const likes = post.likeCount || 0;
                likeCount.textContent = formatCount(likes, 'like');
                countsContainer.appendChild(likeCount);

                postContainer.appendChild(countsContainer);

                // ============================
                // 5. Append the Post to the List
                // ============================
                postsList.appendChild(postContainer);
            } else {
                console.warn('Post or record missing in the feed item:', item);
            }
        });

        // If there are no more posts to load, hide the "See More Posts" button
        if (!currentBatchCursor) {
            const seeMoreButton = document.getElementById('see-more-posts');
            if (seeMoreButton) {
                seeMoreButton.style.display = 'none';
                console.log('No more posts to load. "See More Posts" button hidden.');
            }
        }
    } catch (error) {
        console.error('Error fetching recent posts:', error);
        const postsList = document.getElementById('recent-posts');
        if (postsList) {
            postsList.innerHTML = '<p>Failed to load posts. Please try again later.</p>';
        }
    } finally {
        isLoadingPosts = false;
        console.log('Finished loading posts.');
    }
}


// Function to load more posts when "See More Posts" button is clicked
function loadMorePosts() {
    console.log('"See More Posts" button clicked.');
    if (!currentBatchCursor) {
        console.log('No cursor available. Cannot load more posts.');
        return; // No more posts to load
    }
    loadRecentPosts(currentBatchCursor);
}

// Load Markdown Content for About and Ethos Pages
async function loadMarkdownContent() {
    try {
        // Wait until marked.js is loaded
        await markedLoadPromise;

        const path = window.location.pathname.endsWith('about.html') ? 'about.md' : 'ethos.md';
        const response = await fetch(path);
        if (!response.ok) throw new Error('Network response was not ok');
        const markdown = await response.text();
        const htmlContent = marked.parse(markdown);
        document.getElementById(`${path.split('.')[0]}-content`).innerHTML = htmlContent;
    } catch (error) {
        console.error('Error loading Markdown content:', error);
    }
}

// Function to Set Active Navigation Link
function setActiveNavLink() {
    // Get the current page's path
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';

    // Get all navigation links
    const navLinks = document.querySelectorAll('.nav-left .nav-link');

    navLinks.forEach(link => {
        // Get the href attribute of the link
        const linkPath = link.getAttribute('href');

        // Compare linkPath with currentPath
        if (linkPath === currentPath) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// Function to Initialize Log Loader with Loading Indicators and Grouping
function initializeLogLoader() {
    console.log('Initializing Log Loader');

    // Variables to manage pagination state
    let currentLogCursor = null; // To store the cursor for the next batch
    const LOGS_PER_BATCH = 20; // Number of logs to fetch per batch
    let isLoadingLogs = false; // Flag to prevent multiple simultaneous fetches

    // Function to load logs
    async function loadLogs(cursor = null) {
        console.log('Loading logs', cursor ? `with cursor: ${cursor}` : '');
        if (isLoadingLogs) {
            console.log('Already loading logs. Exiting.');
            return; // Prevent multiple fetches
        }
        isLoadingLogs = true;

        const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Your actual actor identifier
        let apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${LOGS_PER_BATCH}&filter=posts_no_replies`;

        if (cursor) {
            apiUrl += `&cursor=${encodeURIComponent(cursor)}`;
        }

        try {
            console.log(`Fetching logs from API: ${apiUrl}`);
            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status}`);
            }
            const data = await response.json();
            console.log('Logs fetched successfully:', data);

            // Update the cursor for the next batch
            currentLogCursor = data.cursor || null;
            console.log('Current log cursor updated to:', currentLogCursor);

            const logsList = document.getElementById('log-entries');
            const loadingIndicator = document.getElementById('loading-logs'); // Loading indicator element

            // **Filter out reposts before processing**
            const filteredFeed = data.feed.filter(item => {
                // Exclude if 'reason' exists and its '$type' is 'app.bsky.feed.defs#reasonRepost'
                return !(item.reason && item.reason.$type === "app.bsky.feed.defs#reasonRepost");
            });

            // Sort posts by createdAt descending (latest first)
            filteredFeed.sort((a, b) => new Date(b.post.record.createdAt) - new Date(a.post.record.createdAt));

            // Group posts by day
            const groupedPosts = groupPostsByDay(filteredFeed);

            // Iterate over each day group
            for (const [date, posts] of Object.entries(groupedPosts)) {
                // Check if the date header already exists to avoid duplicates
                if (!document.querySelector(`.log-date-header[data-date="${date}"]`)) {
                    // Create a date header
                    const dateHeader = document.createElement('h2');
                    dateHeader.classList.add('log-date-header');
                    dateHeader.textContent = date;
                    dateHeader.setAttribute('data-date', date); // Attribute to track existing headers
                    logsList.appendChild(dateHeader);
                }

                // Iterate over posts for the current day
                posts.forEach(post => {
                    // Create a container for each log entry
                    const logContainer = document.createElement('div');
                    logContainer.classList.add('log-entry');

                    // Post text
                    const logText = document.createElement('p');
                    logText.classList.add('log-text');
                    logText.textContent = post.post.record.text.trim();
                    logContainer.appendChild(logText);

                    // Timestamp
                    const logTimestamp = document.createElement('p');
                    logTimestamp.classList.add('log-timestamp');
                    const createdAt = new Date(post.post.record.createdAt);
                    const relativeTime = getRelativeTime(createdAt);
                    const timeString = createdAt.toLocaleTimeString(undefined, { hour12: false }) + ` on ${formatDate(createdAt)}`;
                    logTimestamp.textContent = `${relativeTime} (${timeString})`;
                    logContainer.appendChild(logTimestamp);

                    // Append the log entry to the logs list
                    logsList.appendChild(logContainer);
                });
            }

            // If there are no more logs to load, hide the "See More Logs" button
            if (!currentLogCursor) {
                const seeMoreButton = document.getElementById('see-more-logs');
                if (seeMoreButton) {
                    seeMoreButton.style.display = 'none';
                    console.log('No more logs to load. "See More Logs" button hidden.');
                }
            }
        } catch (error) {
            console.error('Error fetching logs:', error);
            const logsList = document.getElementById('log-entries');
            if (logsList) {
                logsList.innerHTML += '<p>Failed to load logs. Please try again later.</p>';
            }
        } finally {
            // Hide loading indicator
            const loadingIndicator = document.getElementById('loading-logs');
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            isLoadingLogs = false;
            console.log('Finished loading logs.');
        }
    }

    // Function to calculate relative time (e.g., "1 hour ago")
    function getRelativeTime(date) {
        const now = new Date();
        const diffInSeconds = Math.floor((now - date) / 1000);

        const intervals = [
            { label: 'year', seconds: 31536000 },
            { label: 'month', seconds: 2592000 },
            { label: 'day', seconds: 86400 },
            { label: 'hour', seconds: 3600 },
            { label: 'minute', seconds: 60 },
            { label: 'second', seconds: 1 }
        ];

        for (const interval of intervals) {
            const count = Math.floor(diffInSeconds / interval.seconds);
            if (count >= 1) {
                return `${count} ${interval.label}${count !== 1 ? 's' : ''} ago`;
            }
        }

        return 'just now';
    }

    // Function to format date as MM-DD-YYYY
    function formatDate(date) {
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        return `${month}-${day}-${year}`;
    }

    // Function to group posts by day
    function groupPostsByDay(posts) {
        const groups = {};

        posts.forEach(item => {
            const postDate = new Date(item.post.record.createdAt);
            const year = postDate.getFullYear();
            const month = postDate.toLocaleString('default', { month: 'long' });
            const day = postDate.getDate();
            const dateKey = `${month} ${day}, ${year}`;

            if (!groups[dateKey]) {
                groups[dateKey] = [];
            }
            groups[dateKey].push(item);
        });

        return groups;
    }

    // Function to load more logs when "See More Logs" button is clicked
    function loadMoreLogs() {
        console.log('"See More Logs" button clicked.');
        if (!currentLogCursor) {
            console.log('No cursor available. Cannot load more logs.');
            return; // No more logs to load
        }
        loadLogs(currentLogCursor);
    }

    // Load initial logs
    loadLogs();

    // Add event listener to the "See More Logs" button
    const seeMoreButton = document.getElementById('see-more-logs');
    if (seeMoreButton) {
        seeMoreButton.addEventListener('click', loadMoreLogs);
    } else {
        console.error('Element with ID "see-more-logs" not found.');
    }
}
