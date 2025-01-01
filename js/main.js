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
    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Replace with your actual actor identifier
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
    // Set version number
    document.getElementById('version').textContent = '1.0.0'; // Update manually or automate

    // Fetch last commit timestamp from GitHub API
    fetchLastUpdated();
}

// Fetch last updated timestamp using GitHub API
async function fetchLastUpdated() {
    const repo = 'dame.is'; // Replace with your repo name if different
    const user = 'damedotblog'; // Replace with your GitHub username

    // Determine the current page's filename
    let page = window.location.pathname.split('/').pop();
    if (page === '') page = 'index.html'; // Default to index.html

    const apiUrl = `https://api.github.com/repos/${user}/${repo}/commits?path=${page}&per_page=1`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        if (data.length > 0) {
            const lastUpdated = new Date(data[0].commit.committer.date);
            document.getElementById('last-updated').textContent = lastUpdated.toLocaleString();
        } else {
            document.getElementById('last-updated').textContent = 'N/A';
        }
    } catch (error) {
        console.error('Error fetching last updated:', error);
    }
}

// Load Recent Posts on Home Page
async function loadRecentPosts() {
    const actor = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj'; // Replace with your actual actor identifier
    const apiUrl = `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(actor)}&limit=10&filter=posts_no_replies`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Network response was not ok');
        const data = await response.json();
        const postsList = document.getElementById('recent-posts');

        data.feed.forEach(post => {
            // Create a container for each post
            const postContainer = document.createElement('div');
            postContainer.classList.add('post');

            // Post Text
            const postText = document.createElement('p');
            postText.classList.add('post-text');
            postText.textContent = post.record.text;
            postContainer.appendChild(postText);

            // Created At
            const postDate = document.createElement('p');
            postDate.classList.add('post-date');
            const date = new Date(post.record.createdAt);
            const options = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' };
            postDate.textContent = `Posted on ${date.toLocaleDateString(undefined, options)}`;
            postContainer.appendChild(postDate);

            // Counts
            const countsContainer = document.createElement('div');
            countsContainer.classList.add('post-counts');

            const replyCount = document.createElement('span');
            replyCount.textContent = `Replies: ${post.stats.replyCount}`;
            countsContainer.appendChild(replyCount);

            const quoteCount = document.createElement('span');
            quoteCount.textContent = `Quotes: ${post.stats.quoteCount}`;
            countsContainer.appendChild(quoteCount);

            const likeCount = document.createElement('span');
            likeCount.textContent = `Likes: ${post.stats.likeCount}`;
            countsContainer.appendChild(likeCount);

            const repostCount = document.createElement('span');
            repostCount.textContent = `Reposts: ${post.stats.repostCount}`;
            countsContainer.appendChild(repostCount);

            postContainer.appendChild(countsContainer);

            // Append the post to the list
            postsList.appendChild(postContainer);
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
