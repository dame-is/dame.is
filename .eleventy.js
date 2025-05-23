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
  eleventyConfig.addPassthroughCopy({
    "assets": "assets",
    "_data/koans": "_data/koans"  // Pass through koans directory without processing
  });
  
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

  // Add filter to get subfolder name
  eleventyConfig.addFilter("getSubfolder", function(inputPath) {
    if (!inputPath) return '';
    
    // Remove leading ./ if present
    const cleanPath = inputPath.replace(/^\.\//, '');
    
    // Split by slashes
    const parts = cleanPath.split('/');
    
    // If there are at least 2 parts (base folder and subfolder)
    if (parts.length >= 2) {
      // Return the second part (subfolder)
      return parts[1];
    }
    
    return '';
  });

  // Add exec filter to execute shell commands (mainly for git operations)
  eleventyConfig.addFilter("exec", function(command) {
    try {
      const { execSync } = require('child_process');
      const output = execSync(command, { 
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      }).trim();
      return output;
    } catch (error) {
      console.warn(`Error executing command "${command}": ${error.message}`);
      return '';
    }
  });

  // Split filter for filepath segments
  eleventyConfig.addFilter("split", function(string, separator) {
    if (!string) return [];
    return string.split(separator);
  });

  // Filter array elements
  eleventyConfig.addFilter("filter", function(array) {
    if (!array || !Array.isArray(array)) return [];
    return array.filter(item => item && item !== '');
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
        console.log(`Getting git last modified date for: ${cleanPath}`);
        // Use a more specific git command with rfc format for better date handling
        const gitDate = execSync(`git log -1 --format=%aI -- ${cleanPath}`, { 
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore']
        }).trim();
        
        if (gitDate) {
          console.log(`Found git last modified date: ${gitDate} for ${cleanPath}`);
          return new Date(gitDate);
        } else {
          console.log(`No git history found for: ${cleanPath}`);
        }
      } catch (gitErr) {
        // Log the error for debugging
        console.warn(`Git command failed for ${cleanPath}: ${gitErr.message}`);
      }
      
      // Fall back to filesystem date
      console.log(`Falling back to filesystem date for: ${cleanPath}`);
      const stat = fs.statSync(cleanPath);
      return stat.mtime;
    } catch (e) {
      console.warn(`Warning: Couldn't get last modified date for ${inputPath}: ${e.message}`);
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
    
    // If format is "relative", return a human-readable relative time
    if (format === "relative") {
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
      
      for (const interval of intervals) {
        const count = Math.floor(diffInSeconds / interval.seconds);
        if (count >= 1) {
          const plural = count === 1 ? '' : 's';
          return `${count} ${interval.label}${plural} ago`;
        }
      }
      return 'just now';
    }
    
    // For default format, return a formatted date string
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  });

  // Function to normalize a date to UTC noon
  function normalizeToUTCNoon(date) {
    // If the date already has a time component (hours, minutes, seconds), preserve it
    if (date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0) {
      return date;
    }
    // Otherwise, set to noon UTC
    return new Date(Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      12, 0, 0 // noon UTC
    ));
  }

  // Define birthdate for day of life calculations
  const BIRTHDATE = new Date('1993-05-07T00:00:00Z');

  // Function for day of life calculation
  function getDaysSinceBirthdate(date) {
    const msPerDay = 24 * 60 * 60 * 1000;
    // Normalize both dates to UTC noon for consistent comparison
    const normalizedDate = normalizeToUTCNoon(date);
    const normalizedBirthdate = normalizeToUTCNoon(BIRTHDATE);
    
    // Create UTC date numbers for both dates
    const utcBirthDate = Date.UTC(normalizedBirthdate.getUTCFullYear(), normalizedBirthdate.getUTCMonth(), normalizedBirthdate.getUTCDate());
    const utcCurrentDate = Date.UTC(normalizedDate.getUTCFullYear(), normalizedDate.getUTCMonth(), normalizedDate.getUTCDate());
    return Math.floor((utcCurrentDate - utcBirthDate) / msPerDay);
  }

  // Function for year of life calculation
  function getYearOfLife(date) {
    // Normalize both dates to UTC noon for consistent comparison
    const normalizedDate = normalizeToUTCNoon(date);
    const normalizedBirthdate = normalizeToUTCNoon(BIRTHDATE);
    
    let age = normalizedDate.getUTCFullYear() - normalizedBirthdate.getUTCFullYear();
    const m = normalizedDate.getUTCMonth() - normalizedBirthdate.getUTCMonth();
    if (m < 0 || (m === 0 && normalizedDate.getUTCDate() < normalizedBirthdate.getUTCDate())) {
      age--;
    }
    return age;
  }

  // Function to get relative time
  function getRelativeTime(date) {
    // Get current time in UTC
    const now = new Date();
    const nowUTC = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
      now.getUTCSeconds()
    ));
    
    // Normalize input date to UTC noon if needed
    const normalizedDate = normalizeToUTCNoon(date);
    
    const diffInSeconds = Math.floor((nowUTC - normalizedDate) / 1000);
    
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
        const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
        let formatted = formatter.format(-count, interval.label);
        return formatted.charAt(0).toUpperCase() + formatted.slice(1);
      }
    }
    return 'Just now';
  }

  // Function to format full date
  function formatFullDate(date) {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  // Function to format date for folder view
  function formatFolderDate(date) {
    const relativeTime = getRelativeTime(date);
    const formattedDate = formatFullDate(date);
    const dayOfLife = getDaysSinceBirthdate(date);
    const yearOfLife = getYearOfLife(date);
    
    return {
      primary: `${relativeTime}, ${formattedDate}`,
      secondary: `Day ${dayOfLife}, Year ${yearOfLife}`
    };
  }

  // Add custom filters
  eleventyConfig.addFilter("enhancedDate", function(date) {
    if (!date) return '';
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return '';
    
    // Use the formatFolderDate function
    const formatted = formatFolderDate(dateObj);
    return formatted.primary;
  });

  eleventyConfig.addFilter("jsDateString", function(date) {
    if (!date) return '';
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return '';
    
    // Normalize to UTC noon for consistent comparison
    return normalizeToUTCNoon(dateObj).toISOString();
  });

  eleventyConfig.addFilter("dayOfLife", function(date) {
    if (!date) return '';
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return '';
    
    // Normalize to UTC noon for consistent comparison
    const normalizedDate = normalizeToUTCNoon(dateObj);
    return getDaysSinceBirthdate(normalizedDate);
  });

  eleventyConfig.addFilter("yearOfLife", function(date) {
    if (!date) return '';
    const dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) return '';
    
    // Normalize to UTC noon for consistent comparison
    const normalizedDate = normalizeToUTCNoon(dateObj);
    return getYearOfLife(normalizedDate);
  });

  // Add filter to get pinned pages
  eleventyConfig.addFilter("filterPinned", function(collection) {
    return collection.filter(item => item.data.pinned === true);
  });

  // Generate site structure JSON file
  eleventyConfig.addPassthroughCopy("js");
  eleventyConfig.addPassthroughCopy("css");
  
  // Generate the site structure JSON file for client-side use
  eleventyConfig.addJavaScriptFunction("generateSiteStructureJson", function(data) {
    return JSON.stringify(data.siteMap);
  });

  // Output the site structure as a JSON file
  eleventyConfig.addShortcode("siteStructureJson", function() {
    return `<script type="application/json" id="site-structure-data">
      ${JSON.stringify(this.siteMap)}
    </script>`;
  });

  // Write the site structure to a JSON file during build
  eleventyConfig.on('eleventy.after', async ({ dir, results }) => {
    const fs = require('fs');
    const path = require('path');
    
    // Get the site structure from your data file
    const siteMap = require('./_data/siteMap.js')();
    
    // Write it to the output directory
    const outputPath = path.join(dir.output, 'site-structure.json');
    fs.writeFileSync(outputPath, JSON.stringify(siteMap, null, 2));
    
    console.log('Site structure JSON generated at:', outputPath);
  });

  // Ignore markdown files in _data/koans
  eleventyConfig.ignores.add("_data/koans/*.md");

  return {
    dir: {
      input: ".",
      output: "_site",
      includes: "_includes",
      layouts: "_layouts"
    }
  };
};