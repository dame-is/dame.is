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
    return collectionApi.getFilteredByGlob("blog/**/*.md")
      .sort((a, b) => new Date(b.data.date) - new Date(a.data.date));
  });

  // Date filter for formatting
  eleventyConfig.addFilter("date", function(date, format) {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
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