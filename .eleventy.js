// .eleventy.js
const yaml = require("js-yaml");
const pluginRss = require("@11ty/eleventy-plugin-rss");
const markdownIt = require("markdown-it");
const fs = require("fs");

module.exports = function(eleventyConfig) {
  // Configure Markdown
  const mdOptions = {
    html: true,         // Enable HTML tags in source
    breaks: true,       // Convert '\n' in paragraphs into <br>
    linkify: true       // Autoconvert URL-like text to links
  };
  
  // Configure the markdown engine
  eleventyConfig.setLibrary("md", markdownIt(mdOptions));
  
  // Pass through static assets
  eleventyConfig.addPassthroughCopy("css");
  eleventyConfig.addPassthroughCopy("js");
  eleventyConfig.addPassthroughCopy("images");
  eleventyConfig.addPassthroughCopy("assets");
  eleventyConfig.addPassthroughCopy("data");
  
  // Add support for YAML front matter
  eleventyConfig.addDataExtension("yaml", contents => yaml.load(contents));
  
  // Add RSS plugin
  eleventyConfig.addPlugin(pluginRss);
  
  // Create a collection for blog posts
  eleventyConfig.addCollection("posts", function(collectionApi) {
    return collectionApi.getFilteredByGlob("writing/posts/**/*.md")
      .sort((a, b) => new Date(b.data.date) - new Date(a.data.date));
  });

  // Create a collection for blog posts
  eleventyConfig.addCollection("blogs", function(collectionApi) {
    return collectionApi.getFilteredByGlob("writing/blogs/**/*.md")
      .sort((a, b) => new Date(b.data.date) - new Date(a.data.date));
  });

  // Create a collection for creating pages
  eleventyConfig.addCollection("creating", function(collectionApi) {
    return collectionApi.getFilteredByGlob("creating/**/*.md")
      .sort((a, b) => new Date(b.data.date) - new Date(a.data.date));
  });

  // Filter for filtering pages by folder
  eleventyConfig.addFilter("filterByFolder", function(collection, folderPath) {
    if (!collection || !collection.length) {
      return [];
    }
    
    return collection.filter(item => {
      return item.inputPath.includes(folderPath) && !item.inputPath.endsWith(`/${folderPath}.md`);
    });
  });

  // Get last modified date from git if available, otherwise from filesystem
  eleventyConfig.addFilter("lastModifiedDate", function(inputPath) {
    try {
      // Remove the leading ./ from inputPath if present
      const cleanPath = inputPath.replace(/^\.\//, '');
      
      // Try to get date from git first (more accurate for content changes)
      try {
        const { execSync } = require('child_process');
        const gitDate = execSync(`git log -1 --format=%cd --date=iso ${cleanPath}`, { 
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
        
        if (gitDate) {
          return new Date(gitDate);
        }
      } catch (gitErr) {
        // If git command fails, silently fall back to filesystem
      }
      
      // Fall back to filesystem date
      const stat = fs.statSync(cleanPath);
      return stat.mtime;
    } catch (e) {
      console.warn(`Warning: Couldn't get last modified date for ${inputPath}`);
      return new Date();
    }
  });

  // Date filter for formatting
  eleventyConfig.addFilter("date", function(date, format) {
    if (!date) return '';
    
    // Handle string dates in various formats
    const dateObj = new Date(date);
    
    // Check if valid date
    if (isNaN(dateObj.getTime())) {
      console.warn(`Warning: Invalid date: ${date}`);
      return date; // Return the original string if it's not a valid date
    }
    
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  });

  // Add enhanced date filter that includes relative time and day count
  eleventyConfig.addFilter("enhancedDate", function(date) {
    if (!date) return '';
    
    // Handle string dates in various formats
    const dateObj = new Date(date);
    
    // Check if valid date
    if (isNaN(dateObj.getTime())) {
      console.warn(`Warning: Invalid date format for enhanced date: ${date}`);
      return date; // Return the original string if it's not a valid date
    }
    
    // Format the date
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    
    // Calculate days since a reference date (birthdate or any starting point)
    const birthdate = new Date('1993-06-02'); // Example birthdate
    const daysSince = Math.floor((dateObj - birthdate) / (1000 * 60 * 60 * 24));
    
    // Calculate relative time
    const now = new Date();
    const diffInSeconds = Math.floor((now - dateObj) / 1000);
    
    const intervals = [
      { label: 'year', seconds: 31536000 },
      { label: 'month', seconds: 2592000 },
      { label: 'week', seconds: 604800 },
      { label: 'day', seconds: 86400 },
      { label: 'hour', seconds: 3600 },
      { label: 'minute', seconds: 60 },
      { label: 'second', seconds: 1 }
    ];
    
    let relativeTime = 'Just now';
    
    for (const interval of intervals) {
      const count = Math.floor(diffInSeconds / interval.seconds);
      if (count >= 1) {
        // Format the relative time with first letter capitalized
        const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        let formatted = formatter.format(-count, interval.label);
        relativeTime = formatted.charAt(0).toUpperCase() + formatted.slice(1);
        break;
      }
    }
    
    return `${relativeTime}, ${formattedDate} (Day ${daysSince})`;
  });

  // Add jsDateString filter to convert date to ISO string for JavaScript use
  eleventyConfig.addFilter("jsDateString", function(date) {
    if (!date) return '';
    
    // Create a date object and ensure it has timezone information
    // This will help prevent timezone issues when displaying dates
    const dateObj = new Date(date);
    
    // Check if valid date
    if (isNaN(dateObj.getTime())) {
      console.warn(`Warning: Invalid date format for jsDateString: ${date}`);
      return ''; // Return empty string for invalid dates
    }
    
    // Create a specific time for the date (noon UTC to avoid timezone issues)
    // This ensures that the date will be the same regardless of the timezone
    const isoDate = new Date(Date.UTC(
      dateObj.getFullYear(),
      dateObj.getMonth(),
      dateObj.getDate(),
      12, 0, 0 // noon UTC
    )).toISOString();
    
    return isoDate;
  });

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts"
    }
  };
};