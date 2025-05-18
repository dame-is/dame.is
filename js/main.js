// scripts/main.js

const GITHUB_USERNAME = 'dame-is'; // Your GitHub username
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
    const dayOfLife = getDaysSinceBirthdate(date);
    const relativeTime = getRelativeTime(date);
    const formattedDate = formatFullDate(date);
    
    // Capitalize first letter of relative time
    const capitalizedRelativeTime = relativeTime.charAt(0).toUpperCase() + relativeTime.slice(1);
    
    return `${capitalizedRelativeTime}, ${formattedDate} (Day ${dayOfLife})`;
}

// Function to format date header by day only (for grouping posts and logs)
function formatDailyDateHeader(date) {
    // For consistent grouping by day, normalize the date by setting hours, minutes, seconds to 0
    // Create a new date with the local day/month/year to properly handle timezone differences
    const normalizedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
    
    const dayOfLife = getDaysSinceBirthdate(normalizedDate);
    const formattedDate = formatFullDate(normalizedDate);
    
    // Use "Today" or "Yesterday" for recent dates
    let prefix = '';
    if (isToday(normalizedDate)) {
        prefix = 'Today';
    } else if (isYesterday(normalizedDate)) {
        prefix = 'Yesterday';
    } else {
        // For older dates, just use the date without relative time
        prefix = '';
    }
    
    // Return date without the Day number
    return prefix ? `${prefix}, ${formattedDate}` : formattedDate;
}

// Function to calculate Day of Life
function getDaysSinceBirthdate(date) {
    const msPerDay = 24 * 60 * 60 * 1000;
    // Create UTC date numbers for both dates (ignoring local timezone)
    const utcBirthDate = Date.UTC(BIRTHDATE.getFullYear(), BIRTHDATE.getMonth(), BIRTHDATE.getDate());
    const utcCurrentDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.floor((utcCurrentDate - utcBirthDate) / msPerDay);
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
    // Initialize nav and footer elements which are now included via 11ty templates
    initializeNav();
    initializeFooter();

    // Initialize page-specific features based on the current URL
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(part => part !== '');
    
    // Determine the current page key based on the URL
    let pageKey = '';
    
    if (path === '/' || path === '/index.html') {
        // For home page, map to 'index' to match last-updated.json
        pageKey = 'index';
    } else if (path.startsWith('/writing/blogs/')) {
        // For dynamic blog post pages like /writing/blogs/my-post-slug
        const slug = pathParts[2];
        pageKey = `blog/${slug}`;
    } else if (path === '/writing/blogs' || path === '/writing/blogs/') {
        // For the main blog feed page
        pageKey = 'blog';
    } else if (path === '/writing/posts' || path === '/writing/posts/') {
        // For the posts feed page
        pageKey = 'posts';
    } else {
        // For other static pages like /about, /ethos, etc.
        // Extract the page name without extension
        const lastSegment = pathParts.length > 0 ? pathParts[pathParts.length - 1] : '';
        pageKey = lastSegment.split('.')[0];
    }
    
    // Initialize page-specific features based on the determined pageKey
    switch (pageKey) {
        case 'posts':
            initializePostLoader();
            break;
        case 'logging':
            // The log loader will be initialized by the script tag in logging.md
            // Don't initialize it here to avoid double initialization
            break;
        case 'blog':
            // Blogs are now handled by 11ty
            // No need to initialize anything
            break;
        default:
            if (path.startsWith('/writing/blogs/') && pathParts.length > 2) {
                // Blog posts are now rendered by 11ty
                // Just initialize Bluesky comments if needed
                initializeBlueskyComments();
            }
            break;
    }

    // Initialize supporters list if we're on the supported page
    if (window.location.pathname === '/supported' || window.location.pathname === '/supported/') {
        initializeSupportersList();
    }

    // Mobile/tap dropdown support for nav
    document.querySelectorAll('.nav-item.has-dropdown > .nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            // Only activate on touch/click, not on keyboard navigation
            if (window.matchMedia('(hover: none)').matches || window.innerWidth < 900) {
                e.preventDefault();
                const parent = this.parentElement;
                const isOpen = parent.classList.contains('dropdown-open');
                // Close all dropdowns
                document.querySelectorAll('.nav-item.has-dropdown').forEach(item => {
                    item.classList.remove('dropdown-open');
                });
                // Toggle this one
                if (!isOpen) {
                    parent.classList.add('dropdown-open');
                }
            }
        });
    });
    // Optional: close dropdowns when clicking outside
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.nav-item.has-dropdown')) {
            document.querySelectorAll('.nav-item.has-dropdown').forEach(item => {
                item.classList.remove('dropdown-open');
            });
        }
    });
});

// Function to initialize Bluesky comments
function initializeBlueskyComments() {
    const commentsContainer = document.getElementById('bluesky-comments');
    if (commentsContainer) {
        // Dispatch a custom event to notify the module script
        window.dispatchEvent(new CustomEvent('bluesky_uri_set'));
    }
}

// ----------------------------------
// 7. NAV INITIALIZATION
// ----------------------------------
function initializeNav() {
    // Theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        // First check for system preference
        const prefersDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
        
        // Set initial theme based on localStorage if present, otherwise use system preference
        const storedTheme = localStorage.getItem('theme');
        
        if (storedTheme === 'dark' || (storedTheme === null && prefersDarkMode)) {
            document.body.classList.add('dark-mode');
        } else if (storedTheme === 'light' || (storedTheme === null && !prefersDarkMode)) {
            document.body.classList.remove('dark-mode');
        }
        
        updateThemeIcon();

        // Listen for system preference changes
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            // Only update theme based on system if user hasn't explicitly set a preference
            if (localStorage.getItem('theme') === null) {
                if (e.matches) {
                    document.body.classList.add('dark-mode');
                } else {
                    document.body.classList.remove('dark-mode');
                }
                updateThemeIcon();
            }
        });

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

    const useElement = themeToggle.querySelector('use');
    if (!useElement) {
        console.warn('No <use> element found within #theme-toggle.');
        return;
    }

    if (document.body.classList.contains('dark-mode')) {
        // Switch to Sun Icon for Light Mode
        useElement.setAttribute('href', '/assets/icons/icons-sprite.svg#icon-sun');
        themeToggle.setAttribute('aria-label', 'Switch to light mode');
    } else {
        // Switch to Moon Icon for Dark Mode
        useElement.setAttribute('href', '/assets/icons/icons-sprite.svg#icon-moon');
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
        <!-- Temporarily removed posts and replies counts
        <span class="stat">
            <span class="count" id="posts">0</span>
            <span class="label">posts</span>
        </span>
        <span class="stat">
            <span class="count" id="replies">0</span>
            <span class="label">replies</span>
        </span>
        -->
      `;
    } else {
      console.warn('Element with ID "bluesky-stats" not found.');
      return;
    }
  
    // Get references to the count elements
    const followersElem = document.getElementById('followers');
    const followingElem = document.getElementById('following');
    // Temporarily commented out posts and replies elements
    // const postsElem = document.getElementById('posts');
    // const repliesElem = document.getElementById('replies');
  
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
    // Temporarily commented out posts and replies counts
    // let postsCount = 0;
    // let repliesCount = 0;
  
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
  
        /* 
        // --- STEP 2: Fetch Posts and Replies (Paginated) ---
        // Temporarily commenting out posts and replies fetching to reduce API calls
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
      */
    } catch (error) {
      console.error('Error fetching Bluesky stats:', error);
      // Optionally show error values or reset counts
      if (followersElem) followersElem.textContent = 0;
      if (followingElem) followingElem.textContent = 0;
      // Temporarily commented out posts and replies error handling
      // if (postsElem) postsElem.textContent = 0;
      // if (repliesElem) repliesElem.textContent = 0;
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

// Helper function to calculate relative time
function getRelativeTime(pastDate) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - pastDate) / 1000);

    const intervals = [
        { label: 'year', seconds: 31536000 },
        { label: 'month', seconds: 2592000 },
        { label: 'week', seconds: 604800 },
        { label: 'day', seconds: 86400 },
        { label: 'hour', seconds: 3600 },
        { label: 'minute', seconds: 60 },
        { label: 'second', seconds: 1 }
    ];

    for (const interval of intervals) {
        const count = Math.floor(diffInSeconds / interval.seconds);
        if (count >= 1) {
            return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-count, interval.label);
        }
    }
    return 'just now';
}

async function fetchFooterData() {
    const apiUrlTags = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/tags`;
    const apiUrlCommits = `https://api.github.com/repos/${GITHUB_USERNAME}/${GITHUB_REPO}/commits/${GITHUB_BRANCH}`;
    
    try {
        // Fetch the latest tag
        console.log('Fetching GitHub tags...');
        const responseTags = await fetch(apiUrlTags);
        if (!responseTags.ok) throw new Error(`GitHub Tags API error: ${responseTags.status}`);
        const tagsData = await responseTags.json();
        console.log('Fetched tags:', tagsData);

        let version = 'No Tags';
        let lastUpdatedDate = null;

        if (tagsData.length > 0) {
            // Use the first (most recent) tag
            version = tagsData[0].name;
        } else {
            // If no tags exist, fallback to the latest commit
            console.log('No tags found. Fetching latest commit...');
            const responseCommits = await fetch(apiUrlCommits);
            if (!responseCommits.ok) throw new Error(`GitHub Commits API error: ${responseCommits.status}`);
            const commitsData = await responseCommits.json();
            const latestCommit = commitsData;
            version = latestCommit.sha.substring(0, 7); // Short SHA
        }

        // Update the version element if needed
        const versionElement = document.getElementById('version');
        if (versionElement) {
            versionElement.textContent = version;
            console.log(`Updated version element: ${version}`);
        }
        
        // NOTE: We're no longer updating the last-updated element here
        // as it's now handled by Eleventy templating
    } catch (error) {
        console.error('Error fetching footer data:', error);
        const versionElement = document.getElementById('version');
        if (versionElement) {
            versionElement.textContent = 'N/A';
        }
    }
}

// ----------------------------------
// 12. POST LOADER (INDEX PAGE) - UPDATED
// ----------------------------------
let currentBatchCursor = null; // To store the cursor for the next batch
const POSTS_PER_BATCH = 100;     // Number of posts to fetch per batch
let isLoadingPosts = false;      // Flag to prevent multiple simultaneous fetches

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
    const fragment = document.createDocumentFragment();
    const byteMap = createByteMap(text);
    let lastCharIndex = 0;

    if (!facets || facets.length === 0) {
        appendTextWithLineBreaks(fragment, text);
        return fragment;
    }

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
                    // Adjust the end index so that it's inclusive (if it's not already the end of the text)
                    const endCharAdjusted = endChar < text.length ? endChar + 1 : endChar;

                    // Append text before the link
                    const beforeText = text.slice(lastCharIndex, startChar);
                    if (beforeText) {
                        appendTextWithLineBreaks(fragment, beforeText);
                    }

                    // Extract the link text using the adjusted indices
                    let linkText = text.slice(startChar, endCharAdjusted);

                    // If the link text starts with a space, extract that space separately
                    if (linkText.startsWith(" ")) {
                        // Determine how many whitespace characters are at the start
                        const match = linkText.match(/^\s+/);
                        if (match) {
                            const leadingWhitespace = match[0];
                            // Append the whitespace as normal text
                            appendTextWithLineBreaks(fragment, leadingWhitespace);
                            // Remove the whitespace from the link text
                            linkText = linkText.slice(leadingWhitespace.length);
                        }
                    }

                    // Create the link element using the trimmed text
                    const a = document.createElement('a');
                    a.href = uri;
                    a.textContent = linkText;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    fragment.appendChild(a);

                    // Update the lastCharIndex to after the link
                    lastCharIndex = endCharAdjusted;
                }
            });
        }
    });

    // Append any remaining text after the last link
    const remainingText = text.slice(lastCharIndex);
    if (remainingText) {
        appendTextWithLineBreaks(fragment, remainingText);
    }

    return fragment;
}

/**
 * Modified loadRecentPosts:
 * - Initially (or when paginating), 100 posts are fetched.
 * - When "See More Posts" is pressed, an additional 100 posts are fetched (for a total of 200 posts).
 * - Then we group all fetched posts by day.
 * - If the API cursor is still present (meaning there are more posts), we assume the oldest day is incomplete
 *   and remove that group from rendering.
 */
async function loadRecentPosts(cursor = null) {
    console.log('Loading recent posts', cursor ? `with cursor: ${cursor}` : '');
    if (isLoadingPosts) {
        console.log('Already loading posts. Exiting.');
        return;
    }
    isLoadingPosts = true;

    // Get loading indicator
    const loadingIndicator = document.getElementById('posts-loading');
    if (loadingIndicator) {
        loadingIndicator.style.display = 'block';
    }

    // Helper to format a relative timestamp (unchanged)
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

    // We'll fetch posts in two API calls (total 200 posts) when paginating.
    let allFetchedPosts = [];
    let batchesToFetch = 2; // 2 batches * 100 = 200 posts total.
    let localCursor = cursor;
    while (batchesToFetch > 0) {
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

        // Update the cursor for next batch
        localCursor = data.cursor || null;
        currentBatchCursor = localCursor;
        console.log('Current batch cursor updated to:', currentBatchCursor);

        // Remove reposts
        const filteredBatch = data.feed.filter(item => {
            return !(item.reason && item.reason.$type === "app.bsky.feed.defs#reasonRepost");
        });

        const finalBatch = filteredBatch.filter(item => {
            const post = item.post;
            if (post && post.record) {
              // If it's a reply post:
              if (post.record.reply) {
                // There must be a reply object at the top level.
                if (!item.reply) return false;
          
                // Helper function that, given a reply field,
                // returns the author DID using either a nested author or a direct property.
                const getTopLevelDid = (field) => {
                  if (!field) return null;
                  // Check if there's a nested author object
                  if (field.author && field.author.did) {
                    return field.author.did;
                  }
                  // Otherwise, assume the field itself holds the DID
                  return field.did || null;
                };
          
                // Get the top-level DIDs for parent, root, and grandparentAuthor (if present)
                const parentDid = getTopLevelDid(item.reply.parent);
                const rootDid = getTopLevelDid(item.reply.root);
                const grandparentDid = getTopLevelDid(item.reply.grandparentAuthor);
          
                // For each field that is present, require that the DID matches the actor.
                // (If a field is missing, we assume there's no conflict.)
                if (parentDid !== null && parentDid !== actor) {
                  return false;
                }
                if (rootDid !== null && rootDid !== actor) {
                  return false;
                }
                if (grandparentDid !== null && grandparentDid !== actor) {
                  return false;
                }
              }
              // Include the post if it's not a reply or the checks passed.
              return true;
            }
            return false;
          });
          
        
        allFetchedPosts.push(...finalBatch);
        batchesToFetch--;
        if (!localCursor) break;
    }

    console.log(`Fetched a total of ${allFetchedPosts.length} posts in this call.`);

    // Group posts by day using your existing grouping function.
    function groupPostsByDay(posts) {
        const groups = {};
        posts.forEach(item => {
            const postDate = new Date(item.post.record.createdAt);
            // Create a key based on local date in YYYY-MM-DD format to ensure proper timezone handling
            const dateKey = `${postDate.getFullYear()}-${String(postDate.getMonth() + 1).padStart(2, '0')}-${String(postDate.getDate()).padStart(2, '0')}`;
            
            // Use the daily date header format for display
            const relativeDatestamp = formatDailyDateHeader(postDate);
            const dayOfLife = getDaysSinceBirthdate(postDate);
            const dayOfYear = getDayOfYear(postDate);
            const totalDaysInYear = isLeapYear(postDate.getFullYear()) ? 366 : 365;
            const age = getAge(postDate);
            
            if (!groups[dateKey]) {
                groups[dateKey] = {
                    displayDate: relativeDatestamp,
                    dayOfLife: dayOfLife,
                    dayOfYear: dayOfYear,
                    totalDaysInYear: totalDaysInYear,
                    age: age,
                    posts: []
                };
            }
            groups[dateKey].posts.push(item);
        });
        
        // Convert from date keys back to display dates for rendering
        const displayGroups = {};
        for (const [dateKey, groupData] of Object.entries(groups)) {
            displayGroups[groupData.displayDate] = {
                dayOfLife: groupData.dayOfLife,
                dayOfYear: groupData.dayOfYear,
                totalDaysInYear: groupData.totalDaysInYear,
                age: groupData.age,
                posts: groupData.posts
            };
        }
        
        return displayGroups;
    }
    let groupedPosts = groupPostsByDay(allFetchedPosts);

    // If currentBatchCursor is not null (i.e. more posts exist), assume the oldest day group may be incomplete.
    // Remove the group with the oldest date.
    if (currentBatchCursor) {
        // Get all display dates and find the oldest one by comparing the actual ISO date key
        const groupKeys = Object.keys(groupedPosts);
        if (groupKeys.length > 0) {
            // Convert display dates back to timestamps to find the oldest one
            let oldestDate = new Date();
            let oldestKey = '';
            
            // Iterate through all groups and find the oldest one
            for (const displayDate of groupKeys) {
                // For each group, get a sample post to find the actual date
                const samplePost = groupedPosts[displayDate].posts[0];
                const postDate = new Date(samplePost.post.record.createdAt);
                
                // Compare dates and track the oldest one
                if (postDate < oldestDate) {
                    oldestDate = postDate;
                    oldestKey = displayDate;
                }
            }
            
            if (oldestKey) {
                console.log(`Removing oldest group '${oldestKey}' since more posts exist.`);
                delete groupedPosts[oldestKey];
            }
        }
    }

// Now render the groups.
console.log(`Total day groups to display: ${Object.keys(groupedPosts).length}`);

for (const [headerDateText, groupData] of Object.entries(groupedPosts)) {
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

        /**
         * Updated createCount Function
         * Replaces the creation of <i> elements with <svg><use></use></svg> referencing the SVG sprite.
         *
         * @param {string} iconName - The name of the icon (without 'icon-' prefix).
         * @param {number} count - The numerical count to display.
         * @param {string} label - The label for accessibility.
         * @returns {HTMLElement} - The span element containing the SVG icon and count.
         */
        function createCount(iconName, count, label) {
            const countSpan = document.createElement('span');
            countSpan.classList.add('count-item');
            countSpan.setAttribute('aria-label', `${count} ${label}`);
            if (count > 0) {
                countSpan.classList.add('active');
            }

            // Create SVG element
            const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.classList.add('icon', `fa-${iconName}`); // Retain existing class for potential styling
            svg.setAttribute('fill', 'currentColor');
            svg.setAttribute('aria-hidden', 'true');
            svg.setAttribute('focusable', 'false');

            // Create <use> element referencing the SVG sprite
            const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
            use.setAttribute('href', `/assets/icons/icons-sprite.svg#icon-${iconName}`);

            // Append <use> to SVG
            svg.appendChild(use);

            // Append SVG to countSpan
            countSpan.appendChild(svg);

            // Create and append count text
            const countText = document.createElement('span');
            countText.classList.add('count-text');
            countText.textContent = count;
            countSpan.appendChild(countText);

            return countSpan;
        }

        // Updated Calls to createCount with icon names instead of Font Awesome classes
        const replyCountHeader = createCount('reply', totalReplies, 'replies');
        const quoteCountHeader = createCount('quote-right', totalQuotes, 'quotes');
        const repostCountHeader = createCount('retweet', totalReposts, 'reposts');
        const likeCountHeader = createCount('heart', totalLikes, 'likes');

        headerRight.appendChild(replyCountHeader);
        headerRight.appendChild(quoteCountHeader);
        headerRight.appendChild(repostCountHeader);
        headerRight.appendChild(likeCountHeader);

        dateHeader.appendChild(headerLeft);
        dateHeader.appendChild(headerRight);

        postsList.appendChild(dateHeader);
    }

    groupData.posts.forEach(item => {
        const post = item.post;
        if (post && post.record) {
            const postContainer = document.createElement('div');
            postContainer.classList.add('post');

            // Post Text
            const postText = post.record.text && post.record.text.trim() !== '' ? post.record.text : null;
            const postFacets = post.record.facets || [];
            if (postText) {
                const postTextContainer = document.createElement('div');
                postTextContainer.classList.add('post-text-container');
                const parsedText = parseTextWithFacets(postText, postFacets);
                postTextContainer.appendChild(parsedText);
                postContainer.appendChild(postTextContainer);
            }

            // Now check for embeds.
            // If the embed type is "app.bsky.embed.recordWithMedia#view", then render both the quoted record and the media.
            if (post.embed && post.embed.$type === "app.bsky.embed.recordWithMedia#view") {
                // Render the media (assuming images)
                if (post.embed.media && post.embed.media.$type === "app.bsky.embed.images#view" && Array.isArray(post.embed.media.images)) {
                    post.embed.media.images.forEach(imageData => {
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
                // Render the quoted record (if available)
                if (post.embed.record && post.embed.record.record && post.embed.record.record.value) {
                    const quotedText = post.embed.record.record.value.text || '';
                    const quotedAuthor = post.embed.record.record.author && post.embed.record.record.author.handle ? post.embed.record.record.author.handle : '';
                    if (quotedText) {
                        const quoteContainer = document.createElement('blockquote');
                        quoteContainer.classList.add('embedded-quote');
                        const quoteTextElem = document.createElement('p');
                        quoteTextElem.textContent = quotedText;
                        quoteContainer.appendChild(quoteTextElem);
                        if (quotedAuthor) {
                            const quoteAuthorElem = document.createElement('cite');
                            quoteAuthorElem.textContent = `— @${quotedAuthor}`;
                            quoteContainer.appendChild(quoteAuthorElem);
                        }
                        postContainer.appendChild(quoteContainer);
                    }
                }
            } else {
                // Otherwise, handle individual embed types.
                // External embed as linkCard
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
                // Image embeds (if not included in recordWithMedia)
                if (post.embed && post.embed.$type === "app.bsky.embed.images#view" && Array.isArray(post.embed.images)) {
                    post.embed.images.forEach(imageData => {
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
                // Quote (record) embed
                if (post.embed && post.embed.$type === "app.bsky.embed.record#view" && post.embed.record) {
                    const embeddedRecord = post.embed.record;
                    if (embeddedRecord.$type === "app.bsky.embed.record#viewRecord" && embeddedRecord.value) {
                        const embeddedText = embeddedRecord.value.text || '';
                        const embeddedAuthorHandle = embeddedRecord.author && embeddedRecord.author.handle ? embeddedRecord.author.handle : 'Unknown';
                        if (embeddedText) {
                            const quoteContainer = document.createElement('blockquote');
                            quoteContainer.classList.add('embedded-quote');
                            const quoteTextElem = document.createElement('p');
                            quoteTextElem.textContent = embeddedText;
                            quoteContainer.appendChild(quoteTextElem);
                            const quoteAuthorElem = document.createElement('cite');
                            quoteAuthorElem.textContent = `— @${embeddedAuthorHandle}`;
                            quoteContainer.appendChild(quoteAuthorElem);
                            postContainer.appendChild(quoteContainer);
                        }
                    }
                }
            }

            // Post Date
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

            // Post Counts
            const countsContainer = document.createElement('div');
            countsContainer.classList.add('post-counts');

            /**
             * Updated createCount Function within Post Counts
             * Replaces the creation of <i> elements with <svg><use></use></svg> referencing the SVG sprite.
             *
             * @param {string} iconName - The name of the icon (without 'icon-' prefix).
             * @param {number} count - The numerical count to display.
             * @param {string} label - The label for accessibility.
             * @returns {HTMLElement} - The span element containing the SVG icon and count.
             */
            function createCount(iconName, count, label) {
                const countSpan = document.createElement('span');
                countSpan.classList.add('count-item');
                countSpan.setAttribute('aria-label', `${count} ${label}`);
                if (count > 0) {
                    countSpan.classList.add('active');
                }

                // Create SVG element
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.classList.add('icon', `fa-${iconName}`);
                svg.setAttribute('fill', 'currentColor');
                svg.setAttribute('aria-hidden', 'true');
                svg.setAttribute('focusable', 'false');

                // Create <use> element referencing the SVG sprite
                const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
                use.setAttribute('href', `/assets/icons/icons-sprite.svg#icon-${iconName}`);

                // Append <use> to SVG
                svg.appendChild(use);

                // Append SVG to countSpan
                countSpan.appendChild(svg);

                // Create and append count text
                const countText = document.createElement('span');
                countText.classList.add('count-text');
                countText.textContent = count;
                countSpan.appendChild(countText);

                return countSpan;
            }

            const replies = post.replyCount || 0;
            countsContainer.appendChild(createCount('reply', replies, 'replies'));

            const quotes = post.quoteCount || 0;
            countsContainer.appendChild(createCount('quote-right', quotes, 'quotes'));

            const reposts = post.repostCount || 0;
            countsContainer.appendChild(createCount('retweet', reposts, 'reposts'));

            const likes = post.likeCount || 0;
            countsContainer.appendChild(createCount('heart', likes, 'likes'));

            postContainer.appendChild(countsContainer);

            postsList.appendChild(postContainer);
        }
    });
 }

    // Process outbound links after all posts are loaded
    processOutboundLinks();

    // Hide the loading indicator now that posts are loaded
    if (loadingIndicator) {
        loadingIndicator.style.display = 'none';
    }

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

// Function to load more posts when "See More Posts" button is clicked
function loadMorePosts() {
    console.log('"See More Posts" button clicked.');
    if (!currentBatchCursor) {
        console.log('No cursor available. Cannot load more posts.');
        return;
    }
    loadRecentPosts(currentBatchCursor);
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

            // **Process outbound links after content injection**
            if (typeof processOutboundLinks === 'function') {
                processOutboundLinks();
            } else {
                console.warn('processOutboundLinks function is not defined.');
            }
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

    // Special case for root path
    if (path === '') {
        pageKey = 'about';
    } else {
        // Extract the last part of the path
        pageKey = path.substring(path.lastIndexOf('/') + 1);
    }

    const navLinks = document.querySelectorAll('.nav-left .nav-link');
    navLinks.forEach(link => {
        const linkPath = link.getAttribute('href');
        
        // Special case for about link
        if (linkPath === '/' && pageKey === 'about') {
            link.classList.add('active');
        } else if (linkPath === `/${pageKey}`) {
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
    let processedPostIds = new Set(); // Track post IDs we've already processed
    let hasInitialized = false; // Flag to prevent double initialization

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

            // Deduplicate logs by checking if we've already processed this post ID
            const deduplicatedFeed = filteredFeed.filter(item => {
                if (!item.post || !item.post.uri) return false; 
                
                // Extract a unique ID from the post URI
                const postIdMatch = item.post.uri.match(/\/([^\/]+)$/);
                const postId = postIdMatch ? postIdMatch[1] : null;
                
                if (!postId || processedPostIds.has(postId)) {
                    return false; // Skip this item if we've already processed it
                }
                
                // Otherwise, add it to our set and keep it
                processedPostIds.add(postId);
                return true;
            });

            // Sort by createdAt desc
            deduplicatedFeed.sort((a, b) => new Date(b.post.record.createdAt) - new Date(a.post.record.createdAt));

            // Group logs by day with additional data
            function groupLogsByDay(logs) {
                const groups = {};
                logs.forEach(item => {
                    const logDate = new Date(item.post.record.createdAt);
                    // Create a key based on local date in YYYY-MM-DD format to ensure proper timezone handling
                    const dateKey = `${logDate.getFullYear()}-${String(logDate.getMonth() + 1).padStart(2, '0')}-${String(logDate.getDate()).padStart(2, '0')}`;
                    
                    // Use the daily date header format for display
                    const relativeDatestamp = formatDailyDateHeader(logDate);
                    const dayOfLife = getDaysSinceBirthdate(logDate);
                    const dayOfYear = getDayOfYear(logDate);
                    const totalDaysInYear = isLeapYear(logDate.getFullYear()) ? 366 : 365;
                    const age = getAge(logDate);
                    
                    if (!groups[dateKey]) {
                        groups[dateKey] = {
                            displayDate: relativeDatestamp,
                            dayOfLife: dayOfLife,
                            dayOfYear: dayOfYear,
                            totalDaysInYear: totalDaysInYear,
                            age: age,
                            logs: []
                        };
                    }
                    groups[dateKey].logs.push(item);
                });
                
                // Convert from date keys back to display dates for rendering
                const displayGroups = {};
                for (const [dateKey, groupData] of Object.entries(groups)) {
                    displayGroups[groupData.displayDate] = {
                        dayOfLife: groupData.dayOfLife,
                        dayOfYear: groupData.dayOfYear,
                        totalDaysInYear: groupData.totalDaysInYear,
                        age: groupData.age,
                        logs: groupData.logs
                    };
                }
                
                return displayGroups;
            }

            const groupedLogs = groupLogsByDay(deduplicatedFeed);

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
                        // Add extra check to avoid duplicates by checking for existing entries with the same text/timestamp
                        const logText = log.record.text.trim();
                        const logTimestamp = new Date(log.record.createdAt).getTime();
                        
                        // Check if this exact log text + timestamp already exists in this container
                        const existingLog = logContainer.querySelector(`.log-entry[data-timestamp="${logTimestamp}"][data-text="${logText}"]`);
                        if (existingLog) {
                            return; // Skip if already exists
                        }
                        
                        const logEntry = document.createElement('div');
                        logEntry.classList.add('log-entry');
                        // Store text and timestamp as data attributes for future duplicate checks
                        logEntry.setAttribute('data-timestamp', logTimestamp);
                        logEntry.setAttribute('data-text', logText);

                        const logTextEl = document.createElement('p');
                        logTextEl.classList.add('log-text');
                        logTextEl.textContent = logText;
                        logEntry.appendChild(logTextEl);

                        const logTimestampEl = document.createElement('p');
                        logTimestampEl.classList.add('log-timestamp');

                        const createdAt = new Date(log.record.createdAt);
                        const formattedLogTimestamp = formatLogDate(createdAt);
                        logTimestampEl.textContent = formattedLogTimestamp;
                        logEntry.appendChild(logTimestampEl);

                        // Append the log entry to the log-container
                        logContainer.appendChild(logEntry);
                    }
                });
            }

            // Process outbound links after all logs are loaded
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

    // Only do the initial load if we haven't already
    if (!hasInitialized) {
        hasInitialized = true;
        // Initial load
        loadLogs();
    }
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
async function initializeBlogPostFromURL() {
    const path = window.location.pathname;
    const pathParts = path.split('/').filter(part => part !== '');
    const slug = pathParts.length > 1 ? pathParts[1] : null; // Extract slug from /blog/slug

    if (slug) {
        await initializeBlogPost(slug);
    } else {
        // Handle the case where no slug is provided
        const postTitle = document.getElementById('post-title');
        const postContent = document.getElementById('post-content');
        if (postTitle) postTitle.textContent = 'Post Not Found';
        if (postContent) postContent.innerHTML = '<p>The requested post does not exist.</p>';
    }
}

async function initializeBlogPost(slug) {
    const postContent = document.getElementById('post-content');
    const postTitle = document.getElementById('post-title');
    const postDate = document.getElementById('post-date');

    try {
        // Fetch the Markdown content
        const responseMarkdown = await fetch(`/data/blog/${slug}.md`); // Adjust path as needed
        if (!responseMarkdown.ok) {
            throw new Error(`Failed to fetch blog post: ${responseMarkdown.status}`);
        }
        const rawMarkdown = await responseMarkdown.text();

        // Extract Frontmatter using regex
        const frontmatterRegex = /^---\s*([\s\S]*?)\s*---\s*([\s\S]*)$/;
        const match = rawMarkdown.match(frontmatterRegex);

        if (!match) {
            throw new Error('Invalid frontmatter format.');
        }

        const frontmatter = match[1];
        const markdownContent = match[2];

        // Parse Frontmatter using js-yaml
        const metadata = jsyaml.load(frontmatter);

        // Parse Markdown to HTML using marked.js
        const htmlContent = marked.parse(markdownContent);

        // Inject the HTML content into the page
        postContent.innerHTML = htmlContent;

        // Update title and date
        postTitle.textContent = metadata.title || 'Untitled Post';
        if (metadata.date) {
            const postDateObj = new Date(metadata.date);
            postDate.textContent = postDateObj.toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
        } else {
            postDate.textContent = '';
        }

        // Update document title
        document.title = `${metadata.title || 'Blog Post'} - dame.is`;

        // **Set the Bluesky URI in the comments container and dispatch event**
        if (metadata.bluesky_uri) {
            const commentsContainer = document.getElementById('bluesky-comments');
            commentsContainer.setAttribute('data-uri', metadata.bluesky_uri);
            // Dispatch a custom event to notify the module script
            window.dispatchEvent(new CustomEvent('bluesky_uri_set'));
        } else {
            const commentsContainer = document.getElementById('bluesky-comments');
            commentsContainer.innerHTML = '<p>No comments are currently available. Check back later.</p>';
        }

        // **Call `processOutboundLinks` after content injection**
        if (typeof processOutboundLinks === 'function') {
            processOutboundLinks();
        } else {
            console.warn('processOutboundLinks function is not defined.');
        }
    } catch (error) {
        console.error('Error loading blog post:', error);
        if (postContent) {
            postContent.innerHTML = '<p>Failed to load blog post. Please try again later.</p>';
        }
        if (postTitle) {
            postTitle.textContent = 'Post Not Found';
        }
    }
}


// ----------------------------------
// Helper Function: Format Post Date
// ----------------------------------
function formatPostDate(date) {
    const dayOfLife = getDaysSinceBirthdate(date);
    const relativeTime = getRelativeTime(date);
    const formattedDate = date.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
    
    // Capitalize first letter of relative time
    const capitalizedRelativeTime = relativeTime.charAt(0).toUpperCase() + relativeTime.slice(1);
    
    return `${capitalizedRelativeTime}, ${formattedDate} (Day ${dayOfLife})`;
}

// ----------------------------------
// 17. CONFIGURATION: Define Approved Domains
// ----------------------------------
const approvedDomains = [
    'dame.is',
    'dame.art',
    'dame.contact',
    'dame.news',
    'dame.work',
    'localhost',
    '127.0.0.1'
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

// Make the function accessible globally
window.processOutboundLinks = processOutboundLinks;

// ----------------------------------
// 19. SUPPORTERS LIST INITIALIZATION
// ----------------------------------
async function initializeSupportersList() {
    const supportersList = document.getElementById('supporters-list');
    if (!supportersList) return;

    try {
        // Fetch the list data from the Bluesky API
        const listUri = 'at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.graph.list/3linbcqreuh22';
        const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.graph.getList?list=${encodeURIComponent(listUri)}`;
        
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error(`Failed to fetch supporters list: ${response.status}`);
        
        const data = await response.json();
        
        if (!data.items || data.items.length === 0) {
            supportersList.innerHTML = '<p>No supporters found.</p>';
            return;
        }

        // Create the list HTML - now in reverse order
        const listHtml = [...data.items].reverse().map(item => {
            const handle = item.subject.handle;
            const displayName = item.subject.displayName || handle;
            return `<div class="supporter">
                <a href="https://bsky.app/profile/${handle}" target="_blank" rel="noopener noreferrer">
                    @${handle}
                </a>
            </div>`;
        }).join('');

        supportersList.innerHTML = listHtml;
    } catch (error) {
        console.error('Error loading supporters list:', error);
        supportersList.innerHTML = '<p>Failed to load supporters list. Please try again later.</p>';
    }
}

// Add initialization to DOMContentLoaded event
document.addEventListener('DOMContentLoaded', () => {
    // ... existing initialization code ...
    
    // Initialize supporters list if we're on the supported page
    if (window.location.pathname === '/supported' || window.location.pathname === '/supported/') {
        initializeSupportersList();
    }
});

