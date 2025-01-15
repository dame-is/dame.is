// scripts/main.js

const GITHUB_USERNAME = 'damedotblog'; // Your GitHub username
const GITHUB_REPO = 'dame.is'; // Your repository name
const GITHUB_BRANCH = 'main'; // Your branch name

/**
 * Constructs the Bluesky post URL from post.uri
 * @param {string} postUri - The URI of the post (e.g., "at://did:plc:.../app.bsky.feed.post/...")
 * @returns {string} - The constructed URL or '#' if invalid
 */
function constructBlueskyPostUrl(postUri) {
    if (!postUri) {
        console.warn('post.uri is undefined or null');
        return '#';
    }

    // Ensure the URI starts with 'at://'
    if (!postUri.startsWith('at://')) {
        console.warn(`post.uri does not start with 'at://': ${postUri}`);
        return '#';
    }

    // Remove the 'at://' prefix
    const cleanUri = postUri.slice(5); // Removes 'at://'

    // Split the URI by '/'
    const uriParts = cleanUri.split('/');

    // Expected structure: 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.feed.post/3lf4kwmdac22u'
    if (uriParts.length < 3) {
        console.warn(`Unexpected post.uri format: ${postUri}`);
        return '#';
    }

    const actor = uriParts[0]; // 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'
    const postId = uriParts[2]; // '3lf4kwmdac22u'

    // Validate actor and postId
    if (!actor || !postId) {
        console.warn(`Missing actor or postId in post.uri: ${postUri}`);
        return '#';
    }

    // Construct the URL
    return `https://bsky.app/profile/${actor}/post/${postId}`;
}


// ----------------------------------
// 1. CONFIGURATION: Define Birthdate
// ----------------------------------
const BIRTHDATE = new Date('1993-05-07T00:00:00Z'); // May 7, 1993

// ----------------------------------
// 2. HELPER FUNCTIONS FOR DATE CALCULATIONS
// ----------------------------------

// Function to check if a date is today
function isToday(date) {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
}

// Function to check if a date is yesterday
function isYesterday(date) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    return date.getDate() === yesterday.getDate() &&
           date.getMonth() === yesterday.getMonth() &&
           date.getFullYear() === yesterday.getFullYear();
}

// Function to format full date
function formatFullDate(date) {
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

// Function to format date header
function formatDateHeader(date) {
    let relativeDatestamp = '';
    if (isToday(date)) {
        relativeDatestamp = `Today, ${formatFullDate(date)}`;
    } else if (isYesterday(date)) {
        relativeDatestamp = `Yesterday, ${formatFullDate(date)}`;
    } else {
        relativeDatestamp = `${formatFullDate(date)}`;
    }
    return relativeDatestamp;
}

// Function to calculate Day of Life
function getDaysSinceBirthdate(date) {
    const msPerDay = 24 * 60 * 60 * 1000;
    const diffInMs = date - BIRTHDATE;
    return Math.floor(diffInMs / msPerDay);
}

// Function to calculate Day of Year
function getDayOfYear(date) {
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date - start;
    const oneDay = 1000 * 60 * 60 * 24;
    return Math.floor(diff / oneDay);
}

// Function to check if a year is a leap year
function isLeapYear(year) {
    return ((year % 4 === 0) && (year % 100 !== 0)) || (year % 400 === 0);
}

// Function to calculate Age
function getAge(date) {
    const today = new Date();
    let age = today.getFullYear() - BIRTHDATE.getFullYear();
    const m = today.getMonth() - BIRTHDATE.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < BIRTHDATE.getDate())) {
        age--;
    }
    return age;
}

// Helper function to format date in a human-readable format
function formatDateHumanReadable(date) {
    return date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

// Function to get relative time (e.g., "3 hours ago")
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
// 3. HELPER: Define initializeFooter
// ----------------------------------
function initializeFooter() {
    fetchFooterData();
}

// ----------------------------------
// 4. HELPER: Load Marked.js
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
// 5. HELPER: Load HTML Components
// ----------------------------------
function loadComponent(id, url) {
    return fetch(url)
        .then(response => response.text())
        .then(data => {
            const element = document.getElementById(id);
            if (element) {
                element.innerHTML = data;
                if (id === 'nav') {
                    initializeNav();
                }
                if (id === 'footer') {
                    initializeFooter();
                }
            } else {
                console.warn(`Element with ID "${id}" not found.`);
            }
        })
        .catch(err => console.error(`Error loading ${url}:`, err));
}

// ----------------------------------
// 6. DOMContentLoaded Event
// ----------------------------------
document.addEventListener('DOMContentLoaded', () => {
    Promise.all([
        loadComponent('nav', '/components/nav.html'),
        loadComponent('footer', '/components/footer.html')
    ]).then(() => {
        // Initialize page-specific features based on the current URL
        const path = window.location.pathname;
        const pathParts = path.split('/').filter(part => part !== '');
        
        // Determine the current page key based on the URL
        let pageKey = '';
        
        if (path === '/' || path === '/index.html') {
            // For home page, map to 'index' to match last-updated.json
            pageKey = 'index';
        } else if (path.startsWith('/blog/')) {
            // For dynamic blog post pages like /blog/my-post-slug
            const slug = pathParts[1];
            pageKey = `blog/${slug}`;
        } else if (path === '/blog') {
            // For the main blog feed page
            pageKey = 'blog';
        } else {
            // For other static pages like /about, /ethos, etc.
            // Extract the page name without extension
            const lastSegment = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';
            pageKey = lastSegment.split('.')[0];
        }
        
        // Initialize page-specific features based on the determined pageKey
        switch (pageKey) {
            case 'index':
                initializePostLoader();
                break;
            case 'log':
                initializeLogLoader();
                break;
            case 'about':
                loadMarkdownContent();
                break;
            case 'ethos':
                loadMarkdownContent();
                break;
            case 'skeet-tools':
                loadMarkdownContent();
                break;
            case 'blog':
                initializeBlogFeed();
                break;
            default:
                if (path.startsWith('/blog/') && pathParts.length > 1) {
                    const slug = pathParts[1];
                    initializeBlogPost(slug);
                }
                // Optionally, handle 404 pages or other dynamic routes here
                break;
        }
    }).catch(error => {
        console.error('Error loading components:', error);
    });
});



// ----------------------------------
// 7. NAV INITIALIZATION
// ----------------------------------
function initializeNav() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        // Set initial theme based on localStorage
        if (localStorage.getItem('theme') === 'dark') {
            document.body.classList.add('dark-mode');
        }
        updateThemeIcon();

        themeToggle.addEventListener('click', toggleTheme);

        // Fetch Bluesky stats
        fetchBlueskyStats();

        // Assign active class to current page link
        setActiveNavLink();

        // Fetch and display the most recent log in the navigation
        fetchLatestLogForNav();
    } else {
        console.warn('Theme toggle element not found.');
    }
}

// ----------------------------------
// 8. THEME TOGGLE
// ----------------------------------
function toggleTheme() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) {
        console.error('Theme toggle element not found.');
        return;
    }

    document.body.classList.toggle('dark-mode');
    if (document.body.classList.contains('dark-mode')) {
        localStorage.setItem('theme', 'dark');
    } else {
        localStorage.setItem('theme', 'light');
    }
    updateThemeIcon();
}

function updateThemeIcon() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    const icon = themeToggle.querySelector('i');
    if (document.body.classList.contains('dark-mode')) {
        icon.classList.remove('fa-moon');
        icon.classList.add('fa-sun');
        themeToggle.setAttribute('aria-label', 'Switch to light mode');
    } else {
        icon.classList.remove('fa-sun');
        icon.classList.add('fa-moon');
        themeToggle.setAttribute('aria-label', 'Switch to dark mode');
    }
}

async function fetchBlueskyStats() {
    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Your actual actor identifier for stats
    const profileApiUrl = `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(actor)}`;
    const feedApiUrlBase = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed`;
  
    // Set separate animation durations (in milliseconds) for profile vs. paginated data
    const animationDurationProfile = 2200; // followers & following
    const animationDurationFeed = 1500;   // posts & replies
  
    // Set up stat container elements (initially showing 0)
    const statsContainer = document.getElementById('bluesky-stats');
    if (statsContainer) {
      statsContainer.innerHTML = `
        <span class="stat">
            <span class="count" id="followers">0</span>
            <span class="label">followers</span>
        </span>
        <span class="stat">
            <span class="count" id="following">0</span>
            <span class="label">following</span>
        </span>
        <span class="stat">
            <span class="count" id="posts">0</span>
            <span class="label">posts</span>
        </span>
        <span class="stat">
            <span class="count" id="replies">0</span>
            <span class="label">replies</span>
        </span>
      `;
    } else {
      console.warn('Element with ID "bluesky-stats" not found.');
      return;
    }
  
    // Get references to the count elements
    const followersElem = document.getElementById('followers');
    const followingElem = document.getElementById('following');
    const postsElem = document.getElementById('posts');
    const repliesElem = document.getElementById('replies');
  
    /**
     * Animate a number change from a starting value to an ending value.
     * @param {HTMLElement} element The element whose textContent will be updated.
     * @param {number} from The starting value.
     * @param {number} to The final value.
     * @param {number} duration Animation duration in milliseconds.
     */
    function animateStat(element, from, to, duration) {
      const startTime = performance.now();
      function updateValue(now) {
        const elapsed = now - startTime;
        const progress = Math.min(elapsed / duration, 1);
        // Using an easing function (ease-out)
        const easedProgress = 1 - Math.pow(1 - progress, 3);
        const currentValue = Math.floor(from + easedProgress * (to - from));
        element.textContent = currentValue;
        if (progress < 1) {
          requestAnimationFrame(updateValue);
        }
      }
      requestAnimationFrame(updateValue);
    }
  
    // These will be our cumulative counts
    let followersCount = 0;
    let followingCount = 0;
    let postsCount = 0;
    let repliesCount = 0;
  
    try {
      // --- STEP 1: Fetch Profile Data ---
      const profileResponse = await fetch(profileApiUrl);
      if (!profileResponse.ok) throw new Error(`Profile API error: ${profileResponse.status}`);
      const profileData = await profileResponse.json();
      if (profileData) {
        const newFollowers = profileData.followersCount || 0;
        const newFollowing = profileData.followsCount || 0;
        // Animate profile stats using the separate duration
        animateStat(followersElem, followersCount, newFollowers, animationDurationProfile);
        animateStat(followingElem, followingCount, newFollowing, animationDurationProfile);
        followersCount = newFollowers;
        followingCount = newFollowing;
      }
  
        // --- STEP 2: Fetch Posts and Replies (Paginated) ---
        const limit = 100; // Maximum allowed per request
        let cursor = null;
        let hasMore = true;

        // These will be our cumulative counts
        let postsCount = 0;
        let repliesCount = 0;

        while (hasMore) {
        // Use the filter "posts_with_replies" so that replies are included
        let feedApiUrl = `${feedApiUrlBase}?actor=${encodeURIComponent(actor)}&limit=${limit}&filter=posts_with_replies`;
        if (cursor) {
            feedApiUrl += `&cursor=${encodeURIComponent(cursor)}`;
        }
        const feedResponse = await fetch(feedApiUrl);
        if (!feedResponse.ok) throw new Error(`Feed API error: ${feedResponse.status}`);
        const feedData = await feedResponse.json();

        // Store the current counts so we can animate from their previous values
        const currentPosts = postsCount;
        const currentReplies = repliesCount;

        if (feedData && Array.isArray(feedData.feed)) {
            feedData.feed.forEach(item => {
            if (item.post && item.post.record) {
                // If the post is a reply we run our filtering logic.
                // Otherwise, we count it as a post.
                if (item.post.record.reply) {
                let validReply = false;
                // Check that envelope reply metadata is provided.
                if (item.reply) {
                    // Check parent's author DID
                    if (item.reply.parent && item.reply.parent.author && item.reply.parent.author.did === actor) {
                    // Check root's author DID
                    if (item.reply.root && item.reply.root.author && item.reply.root.author.did === actor) {
                        // Additionally, if a grandparent is provided, it must also have your DID.
                        if (item.reply.grandparentAuthor) {
                        if (item.reply.grandparentAuthor.author && item.reply.grandparentAuthor.author.did === actor) {
                            validReply = true;
                        }
                        } else {
                        validReply = true;
                        }
                    }
                    }
                }
                // If the reply meets the "to me" criteria, count it as a post.
                if (validReply) {
                    postsCount += 1;
                } else {
                    // Otherwise, count it as a reply.
                    repliesCount += 1;
                }
                } else {
                // Not a reply: count as a post.
                postsCount += 1;
                }
            }
            });
        }

        // Animate the updated stats using the feed stats animation duration.
        if (postsElem) {
            animateStat(postsElem, currentPosts, postsCount, animationDurationFeed);
        }
        if (repliesElem) {
            animateStat(repliesElem, currentReplies, repliesCount, animationDurationFeed);
        }

        // Pagination handling
        if (feedData.cursor) {
            cursor = feedData.cursor;
        } else {
            hasMore = false;
        }
  
        // Optional: Limit number of iterations to avoid excessive API calls.
        // if (postsCount + repliesCount >= 1000) {
        //   hasMore = false;
        // }
      }
    } catch (error) {
      console.error('Error fetching Bluesky stats:', error);
      // Optionally show error values or reset counts
      if (followersElem) followersElem.textContent = 0;
      if (followingElem) followingElem.textContent = 0;
      if (postsElem) postsElem.textContent = 0;
      if (repliesElem) repliesElem.textContent = 0;
    }
  }
  


// ----------------------------------
// 10. FETCH LATEST LOG FOR NAV
// ----------------------------------
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
                const recentLogTextElement = document.getElementById('recent-log-text');
                if (recentLogTextElement) {
                    recentLogTextElement.textContent = text || 'No recent log';
                } else {
                    console.warn('Element with ID "recent-log-text" not found.');
                }

                // Update Time
                const createdAt = new Date(mostRecent.record.createdAt);
                const relativeTime = getRelativeTime(createdAt);
                const recentLogTimeElement = document.getElementById('recent-log-time');
                if (recentLogTimeElement) {
                    recentLogTimeElement.textContent = relativeTime;
                } else {
                    console.warn('Element with ID "recent-log-time" not found.');
                }
            }
        } else {
            // If no logs found, set fallback text
            const recentLogTextElement = document.getElementById('recent-log-text');
            const recentLogTimeElement = document.getElementById('recent-log-time');
            if (recentLogTextElement) {
                recentLogTextElement.textContent = 'No recent log';
            }
            if (recentLogTimeElement) {
                recentLogTimeElement.textContent = '';
            }
        }
    } catch (error) {
        console.error('Error fetching the latest log for nav:', error);
    }
}

// ----------------------------------
// 11. FOOTER
// ----------------------------------
async function fetchFooterData() {
    const apiUrlTags = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/tags`;
    const apiUrlCommits = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
    const apiUrlLastUpdated = '/last-updated.json'; // Absolute path

    try {
        // Fetch the latest tag
        console.log('Fetching GitHub tags...');
        const responseTags = await fetch(apiUrlTags);
        if (!responseTags.ok) throw new Error(`GitHub Tags API error: ${responseTags.status}`);
        const tagsData = await responseTags.json();
        console.log('Fetched tags:', tagsData);

        let version = 'No Tags';
        let lastUpdated = 'N/A';

        if (tagsData.length > 0) {
            // Use the first (most recent) tag
            version = tagsData[0].name;
            const commitSha = tagsData[0].commit.sha;
            const apiUrlTagCommit = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/commits/${commitSha}`;
            console.log(`Fetching commit data for tag SHA: ${commitSha}`);
            const responseTagCommit = await fetch(apiUrlTagCommit);
            if (responseTagCommit.ok) {
                const tagCommitData = await responseTagCommit.json();
                const commitDate = new Date(tagCommitData.commit.committer.date);
                lastUpdated = commitDate.toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                });
                console.log(`Tag commit date: ${lastUpdated}`);
            }
        } else {
            // If no tags exist, fallback to the latest commit
            console.log('No tags found. Fetching latest commit...');
            const responseCommits = await fetch(apiUrlCommits);
            if (!responseCommits.ok) throw new Error(`GitHub Commits API error: ${responseCommits.status}`);
            const commitsData = await responseCommits.json();
            const latestCommit = commitsData;
            version = latestCommit.sha.substring(0, 7); // Short SHA
            const commitDate = new Date(latestCommit.commit.committer.date);
            lastUpdated = commitDate.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
            console.log(`Latest commit date: ${lastUpdated}`);
        }

        // Fetch last-updated.json with cache busting
        const timestamp = new Date().getTime();
        console.log('Fetching last-updated.json with cache busting:', `${apiUrlLastUpdated}?v=${timestamp}`);
        const responseLastUpdated = await fetch(`${apiUrlLastUpdated}?v=${timestamp}`);
        if (!responseLastUpdated.ok) throw new Error(`Failed to fetch last-updated.json: ${responseLastUpdated.status}`);
        const lastUpdatedData = await responseLastUpdated.json();
        console.log('Fetched last-updated.json:', lastUpdatedData);

        // Determine the current page key based on the URL
        let path = window.location.pathname;

        // Remove trailing slash if present and path is not '/'
        if (path.endsWith('/') && path !== '/') {
            path = path.slice(0, -1);
        }

        let pageKey = '';

        if (path.startsWith('/blog/')) {
            // For blog post pages
            const slug = path.split('/')[2];
            pageKey = `blog/${slug}`;
        } else if (path === '/blog') {
            // For the main blog feed page
            pageKey = 'blog';
        } else if (path === '/' || path === '/index.html') {
            // For home page, map to 'index' to match last-updated.json
            pageKey = 'index';
        } else {
            // For other pages like /about, /ethos, etc.
            pageKey = path.substring(path.lastIndexOf('/') + 1).split('.')[0];
        }

        console.log(`Current path: ${path}`);
        console.log(`Determined pageKey: ${pageKey}`);

        // Get the last updated date for the current page from last-updated.json
        const pageLastUpdatedISO = lastUpdatedData[pageKey];
        console.log(`Fetched last updated ISO for "${pageKey}": ${pageLastUpdatedISO}`);
        let pageLastUpdated = 'N/A';
        if (pageLastUpdatedISO && pageLastUpdatedISO !== 'null') {
            const date = new Date(pageLastUpdatedISO);
            pageLastUpdated = formatDateHumanReadable(date);
            console.log(`Formatted Last Updated Date: ${pageLastUpdated}`);
        } else {
            console.log(`No valid last updated date found for "${pageKey}".`);
        }

        // Update the footer elements
        const versionElement = document.getElementById('version');
        const lastUpdatedElement = document.getElementById('last-updated');

        if (versionElement) {
            versionElement.textContent = version;
            console.log(`Updated version element: ${version}`);
        } else {
            console.warn('Element with ID "version" not found in footer.');
        }

        if (lastUpdatedElement) {
            lastUpdatedElement.textContent = pageLastUpdated;
            console.log(`Updated last-updated element: ${pageLastUpdated}`);
        } else {
            console.warn('Element with ID "last-updated" not found in footer.');
        }
    } catch (error) {
        console.error('Error fetching footer data:', error);
        const versionElement = document.getElementById('version');
        const lastUpdatedElement = document.getElementById('last-updated');

        if (versionElement) {
            versionElement.textContent = 'N/A';
        }

        if (lastUpdatedElement) {
            lastUpdatedElement.textContent = 'N/A';
        }
    }
}

// ----------------------------------
// GLOBALS
// ----------------------------------
let currentBatchCursor = null; // For API pagination (if needed)
const POSTS_PER_BATCH = 100;      // API request size (we still use this for each call)
let isLoadingPosts = false;      // Flag to avoid concurrent fetching

// Global variable that determines how many days to load.
// Initially, load posts from the past 4 complete days.
let currentDaysCount = 4;

// ----------------------------------
// 12. POST LOADER (INDEX PAGE) - UPDATED
// ----------------------------------
function initializePostLoader() {
    console.log('Initializing Post Loader with Day-Based Batches');
    // Initial load (using currentDaysCount to define the interval)
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

/**
 * Creates a mapping of character indices to cumulative byte counts.
 * @param {string} str - The input string.
 * @returns {Array} - An array where index i represents the cumulative bytes up to character i.
 */
function createByteMap(str) {
    const encoder = new TextEncoder();
    const byteMap = [0];
    for (let i = 0; i < str.length; i++) {
        const codePoint = str.codePointAt(i);
        const codePointLength = codePoint > 0xFFFF ? 2 : 1; // Handle surrogate pairs
        const substring = str.substring(i, i + codePointLength);
        const encoded = encoder.encode(substring);
        byteMap.push(byteMap[byteMap.length - 1] + encoded.length);
        if (codePointLength === 2) {
            i++; // Skip the next code unit as it's part of a surrogate pair
        }
    }
    return byteMap;
}

/**
 * Converts a byte index to a character index using the byteMap.
 * @param {Array} byteMap - The cumulative byte count array.
 * @param {number} byteIndex - The byte index.
 * @returns {number} - The corresponding character index.
 */
function byteToCharIndex(byteMap, byteIndex) {
    for (let i = 0; i < byteMap.length; i++) {
        if (byteMap[i] > byteIndex) {
            return i - 1;
        }
    }
    return byteMap.length - 1;
}

/**
 * Appends text to a DocumentFragment, converting \n to <br> elements.
 * @param {DocumentFragment} fragment - The fragment to append to.
 * @param {string} text - The text containing \n for line breaks.
 */
function appendTextWithLineBreaks(fragment, text) {
    const lines = text.split('\n');
    lines.forEach((line, index) => {
        if (line) {
            fragment.appendChild(document.createTextNode(line));
        }
        if (index < lines.length - 1) {
            fragment.appendChild(document.createElement('br'));
        }
    });
}

/**
 * Parses the entire text with facets, replacing link facets with clickable links.
 * Also preserves line breaks by converting \n to <br>.
 * @param {string} text - The original post text.
 * @param {Array} facets - The facets associated with the post.
 * @returns {DocumentFragment} - The parsed text with clickable links and preserved line breaks.
 */
function parseTextWithFacets(text, facets) {
    if (!facets || facets.length === 0) {
        const fragment = document.createDocumentFragment();
        appendTextWithLineBreaks(fragment, text);
        return fragment;
    }

    const fragment = document.createDocumentFragment();
    const byteMap = createByteMap(text);
    let lastCharIndex = 0;

    // Sort facets by byteStart to process them in order
    const sortedFacets = facets.slice().sort((a, b) => a.index.byteStart - b.index.byteStart);

    sortedFacets.forEach(facet => {
        if (facet.features) {
            facet.features.forEach(feature => {
                if (feature['$type'] === 'app.bsky.richtext.facet#link') {
                    const uri = feature.uri;
                    const startByte = facet.index.byteStart;
                    const endByte = facet.index.byteEnd;

                    // Convert byte indices to character indices
                    const startChar = byteToCharIndex(byteMap, startByte);
                    const endChar = byteToCharIndex(byteMap, endByte);

                    console.log(`Replacing text from char ${startChar} to ${endChar} with URI: ${uri}`);

                    // Append text before the link with preserved line breaks
                    const beforeText = text.slice(lastCharIndex, startChar);
                    if (beforeText) {
                        appendTextWithLineBreaks(fragment, beforeText);
                    }

                    // Append the full clickable link
                    const a = document.createElement('a');
                    a.href = uri;
                    a.textContent = uri; // Display the full URI as the link text
                    a.target = '_blank'; // Open in a new tab
                    a.rel = 'noopener noreferrer'; // Security best practices
                    fragment.appendChild(a);

                    // Update the lastCharIndex to the end of the replaced link
                    lastCharIndex = endChar;
                }
            });
        }
    });

    // Append any remaining text after the last link with preserved line breaks
    const remainingText = text.slice(lastCharIndex);
    if (remainingText) {
        appendTextWithLineBreaks(fragment, remainingText);
    }

    return fragment;
}

/**
 * loadRecentPosts() – Day-Based Version
 *
 * This version always loads posts that were created after our lower bound timestamp,
 * where the lower bound is computed as: now - (currentDaysCount * 24 hrs).
 *
 * We fetch batches from the API until we encounter a post older than our cutoff.
 */
async function loadRecentPosts(cursor = null) {
    console.log('Loading recent posts', cursor ? `with cursor: ${cursor}` : '');
    if (isLoadingPosts) {
        console.log('Already loading posts. Exiting.');
        return;
    }
    isLoadingPosts = true;

    // Compute the lower bound timestamp.
    const nowTime = Date.now();
    const lowerBoundTime = nowTime - (currentDaysCount * 24 * 60 * 60 * 1000);
    console.log(`Loading posts from ${new Date(nowTime).toLocaleString()} until ${new Date(lowerBoundTime).toLocaleString()}`);

    // Helper to format a relative timestamp (unchanged).
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
                return count === 1
                    ? `1 ${interval.label} ago`
                    : `${count} ${interval.label}s ago`;
            }
        }
        return 'just now';
    }

    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Your DID
    const postsList = document.getElementById('recent-posts');
    if (!postsList) {
        console.error('Element with ID "recent-posts" not found.');
        isLoadingPosts = false;
        return;
    }

    // Arrays to accumulate posts
    let allFetchedPosts = []; // All posts fetched from the API (fallback)
    let dayPosts = [];        // Posts that are within our desired day interval (i.e. newer than lowerBoundTime)

    let localCursor = cursor; // For API pagination
    let keepFetching = true;

    // Fetch posts until we either run out of new pages or we encounter a post older than our lower bound.
    while (keepFetching) {
        // We remove any filter so that replies are included (your reply filtering logic remains here if needed).
        let apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=${POSTS_PER_BATCH}`;
        if (localCursor) {
            apiUrl += `&cursor=${encodeURIComponent(localCursor)}`;
        }
        console.log(`Fetching posts from API: ${apiUrl}`);
        const response = await fetch(apiUrl);
        if (!response.ok) {
            console.error(`Network response was not ok: ${response.status}`);
            break;
        }
        const data = await response.json();
        // Update the local cursor for the next batch.
        localCursor = data.cursor || null;
        currentBatchCursor = localCursor;
        console.log('Current batch cursor updated to:', currentBatchCursor);

        // Remove reposts.
        const filteredBatch = data.feed.filter(item => {
            return !(item.reason && item.reason.$type === "app.bsky.feed.defs#reasonRepost");
        });

        // Apply the reply filter (unchanged from your version).
        const finalBatch = filteredBatch.filter(item => {
            const post = item.post;
            if (post && post.record) {
                if (post.record.reply) {
                    if (!item.reply) return false;
                    if (item.reply.parent && item.reply.parent.author) {
                        if (item.reply.parent.author.did !== actor) return false;
                    } else return false;
                    if (item.reply.root && item.reply.root.author) {
                        if (item.reply.root.author.did !== actor) return false;
                    } else return false;
                    if (item.reply.grandparentAuthor) {
                        if (item.reply.grandparentAuthor.author) {
                            if (item.reply.grandparentAuthor.author.did !== actor) return false;
                        } else return false;
                    }
                }
                return true;
            }
            return false;
        });

        // Append this batch to our overall fetched posts.
        allFetchedPosts.push(...finalBatch);

        // For each item, check its createdAt; if it is newer than our lowerBoundTime, add it.
        for (let item of finalBatch) {
            const post = item.post;
            if (post && post.record) {
                const postTime = new Date(post.record.createdAt).getTime();
                if (postTime >= lowerBoundTime) {
                    dayPosts.push(item);
                } else {
                    // Once we encounter a post older than our cutoff, we stop fetching further.
                    keepFetching = false;
                    break;
                }
            }
        }

        // Also stop if there is no further batch available.
        if (!localCursor) {
            keepFetching = false;
        }
    }

    console.log(`Fetched a total of ${allFetchedPosts.length} posts; ${dayPosts.length} posts within the current ${currentDaysCount} days`);

    // We display all posts that are within the day interval.
    let postsToDisplay = dayPosts;
    // (If no posts are found in the interval, you might decide to display the fallback allFetchedPosts, but here we assume we show an empty state.)

    // Group posts by day using your grouping function.
    function groupPostsByDay(posts) {
        const groups = {};
        posts.forEach(item => {
            const postDate = new Date(item.post.record.createdAt);
            const relativeDatestamp = formatDateHeader(postDate);
            const dayOfLife = getDaysSinceBirthdate(postDate);
            const dayOfYear = getDayOfYear(postDate);
            const totalDaysInYear = isLeapYear(postDate.getFullYear()) ? 366 : 365;
            const age = getAge(postDate);

            if (!groups[relativeDatestamp]) {
                groups[relativeDatestamp] = {
                    dayOfLife: dayOfLife,
                    dayOfYear: dayOfYear,
                    totalDaysInYear: totalDaysInYear,
                    age: age,
                    posts: []
                };
            }
            groups[relativeDatestamp].posts.push(item);
        });
        return groups;
    }
    const groupedPosts = groupPostsByDay(postsToDisplay);

    // Render the posts (your rendering logic remains mostly unchanged).
    for (const [headerDateText, groupData] of Object.entries(groupedPosts)) {
        // If the header for this day hasn't been rendered already, create it.
        if (!document.querySelector(`.post-date-header[data-date="${headerDateText}"]`)) {
            const dateHeader = document.createElement('div');
            dateHeader.classList.add('post-date-header');
            dateHeader.setAttribute('data-date', headerDateText);

            const headerLeft = document.createElement('div');
            headerLeft.classList.add('header-left');
            const firstLine = document.createElement('div');
            firstLine.classList.add('date-header-line1');
            firstLine.textContent = headerDateText;
            headerLeft.appendChild(firstLine);

            const secondLine = document.createElement('div');
            secondLine.classList.add('date-header-line2');
            secondLine.textContent = `Day ${groupData.dayOfLife} / ${groupData.dayOfYear} of ${groupData.totalDaysInYear} / Year ${groupData.age}`;
            headerLeft.appendChild(secondLine);

            const headerRight = document.createElement('div');
            headerRight.classList.add('header-right');

            let totalReplies = 0,
                totalQuotes  = 0,
                totalReposts = 0,
                totalLikes   = 0;
            groupData.posts.forEach(item => {
                const post = item.post;
                if (post && post.record) {
                    totalReplies += post.replyCount || 0;
                    totalQuotes  += post.quoteCount || 0;
                    totalReposts += post.repostCount || 0;
                    totalLikes   += post.likeCount || 0;
                }
            });

            function createCount(iconClass, count, label) {
                const countSpan = document.createElement('span');
                countSpan.classList.add('count-item');
                countSpan.setAttribute('aria-label', `${count} ${label}`);
                if (count > 0) {
                    countSpan.classList.add('active');
                }
                const icon = document.createElement('i');
                icon.className = iconClass;
                icon.setAttribute('aria-hidden', 'true');
                const countText = document.createElement('span');
                countText.classList.add('count-text');
                countText.textContent = count;
                countSpan.appendChild(icon);
                countSpan.appendChild(countText);
                return countSpan;
            }
            const replyCountHeader = createCount('fas fa-reply', totalReplies, 'replies');
            const quoteCountHeader = createCount('fas fa-quote-right', totalQuotes, 'quotes');
            const repostCountHeader = createCount('fas fa-retweet', totalReposts, 'reposts');
            const likeCountHeader = createCount('fas fa-heart', totalLikes, 'likes');
            headerRight.appendChild(replyCountHeader);
            headerRight.appendChild(quoteCountHeader);
            headerRight.appendChild(repostCountHeader);
            headerRight.appendChild(likeCountHeader);

            dateHeader.appendChild(headerLeft);
            dateHeader.appendChild(headerRight);
            postsList.appendChild(dateHeader);
        }

        // Render the individual posts for this day group.
        groupData.posts.forEach(item => {
            const post = item.post;
            if (post && post.record) {
                const postContainer = document.createElement('div');
                postContainer.classList.add('post');

                // Post Text with clickable links
                const postText = post.record.text && post.record.text.trim() !== '' ? post.record.text : null;
                const postFacets = post.record.facets || [];
                if (postText) {
                    const postTextContainer = document.createElement('div');
                    postTextContainer.classList.add('post-text-container');
                    const processedText = postText;
                    const parsedText = parseTextWithFacets(processedText, postFacets);
                    postTextContainer.appendChild(parsedText);
                    postContainer.appendChild(postTextContainer);
                }

                // External embed (linkCard)
                if (post.embed &&
                    post.embed.$type === "app.bsky.embed.external#view" &&
                    post.embed.external &&
                    post.embed.external.uri) {

                    const linkCard = document.createElement('div');
                    linkCard.classList.add('linkCard');
                    linkCard.style.cursor = 'pointer';
                    linkCard.addEventListener('click', () => {
                        window.open(post.embed.external.uri, '_blank', 'noopener');
                    });
                    if (post.embed.external.thumb) {
                        const thumb = document.createElement('img');
                        thumb.classList.add('linkCard-thumb');
                        thumb.src = post.embed.external.thumb;
                        thumb.alt = post.embed.external.title || 'Link thumbnail';
                        linkCard.appendChild(thumb);
                    }
                    const linkInfo = document.createElement('div');
                    linkInfo.classList.add('linkCard-info');
                    if (post.embed.external.title) {
                        const titleElem = document.createElement('div');
                        titleElem.classList.add('linkCard-title');
                        titleElem.textContent = post.embed.external.title;
                        linkInfo.appendChild(titleElem);
                    }
                    if (post.embed.external.description) {
                        const descElem = document.createElement('div');
                        descElem.classList.add('linkCard-description');
                        descElem.textContent = post.embed.external.description;
                        linkInfo.appendChild(descElem);
                    }
                    let urlPreviewText = post.embed.external.uri;
                    try {
                        const urlObj = new URL(post.embed.external.uri);
                        urlPreviewText = `${urlObj.hostname}${urlObj.pathname}`;
                    } catch (e) {
                        console.error('Invalid URL for embed.external.uri', post.embed.external.uri);
                    }
                    const maxChars = 40;
                    if (urlPreviewText.length > maxChars) {
                        urlPreviewText = urlPreviewText.substring(0, maxChars) + '…';
                    }
                    const previewElem = document.createElement('div');
                    previewElem.classList.add('linkCard-preview');
                    previewElem.textContent = urlPreviewText;
                    linkInfo.appendChild(previewElem);
                    linkCard.appendChild(linkInfo);
                    postContainer.appendChild(linkCard);
                }

                // Image embeds
                if (post.embed && post.embed.$type === "app.bsky.embed.images#view" && Array.isArray(post.embed.images)) {
                    const images = post.embed.images.slice(0, 4);
                    images.forEach(imageData => {
                        if (imageData.fullsize) {
                            const img = document.createElement('img');
                            img.src = imageData.fullsize;
                            img.alt = imageData.alt || 'Image';
                            img.loading = 'lazy';
                            img.classList.add('post-image');
                            postContainer.appendChild(img);
                        }
                    });
                }

                // Embedded quotes
                if (post.embed && post.embed.$type === "app.bsky.embed.record#view" && post.embed.record) {
                    const embeddedRecord = post.embed.record;
                    if (embeddedRecord.$type === "app.bsky.embed.record#viewRecord" && embeddedRecord.value) {
                        const embeddedText = embeddedRecord.value.text || '';
                        const embeddedAuthorHandle = embeddedRecord.author && embeddedRecord.author.handle ? embeddedRecord.author.handle : 'Unknown';
                        const quoteContainer = document.createElement('blockquote');
                        quoteContainer.classList.add('embedded-quote');
                        const quoteText = document.createElement('p');
                        quoteText.textContent = embeddedText;
                        quoteContainer.appendChild(quoteText);
                        const quoteAuthor = document.createElement('cite');
                        quoteAuthor.textContent = `— @${embeddedAuthorHandle}`;
                        quoteContainer.appendChild(quoteAuthor);
                        postContainer.appendChild(quoteContainer);
                    }
                }

                // Post date with clickable relative timestamp
                const postDateElem = document.createElement('p');
                postDateElem.classList.add('post-date');
                const postUrl = constructBlueskyPostUrl(post.uri);
                const createdAt = new Date(post.record.createdAt || Date.now());
                const relativeTime = getRelativeTime(createdAt);
                const postLink = document.createElement('a');
                postLink.href = postUrl;
                postLink.textContent = relativeTime;
                postLink.target = '_blank';
                postLink.rel = 'noopener noreferrer';
                const postedText = document.createTextNode('Posted ');
                postDateElem.appendChild(postedText);
                postDateElem.appendChild(postLink);
                postContainer.appendChild(postDateElem);

                // Post counts
                const countsContainer = document.createElement('div');
                countsContainer.classList.add('post-counts');
                function createCount(iconClass, count, label) {
                    const countSpan = document.createElement('span');
                    countSpan.classList.add('count-item');
                    countSpan.setAttribute('aria-label', `${count} ${label}`);
                    if (count > 0) {
                        countSpan.classList.add('active');
                    }
                    const icon = document.createElement('i');
                    icon.className = iconClass;
                    icon.setAttribute('aria-hidden', 'true');
                    const countText = document.createElement('span');
                    countText.classList.add('count-text');
                    countText.textContent = count;
                    countSpan.appendChild(icon);
                    countSpan.appendChild(countText);
                    return countSpan;
                }
                const replies = post.replyCount || 0;
                countsContainer.appendChild(createCount('fas fa-reply', replies, 'replies'));
                const quotes = post.quoteCount || 0;
                countsContainer.appendChild(createCount('fas fa-quote-right', quotes, 'quotes'));
                const reposts = post.repostCount || 0;
                countsContainer.appendChild(createCount('fas fa-retweet', reposts, 'reposts'));
                const likes = post.likeCount || 0;
                countsContainer.appendChild(createCount('fas fa-heart', likes, 'likes'));
                postContainer.appendChild(countsContainer);

                postsList.appendChild(postContainer);
            }
        });
    }

    // Process outbound links after all posts are loaded
    processOutboundLinks();

    if (!currentBatchCursor) {
        const seeMoreButton = document.getElementById('see-more-posts');
        if (seeMoreButton) {
            seeMoreButton.style.display = 'none';
            console.log('No more posts to load. "See More Posts" button hidden.');
        }
    }
    isLoadingPosts = false;
    console.log('Finished loading posts.');
}

// Function to load more posts when "See More Posts" button is clicked.
// This version shifts our day interval by 4 days.
function loadMorePosts() {
    console.log('"See More Posts" button clicked.');
    // Increase the day interval by 4 days
    currentDaysCount += 4;
    // Reset the pagination cursor so that we start from the top of the feed for the new interval.
    currentBatchCursor = null;
    loadRecentPosts(null);
}



// ----------------------------------
// 13. LOAD MARKDOWN (DYNAMICALLY HANDLING ANY PAGE)
// ----------------------------------
async function loadMarkdownContent() {
    try {
        await markedLoadPromise;

        // Get the current pathname and extract the last segment
        const pathname = window.location.pathname;
        const pageName = pathname.substring(pathname.lastIndexOf('/') + 1) || 'index'; // Default to 'index' if pathname ends with '/'

        // Remove the file extension if present (e.g., 'about.html' -> 'about')
        const baseName = pageName.includes('.') ? pageName.substring(0, pageName.lastIndexOf('.')) : pageName;

        // Construct the markdown file path
        const markdownFile = `${baseName}.md`;

        // Fetch the markdown file
        const response = await fetch(markdownFile);
        if (!response.ok) throw new Error(`Failed to load ${markdownFile}: ${response.statusText}`);

        // Parse and insert the markdown content
        const markdown = await response.text();
        const htmlContent = marked.parse(markdown);
        const contentElementId = `${baseName}-content`;
        const contentElement = document.getElementById(contentElementId);

        if (contentElement) {
            contentElement.innerHTML = htmlContent;
        } else {
            console.error(`Element with ID "${contentElementId}" not found.`);
        }
    } catch (error) {
        console.error('Error loading Markdown content:', error);
    }
}


// ----------------------------------
// 14. ACTIVE NAV LINK
// ----------------------------------
function setActiveNavLink() {
    const currentPath = window.location.pathname;
    let pageKey = '';

    // Remove trailing slash if present
    let path = currentPath;
    if (path.endsWith('/')) {
        path = path.slice(0, -1);
    }

    // Extract the last part of the path
    pageKey = path.substring(path.lastIndexOf('/') + 1);

    // If path is empty, assume 'home'
    if (pageKey === '') {
        pageKey = 'home';
    }

    const navLinks = document.querySelectorAll('.nav-left .nav-link');
    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');

        // Compare linkPath with pageKey
        if (linkPath === `/${pageKey}` || (pageKey === 'home' && linkPath === '/')) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// ----------------------------------
// 15. LOG LOADER (LOG PAGE) - UPDATED
// ----------------------------------
function initializeLogLoader() {
    console.log('Initializing Log Loader');

    let currentLogCursor = null;
    const LOGS_PER_BATCH = 50;
    let isLoadingLogs = false;

    // Helper Function: Format Log Date
    function formatLogDate(date) {
        const now = new Date();
        const diffInMs = now - date;
        const diffInHours = diffInMs / (1000 * 60 * 60);
        const dayOfLife = getDaysSinceBirthdate(date);

        if (diffInHours < 24) {
            const relativeTime = getRelativeTime(date);
            return `Posted ${relativeTime}`;
        } else {
            const formattedTime = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: 'numeric' });
            return `Posted at ${formattedTime}`;
        }
    }

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

        // Declare loadingIndicator at the top to ensure it's accessible in both try and finally
        const loadingIndicator = document.getElementById('loading-logs');
        const logsList = document.getElementById('log-entries');

        try {
            console.log(`Fetching logs from API: ${apiUrl}`);
            
            // Show loading indicator if available
            if (loadingIndicator) {
                loadingIndicator.style.display = 'block';
            }

            const response = await fetch(apiUrl);
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.status}`);
            }
            const data = await response.json();
            console.log('Logs fetched successfully:', data);

            currentLogCursor = data.cursor || null;
            console.log('Current log cursor updated to:', currentLogCursor);

            // Filter out reposts
            const filteredFeed = data.feed.filter(item => {
                return !(item.reason && item.reason.$type === "app.bsky.feed.defs#reasonRepost");
            });

            // Sort by createdAt desc
            filteredFeed.sort((a, b) => new Date(b.post.record.createdAt) - new Date(a.post.record.createdAt));

            // Group logs by day with additional data
            function groupLogsByDay(logs) {
                const groups = {};
                logs.forEach(item => {
                    const logDate = new Date(item.post.record.createdAt);
                    const relativeDatestamp = formatDateHeader(logDate);
                    const dayOfLife = getDaysSinceBirthdate(logDate);
                    const dayOfYear = getDayOfYear(logDate);
                    const totalDaysInYear = isLeapYear(logDate.getFullYear()) ? 366 : 365;
                    const age = getAge(logDate);

                    if (!groups[relativeDatestamp]) {
                        groups[relativeDatestamp] = {
                            dayOfLife: dayOfLife,
                            dayOfYear: dayOfYear,
                            totalDaysInYear: totalDaysInYear,
                            age: age,
                            logs: []
                        };
                    }
                    groups[relativeDatestamp].logs.push(item);
                });
                return groups;
            }

            const groupedLogs = groupLogsByDay(filteredFeed);

            // Iterate over each day group
            for (const [headerDateText, groupData] of Object.entries(groupedLogs)) {
                // Check if the log-container for this date already exists
                let logContainer = document.querySelector(`.log-container[data-date="${headerDateText}"]`);
                if (!logContainer) {
                    // Create a new log-container
                    logContainer = document.createElement('div');
                    logContainer.classList.add('log-container');
                    logContainer.setAttribute('data-date', headerDateText);

                    // Create date header
                    const dateHeader = document.createElement('div');
                    dateHeader.classList.add('log-date-header');

                    const firstLine = document.createElement('div');
                    firstLine.classList.add('date-header-line1');
                    firstLine.textContent = headerDateText;
                    dateHeader.appendChild(firstLine);

                    const secondLine = document.createElement('div');
                    secondLine.classList.add('date-header-line2');
                    secondLine.textContent = `Day ${groupData.dayOfLife} / ${groupData.dayOfYear} of ${groupData.totalDaysInYear} / Year ${groupData.age}`;
                    dateHeader.appendChild(secondLine);

                    // Append date header to log-container
                    logContainer.appendChild(dateHeader);

                    // Append log-container to logsList
                    logsList.appendChild(logContainer);
                }

                // Append logs to the existing log-container
                groupData.logs.forEach(item => {
                    const log = item.post;
                    if (log && log.record) {
                        const logEntry = document.createElement('div');
                        logEntry.classList.add('log-entry');

                        const logText = document.createElement('p');
                        logText.classList.add('log-text');
                        logText.textContent = log.record.text.trim();
                        logEntry.appendChild(logText);

                        const logTimestamp = document.createElement('p');
                        logTimestamp.classList.add('log-timestamp');

                        const createdAt = new Date(log.record.createdAt);
                        const formattedLogTimestamp = formatLogDate(createdAt);
                        logTimestamp.textContent = formattedLogTimestamp;
                        logEntry.appendChild(logTimestamp);

                        // Append the log entry to the log-container
                        logContainer.appendChild(logEntry);
                    }
                });
            }

            // **New: Process outbound links after all logs are loaded**
            processOutboundLinks();

            // If there are no more logs to load, hide the "See More Logs" button
            if (!currentLogCursor) {
                const seeMoreLogsButton = document.getElementById('see-more-logs');
                if (seeMoreLogsButton) {
                    seeMoreLogsButton.style.display = 'none';
                    console.log('No more logs to load. "See More Logs" button hidden.');
                }
            }
        } catch (error) {
            console.error('Error fetching logs:', error);
            if (logsList) {
                logsList.innerHTML += '<p>Failed to load logs. Please try again later.</p>';
            }
        } finally {
            // Hide loading indicator if available
            if (loadingIndicator) {
                loadingIndicator.style.display = 'none';
            }
            isLoadingLogs = false;
            console.log('Finished loading logs.');
        }
    }

    // Function to load more logs when "See More Logs" button is clicked
    function loadMoreLogs() {
        console.log('"See More Logs" button clicked.');
        if (!currentLogCursor) {
            console.log('No cursor available. Cannot load more logs.');
            return;
        }
        loadLogs(currentLogCursor);
    }

    // Expose loadLogs if "See More Logs" button exists
    const seeMoreLogsButton = document.getElementById('see-more-logs');
    if (seeMoreLogsButton) {
        seeMoreLogsButton.addEventListener('click', loadMoreLogs);
    }

    // Initial load
    loadLogs();
}

// ----------------------------------
// 16. BLOG FEED INITIALIZATION
// ----------------------------------
function initializeBlogFeed() {
    console.log('Initializing Blog Feed');
    loadBlogPosts();

    // Create and append the "See More Posts" button
    const blogFeed = document.getElementById('blog-feed');
    if (!blogFeed) {
        console.error('Element with ID "blog-feed" not found.');
        return;
    }

    const seeMoreButton = document.getElementById('see-more-blog');
    if (seeMoreButton) {
        seeMoreButton.addEventListener('click', loadMoreBlogPosts);
    } else {
        console.warn('"See More Posts" button not found.');
    }
}

let blogCursor = 0; // To keep track of pagination
const BLOG_POSTS_PER_BATCH = 5; // Number of posts to load per batch
let allBlogPosts = []; // To store all fetched blog posts

async function loadBlogPosts() {
    const loadingIndicator = document.getElementById('loading-blog');
    const blogFeed = document.getElementById('blog-feed');
    const seeMoreButton = document.getElementById('see-more-blog');

    if (loadingIndicator) {
        loadingIndicator.style.display = 'block';
    }

    try {
        // Use absolute path for fetching index.json
        const response = await fetch('/data/blog-index.json'); // Adjust based on your actual path
        if (!response.ok) {
            throw new Error(`Failed to fetch blog index: ${response.status}`);
        }
        const blogIndex = await response.json();

        allBlogPosts = blogIndex.posts.sort((a, b) => new Date(b.date) - new Date(a.date)); // Sort by date desc

        displayBlogPosts();
    } catch (error) {
        console.error('Error loading blog posts:', error);
        if (blogFeed) {
            blogFeed.innerHTML = '<p>Failed to load blog posts. Please try again later.</p>';
        }
    } finally {
        if (loadingIndicator) {
            loadingIndicator.style.display = 'none';
        }
    }
}

function displayBlogPosts() {
    const blogFeed = document.getElementById('blog-feed');
    const seeMoreButton = document.getElementById('see-more-blog');

    const postsToDisplay = allBlogPosts.slice(blogCursor, blogCursor + BLOG_POSTS_PER_BATCH);

    postsToDisplay.forEach(post => {
        const postElement = document.createElement('div');
        postElement.classList.add('blog-post');

        // Title
        const title = document.createElement('h2');
        const titleLink = document.createElement('a');
        titleLink.href = `/blog/${post.slug}`; // Clean URL without .html
        titleLink.textContent = post.title;
        title.appendChild(titleLink);
        postElement.appendChild(title);

        // Date
        const date = document.createElement('p');
        date.classList.add('blog-post-date');
        const postDate = new Date(post.date);
        date.textContent = postDate.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
        postElement.appendChild(date);

        // Excerpt
        const excerpt = document.createElement('p');
        excerpt.classList.add('blog-post-excerpt');
        excerpt.textContent = post.excerpt;
        postElement.appendChild(excerpt);

        // "Read more..." Link
        const readMoreLink = document.createElement('a');
        readMoreLink.href = `/blog/${post.slug}`; // Clean URL without .html
        readMoreLink.textContent = 'Read more...';
        readMoreLink.classList.add('read-more'); // Optional: Add a class for styling
        postElement.appendChild(readMoreLink);

        // Append to blog feed
        blogFeed.appendChild(postElement);
    });

    blogCursor += BLOG_POSTS_PER_BATCH;

    // Hide "See More" button if all posts are loaded
    if (blogCursor >= allBlogPosts.length) {
        const seeMoreButton = document.getElementById('see-more-blog');
        if (seeMoreButton) {
            seeMoreButton.style.display = 'none';
        }
    }
}

async function loadMoreBlogPosts() {
    displayBlogPosts();
}

// ----------------------------------
// 18. BLOG POST PAGE INITIALIZATION
// ----------------------------------
async function initializeBlogPost(slug) {
    const loadingIndicator = document.getElementById('post-content');
    const postTitle = document.getElementById('post-title');
    const postDate = document.getElementById('post-date');

    try {
        // Fetch blog index to find the post metadata
        const responseIndex = await fetch('/data/blog-index.json');
        if (!responseIndex.ok) {
            throw new Error(`Failed to fetch blog index: ${responseIndex.status}`);
        }
        const blogIndex = await responseIndex.json();

        // Find the post with the matching slug
        const postMeta = blogIndex.posts.find(post => post.slug === slug);
        if (!postMeta) {
            throw new Error('Blog post not found.');
        }

        // Update title and date
        postTitle.textContent = postMeta.title;
        const postDateObj = new Date(postMeta.date);
        postDate.textContent = postDateObj.toLocaleDateString(undefined, {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        // Update document title
        document.title = `${postMeta.title} - Your Website`;

        // Update meta description
        const metaDescription = document.querySelector('meta[name="description"]');
        if (metaDescription) {
            metaDescription.setAttribute('content', postMeta.excerpt);
        } else {
            const metaDesc = document.createElement('meta');
            metaDesc.name = 'description';
            metaDesc.content = postMeta.excerpt;
            document.head.appendChild(metaDesc);
        }

        // Optionally, add Open Graph tags for better social media sharing
        addOrUpdateMetaTag('og:title', postMeta.title);
        addOrUpdateMetaTag('og:description', postMeta.excerpt);
        addOrUpdateMetaTag('og:type', 'article');
        addOrUpdateMetaTag('og:url', window.location.href);
        // Add more OG tags as needed

        // Fetch the Markdown content
        const responseMarkdown = await fetch(`/data/blog/${slug}.md`); // Updated path
        if (!responseMarkdown.ok) {
            throw new Error(`Failed to fetch blog post: ${responseMarkdown.status}`);
        }
        const markdown = await responseMarkdown.text();

        // Parse Markdown to HTML using marked.js
        const htmlContent = marked.parse(markdown.replace(/^---[\s\S]*?---/, '')); // Remove front matter

        // Inject the HTML content into the page
        const postContent = document.getElementById('post-content');
        postContent.innerHTML = htmlContent;
    } catch (error) {
        console.error('Error loading blog post:', error);
        const postContent = document.getElementById('post-content');
        if (postContent) {
            postContent.innerHTML = '<p>Failed to load blog post. Please try again later.</p>';
        }
        const postTitle = document.getElementById('post-title');
        if (postTitle) {
            postTitle.textContent = 'Post Not Found';
        }
    }
}

function addOrUpdateMetaTag(property, content) {
    let metaTag = document.querySelector(`meta[property="${property}"]`);
    if (!metaTag) {
        metaTag = document.createElement('meta');
        metaTag.setAttribute('property', property);
        document.head.appendChild(metaTag);
    }
    metaTag.setAttribute('content', content);
}

// ----------------------------------
// Helper Function: Format Post Date
// ----------------------------------
function formatPostDate(date) {
    const now = new Date();
    const diffInMs = now - date;
    const diffInHours = diffInMs / (1000 * 60 * 60);
    const dayOfLife = getDaysSinceBirthdate(date);

    if (diffInHours < 24) {
        const relativeTime = getRelativeTime(date);
        return `Posted ${relativeTime} on Day ${dayOfLife}`;
    } else {
        const formattedTime = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: 'numeric' });
        return `Posted at ${formattedTime} on Day ${dayOfLife}`;
    }
}

// ----------------------------------
// 17. CONFIGURATION: Define Approved Domains
// ----------------------------------
const approvedDomains = [
    'dame.is',
    'dame.art',
    'dame.contact',
    'dame.news',
    'dame.work'
];

// ----------------------------------
// 18. FUNCTION: Process Outbound Links
// ----------------------------------
function processOutboundLinks() {
    // Select all anchor tags with href attributes
    const links = document.querySelectorAll('a[href]');
    
    links.forEach(link => {
        const href = link.getAttribute('href');
        let url;
        
        // Attempt to create a URL object; skip if invalid
        try {
            url = new URL(href, window.location.origin);
        } catch (e) {
            // Invalid URL (e.g., mailto:, tel:, or relative URLs that don't resolve)
            return;
        }

        // Check if the link's hostname ends with any of the approved domains
        const isInternal = approvedDomains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));

        if (!isInternal) {
            // External link: open in new tab with security attributes
            link.setAttribute('target', '_blank');
            link.setAttribute('rel', 'noopener noreferrer');
        } else {
            // Internal link: ensure it doesn't open in a new tab
            link.removeAttribute('target');
            link.removeAttribute('rel');
        }
    });
}
