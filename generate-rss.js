// generate-rss.js
const fs = require('fs');
const path = require('path');

// Path to your blog-index.json file
const blogIndexPath = path.join(__dirname, 'data', 'blog-index.json');
// Output RSS feed file
const outputPath = path.join(__dirname, 'feed.xml');

// Your website's base URL (update with your actual domain)
const siteUrl = 'https://yourdomain.com';

// Read the JSON file with blog posts
fs.readFile(blogIndexPath, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading blog-index.json:', err);
    return;
  }

  let blogData;
  try {
    blogData = JSON.parse(data);
  } catch (jsonError) {
    console.error('Error parsing JSON:', jsonError);
    return;
  }

  const posts = blogData.posts || [];

  // Sort posts in descending order by date (most recent first)
  posts.sort((a, b) => new Date(b.date) - new Date(a.date));

  // Get the current date for the RSS channel's lastBuildDate
  const lastBuildDate = new Date().toUTCString();

  // Generate the RSS <item> entries from your posts data
  const rssItems = posts.map(post => {
    // Construct the URL for the individual blog post.
    // Adjust the URL if your post URLs differ.
    const postUrl = `${siteUrl}/blog/${post.slug}.html`;
    // Convert the date to an RFC 822 format using toUTCString()
    const pubDate = new Date(post.date).toUTCString();

    return `
    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${postUrl}</link>
      <description>${escapeXml(post.excerpt)}</description>
      <pubDate>${pubDate}</pubDate>
      <guid>${postUrl}</guid>
    </item>`;
  }).join('');

  // Assemble the complete RSS feed
  const rssFeed = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>Dame's Blog</title>
    <link>${siteUrl}</link>
    <description>The latest posts from Dame's Blog</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    ${rssItems}
  </channel>
</rss>`;

  // Write the RSS feed to the output file
  fs.writeFile(outputPath, rssFeed.trim(), err => {
    if (err) {
      console.error('Error writing feed.xml:', err);
    } else {
      console.log('RSS feed generated successfully!');
    }
  });
});

// Helper function to escape special XML characters
function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}
