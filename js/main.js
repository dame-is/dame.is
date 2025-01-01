const GITHUB_USERNAME = 'damedotblog'; // Your GitHub username
const GITHUB_REPO = 'dame.is'; // Your repository name
const GITHUB_BRANCH = 'main'; // Your branch name

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
        loadRecentPosts();
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
        themeToggle.textContent = '☀️';
    } else {
        themeToggle.textContent = '🌙';
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
        themeToggle.textContent = '☀️';
        localStorage.setItem('theme', 'dark');
    } else {
        themeToggle.textContent = '🌙';
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

        // Update the footer elements
        document.getElementById('version').textContent = version;
        document.getElementById('last-updated').textContent = lastUpdated;
    } catch (error) {
        console.error('Error fetching footer data:', error);
        document.getElementById('version').textContent = 'N/A';
        document.getElementById('last-updated').textContent = 'N/A';
    }
}

// Load Recent Posts on Home Page
async function loadRecentPosts() {
    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Your actual actor identifier
    const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=10&filter=posts_no_replies`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        const postsList = document.getElementById('recent-posts');

        // Clear any existing content
        postsList.innerHTML = '';

        data.feed.forEach(item => {
            const post = item.post; // Access the 'post' object

            // Ensure 'post' and 'record' exist
            if (post && post.record) {
                // Create a container for each post
                const postContainer = document.createElement('div');
                postContainer.classList.add('post');

                // Post Text
                const postText = document.createElement('p');
                postText.classList.add('post-text');
                postText.textContent = post.record.text || '[No content]';
                postContainer.appendChild(postText);

                // Created At with Bluesky Link
                const postDate = document.createElement('p');
                postDate.classList.add('post-date');

                // Extract the Post ID from the URI
                const uri = post.uri; // e.g., "at://did:plc:gq4fo3u6tqzzdkjlwzpb23tj/app.bsky.feed.post/3lep2fdto622v"
                const postId = uri.split('/').pop(); // Extracts "3lep2fdto622v"

                // Construct the Bluesky URL
                const blueskyUrl = `https://bsky.app/profile/dame.bsky.social/post/${postId}`;

                // Format the Date
                const date = new Date(post.record.createdAt || Date.now());
                const options = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' };
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
                postContainer.appendChild(postDate);

                // Counts Container
                const countsContainer = document.createElement('div');
                countsContainer.classList.add('post-counts');

                // Reply Count
                const replyCount = document.createElement('span');
                replyCount.textContent = `Replies: ${post.replyCount || 0}`;
                countsContainer.appendChild(replyCount);

                // Quote Count
                const quoteCount = document.createElement('span');
                quoteCount.textContent = `Quotes: ${post.quoteCount || 0}`;
                countsContainer.appendChild(quoteCount);

                // Like Count
                const likeCount = document.createElement('span');
                likeCount.textContent = `Likes: ${post.likeCount || 0}`;
                countsContainer.appendChild(likeCount);

                // Repost Count
                const repostCount = document.createElement('span');
                repostCount.textContent = `Reposts: ${post.repostCount || 0}`;
                countsContainer.appendChild(repostCount);

                postContainer.appendChild(countsContainer);

                // Append the post to the list
                postsList.appendChild(postContainer);
            } else {
                console.warn('Post or record missing in the feed item:', item);
            }
        });
    } catch (error) {
        console.error('Error fetching recent posts:', error);
        const postsList = document.getElementById('recent-posts');
        postsList.innerHTML = '<p>Failed to load posts. Please try again later.</p>';
    }
}


// Load Markdown Content for About and Ethos Pages
async function loadMarkdownContent() {
    const path = window.location.pathname.endsWith('about.html') ? 'about.md' : 'ethos.md';
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error('Network response was not ok');
        const markdown = await response.text();
        const htmlContent = marked.parse(markdown);
        document.getElementById(`${path.split('.')[0]}-content`).innerHTML = htmlContent;
    } catch (error) {
        console.error('Error loading Markdown content:', error);
    }
}

// Load Markdown library (marked.js)
(function loadMarkdownLibrary() {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/marked/marked.min.js';
    script.onload = () => console.log('Marked.js loaded');
    document.head.appendChild(script);
})();

// Function to Set Active Navigation Link
function setActiveNavLink() {
    // Get the current page's path
    const currentPath = window.location.pathname.split('/').pop(); // e.g., 'about.html' or ''

    // Get all navigation links
    const navLinks = document.querySelectorAll('.nav-left .nav-link');

    navLinks.forEach(link => {
        // Get the href attribute of the link
        const linkPath = link.getAttribute('href');

        // Normalize paths for comparison
        // Handle cases where linkPath might be 'index.html' or '/' for home
        if (
            (currentPath === '' && linkPath === 'index.html') ||
            (currentPath === '/' && linkPath === 'index.html') ||
            (currentPath === linkPath)
        ) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}
