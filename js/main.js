// scripts/main.js

const GITHUB_USERNAME = 'damedotblog'; // Your GitHub username
const GITHUB_REPO = 'dame.is'; // Your repository name
const GITHUB_BRANCH = 'main'; // Your branch name

// ----------------------------------
// 1. HELPER: Load Marked.js
// ----------------------------------
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

// ----------------------------------
// 2. HELPER: Load HTML Components
// ----------------------------------
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

// ----------------------------------
// 3. NAV INITIALIZATION
// ----------------------------------
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

    // NEW CODE: Fetch the most recent log and update nav
    fetchLatestLogForNav();
}

// ----------------------------------
// 4. THEME TOGGLE
// ----------------------------------
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

// ----------------------------------
// 5. FETCH BLUESKY STATS
// ----------------------------------
async function fetchBlueskyStats() {
    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Your actual actor identifier for stats
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

// ----------------------------------
// 6. FETCH LATEST LOG FOR NAV
// ----------------------------------
// This function fetches your log feed (did:plc:jucg4ddb2budmcy2pjo5fo2g)
// and updates #recent-log-title + #recent-log-time with the most recent entry.
async function fetchLatestLogForNav() {
    try {
        const actor = 'did:plc:jucg4ddb2budmcy2pjo5fo2g'; // Actor ID for your log feed
        // Limit=1: only need the most recent
        let apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=1&filter=posts_no_replies`;

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`Network response was not ok: ${response.status}`);

        const data = await response.json();
        const feedItems = data.feed || [];

        // Filter out any reposts
        const filteredItems = feedItems.filter(item => {
            return !(item.reason && item.reason.$type === "app.bsky.feed.defs#reasonRepost");
        });

        if (filteredItems.length > 0) {
            const mostRecent = filteredItems[0].post; // The newest post
            if (mostRecent && mostRecent.record) {
                // Update Title
                const text = mostRecent.record.text.trim();
                document.getElementById('recent-log-text').textContent = text || 'No recent log';

                // Update Time
                const createdAt = new Date(mostRecent.record.createdAt);
                const relativeTime = getRelativeTime(createdAt);
                document.getElementById('recent-log-time').textContent = relativeTime;
            }
        } else {
            // If no logs found, set fallback text
            document.getElementById('recent-log-text').textContent = 'No recent log';
            document.getElementById('recent-log-time').textContent = '';
        }
    } catch (error) {
        console.error('Error fetching the latest log for nav:', error);
    }
}

// NEW CODE: Shared helper to compute relative times, copied from your log loader.
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

// ----------------------------------
// 7. FOOTER
// ----------------------------------
function initializeFooter() {
    fetchFooterData();
}

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
            // Use the first (most recent) tag
            version = tagsData[0].name;
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
            version = latestCommit.sha.substring(0, 7); // Short SHA
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

// ----------------------------------
// 8. POST LOADER (INDEX PAGE)
// ----------------------------------
let currentBatchCursor = null; // To store the cursor for the next batch
const POSTS_PER_BATCH = 20; // Number of posts to fetch per batch
let isLoadingPosts = false; // Flag to prevent multiple simultaneous fetches

function initializePostLoader() {
    console.log('Initializing Post Loader with Pagination');
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
    seeMoreButton.classList.add('see-more-button');
    seeMoreButton.addEventListener('click', loadMorePosts);

    // Place the button after the posts list
    postsList.insertAdjacentElement('afterend', seeMoreButton);
    console.log('"See More Posts" button created and appended.');
}

async function loadRecentPosts(cursor = null) {
    console.log('Loading recent posts', cursor ? `with cursor: ${cursor}` : '');
    if (isLoadingPosts) {
        console.log('Already loading posts. Exiting.');
        return;
    }
    isLoadingPosts = true;

    // Helper to handle singular/plural
    function formatCount(count, singular, plural = null) {
        const actualPlural = plural || `${singular}s`;
        return `${count} ${count === 1 ? singular : actualPlural}`;
    }

    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Your feed for posts
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

        // Filter out reposts
        const filteredFeed = data.feed.filter(item => {
            return !(item.reason && item.reason.$type === "app.bsky.feed.defs#reasonRepost");
        });

        // Group posts by day
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

        const groupedPosts = groupPostsByDay(filteredFeed);

        // Iterate over each day group
        for (const [date, posts] of Object.entries(groupedPosts)) {
            // Check if the date header already exists
            if (!document.querySelector(`.post-date-header[data-date="${date}"]`)) {
                const dateHeader = document.createElement('h2');
                dateHeader.classList.add('post-date-header');
                dateHeader.textContent = date;
                dateHeader.setAttribute('data-date', date);
                postsList.appendChild(dateHeader);
            }

            posts.forEach(item => {
                const post = item.post;
                if (post && post.record) {
                    const postContainer = document.createElement('div');
                    postContainer.classList.add('post');

                    // 1) Post Text
                    const postText = post.record.text && post.record.text.trim() !== '' ? post.record.text : null;
                    if (postText) {
                        const postTextContainer = document.createElement('div');
                        postTextContainer.classList.add('post-text-container');
                        const paragraphs = postText.split('\n\n');
                        paragraphs.forEach(paragraph => {
                            const p = document.createElement('p');
                            const formattedParagraph = paragraph.replace(/\n/g, ' ');
                            p.textContent = formattedParagraph;
                            postTextContainer.appendChild(p);
                        });
                        postContainer.appendChild(postTextContainer);
                    }

                    // 2) Image Embeds
                    if (post.embed && post.embed.$type === "app.bsky.embed.images#view" && Array.isArray(post.embed.images)) {
                        const images = post.embed.images.slice(0, 4);
                        images.forEach(imageData => {
                            if (imageData.fullsize && imageData.alt) {
                                const img = document.createElement('img');
                                img.src = imageData.fullsize;
                                img.alt = imageData.alt;
                                img.loading = 'lazy';
                                img.classList.add('post-image');
                                postContainer.appendChild(img);
                            }
                        });
                    }

                    // 3) Created At Date
                    const postDate = document.createElement('p');
                    postDate.classList.add('post-date');
                    const uri = post.uri;
                    if (uri) {
                        const postId = uri.split('/').pop();
                        const blueskyUrl = `https://bsky.app/profile/dame.bsky.social/post/${postId}`;
                        const date = new Date(post.record.createdAt || Date.now());
                        const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                        const formattedDate = date.toLocaleDateString(undefined, options);

                        const dateLink = document.createElement('a');
                        dateLink.href = blueskyUrl;
                        dateLink.textContent = formattedDate;
                        dateLink.target = '_blank';
                        dateLink.rel = 'noopener noreferrer';

                        postDate.textContent = 'Posted on ';
                        postDate.appendChild(dateLink);
                    } else {
                        const date = new Date(post.record.createdAt || Date.now());
                        const options = { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' };
                        const formattedDate = date.toLocaleDateString(undefined, options);
                        postDate.textContent = `Posted on ${formattedDate}`;
                    }
                    postContainer.appendChild(postDate);

                    // 4) Counts (Replies, Quotes, Reposts, Likes)
                    const countsContainer = document.createElement('div');
                    countsContainer.classList.add('post-counts');

                    const replyCount = document.createElement('span');
                    const replies = post.replyCount || 0;
                    replyCount.textContent = formatCount(replies, 'reply');
                    countsContainer.appendChild(replyCount);

                    const quoteCount = document.createElement('span');
                    const quotes = post.quoteCount || 0;
                    quoteCount.textContent = formatCount(quotes, 'quote');
                    countsContainer.appendChild(quoteCount);

                    const repostCount = document.createElement('span');
                    const reposts = post.repostCount || 0;
                    repostCount.textContent = formatCount(reposts, 'repost');
                    countsContainer.appendChild(repostCount);

                    const likeCount = document.createElement('span');
                    const likes = post.likeCount || 0;
                    likeCount.textContent = formatCount(likes, 'like');
                    countsContainer.appendChild(likeCount);

                    postContainer.appendChild(countsContainer);

                    // 5) Append the Post
                    postsList.appendChild(postContainer);
                }
            });
        }

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

function loadMorePosts() {
    console.log('"See More Posts" button clicked.');
    if (!currentBatchCursor) {
        console.log('No cursor available. Cannot load more posts.');
        return;
    }
    loadRecentPosts(currentBatchCursor);
}

// ----------------------------------
// 9. LOAD MARKDOWN (ABOUT, ETHOS)
// ----------------------------------
async function loadMarkdownContent() {
    try {
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

// ----------------------------------
// 10. ACTIVE NAV LINK
// ----------------------------------
function setActiveNavLink() {
    const currentPath = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('.nav-left .nav-link');
    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');
        if (linkPath === currentPath) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// ----------------------------------
// 11. LOG LOADER (LOG PAGE)
// ----------------------------------
function initializeLogLoader() {
    console.log('Initializing Log Loader');

    let currentLogCursor = null;
    const LOGS_PER_BATCH = 20;
    let isLoadingLogs = false;

    async function loadLogs(cursor = null) {
        console.log('Loading logs', cursor ? `with cursor: ${cursor}` : '');
        if (isLoadingLogs) {
            console.log('Already loading logs. Exiting.');
            return;
        }
        isLoadingLogs = true;

        const actor = 'did:plc:jucg4ddb2budmcy2pjo5fo2g'; // same actor as fetchLatestLogForNav
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

            currentLogCursor = data.cursor || null;
            console.log('Current log cursor updated to:', currentLogCursor);

            const logsList = document.getElementById('log-entries');
            const loadingIndicator = document.getElementById('loading-logs');

            // Filter out reposts
            const filteredFeed = data.feed.filter(item => {
                return !(item.reason && item.reason.$type === "app.bsky.feed.defs#reasonRepost");
            });

            // Sort by createdAt desc
            filteredFeed.sort((a, b) => new Date(b.post.record.createdAt) - new Date(a.post.record.createdAt));

            // Group by day
            const groupedPosts = groupPostsByDay(filteredFeed);

            for (const [date, posts] of Object.entries(groupedPosts)) {
                if (!document.querySelector(`.log-date-header[data-date="${date}"]`)) {
                    const dateHeader = document.createElement('h2');
                    dateHeader.classList.add('log-date-header');
                    dateHeader.textContent = date;
                    dateHeader.setAttribute('data-date', date);
                    logsList.appendChild(dateHeader);
                }

                posts.forEach(post => {
                    const logContainer = document.createElement('div');
                    logContainer.classList.add('log-entry');

                    const logText = document.createElement('p');
                    logText.classList.add('log-text');
                    logText.textContent = post.post.record.text.trim();
                    logContainer.appendChild(logText);

                    const logTimestamp = document.createElement('p');
                    logTimestamp.classList.add('log-timestamp');
                    const createdAt = new Date(post.post.record.createdAt);
                    const relativeTime = getRelativeTime(createdAt);
                    const timeString = createdAt.toLocaleTimeString(undefined, { hour12: false }) + ` on ${formatDate(createdAt)}`;
                    logTimestamp.textContent = `${relativeTime} (${timeString})`;
                    logContainer.appendChild(logTimestamp);

                    logsList.appendChild(logContainer);
                });
            }

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
            if (document.getElementById('loading-logs')) {
                document.getElementById('loading-logs').style.display = 'none';
            }
            isLoadingLogs = false;
            console.log('Finished loading logs.');
        }
    }

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

    function formatDate(date) {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = date.getFullYear();
        return `${month}-${day}-${year}`;
    }

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

    function loadMoreLogs() {
        console.log('"See More Logs" button clicked.');
        if (!currentLogCursor) {
            console.log('No cursor available. Cannot load more logs.');
            return;
        }
        loadLogs(currentLogCursor);
    }

    loadLogs();

    const seeMoreButton = document.getElementById('see-more-logs');
    if (seeMoreButton) {
        seeMoreButton.addEventListener('click', loadMoreLogs);
    } else {
        console.error('Element with ID "see-more-logs" not found.');
    }
}
