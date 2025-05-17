// .eleventy.js
const yaml = require("js-yaml");
const pluginRss = require("@11ty/eleventy-plugin-rss");
const markdownIt = require("markdown-it");

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

  // Date filter for formatting
  eleventyConfig.addFilter("date", function(date, format) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  });

  // Add jsDateString filter to convert date to ISO string for JavaScript use
  eleventyConfig.addFilter("jsDateString", function(date) {
    // Create a date object and ensure it has timezone information
    // This will help prevent timezone issues when displaying dates
    const dateObj = new Date(date);
    
    // Create a specific time for the date (noon UTC to avoid timezone issues)
    // This ensures that the date will be the same regardless of the timezone
    const isoDate = new Date(Date.UTC(
      dateObj.getFullYear(),
      dateObj.getMonth(),
      dateObj.getDate(),
      12, 0, 0 // noon UTC
    )).toISOString();
    
    console.log(`Converting date ${date} to ISO string: ${isoDate}`);
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