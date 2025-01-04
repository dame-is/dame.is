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
                const postTextContainer = document.createElement('div');
                postTextContainer.classList.add('post-text-container');

                const postText = post.record.text || '[No content]';

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
                replyCount.textContent = `${post.replyCount || 0} replies`;
                countsContainer.appendChild(replyCount);

                // Quote Count
                const quoteCount = document.createElement('span');
                quoteCount.textContent = `${post.quoteCount || 0} quotes`;
                countsContainer.appendChild(quoteCount);

                // Repost Count
                const repostCount = document.createElement('span');
                repostCount.textContent = `${post.repostCount || 0} reposts`;
                countsContainer.appendChild(repostCount);

                // Like Count
                const likeCount = document.createElement('span');
                likeCount.textContent = `${post.likeCount || 0} likes`;
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
