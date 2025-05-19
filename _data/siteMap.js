const fs = require('fs');
const path = require('path');

// Site Map Configuration
const siteMapConfig = {
  // Directories to exclude from the site map
  excludedDirs: [
    // System/build directories
    '_site',
    '_includes',
    '_layouts',
    '_data',
    'node_modules',
    '.git',
    'images',
    'assets',
    'archive',
    'css',
    'js',
    '.github',
    
    // Add your custom excluded folders here
    // 'example-folder-to-exclude',
  ],
  
  // Specific files to exclude (relative paths from project root)
  // Use this for individual files you don't want to appear in the sitemap
  excludedFiles: [
    '404.md',
    '404.html',
    'feed.njk',
    'chip-taste-test.njk',
    'vercel.json',
    'last-updated.json',
    'LICENSE',
    '.gitignore',
    'package.json',
    'package-lock.json',
    
    // Add your custom excluded files here
    // 'example-file-to-exclude.md',
  ],
  
  // Pages that should be excluded but exist at the root level
  // Just list the filename without extension
  excludedRootPages: [
    '404',
    'feed',
    'chip-taste-test',
    'roadmap',
    'skeet-tools',
    'README',
    'resume'
    
    // Add more root pages to exclude here
    // 'example-page',
  ],
  
  // File extensions to include as pages
  pageExtensions: ['.md', '.html', '.njk'],
  
  // Show standalone files (not just directories) at the root level
  showRootFiles: true,
  
  // Hide files with the same name as their parent folder
  hideSameNameFiles: true,
  
  // Max length for display names in sitemap (for truncation)
  maxNameLength: 30
};

// Helper function to check if a path should be excluded based on directories
function shouldExcludeDir(itemPath) {
  // Convert path to segments
  const pathSegments = itemPath.split(path.sep).filter(segment => segment.length > 0);
  
  // Check if any segment matches an excluded directory
  for (const segment of pathSegments) {
    if (siteMapConfig.excludedDirs.includes(segment)) {
      return true;
    }
  }
  
  // Also check the full path against the excluded dirs
  // This helps when the full relative path is in the excluded list
  return siteMapConfig.excludedDirs.includes(itemPath);
}

// Build the site map structure
function buildSiteStructure(baseDir, relativePath = '') {
  const fullPath = path.join(baseDir, relativePath);
  
  // Skip excluded directories
  const dirName = path.basename(relativePath);
  if (shouldExcludeDir(relativePath) || siteMapConfig.excludedDirs.includes(dirName)) {
    return null;
  }
  
  // Skip files that start with a dot or are in the excluded files list
  if (dirName.startsWith('.') || 
      siteMapConfig.excludedFiles.includes(relativePath)) {
    return null;
  }
  
  try {
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      // Read directory contents
      const items = fs.readdirSync(fullPath);
      
      // Generate URL path
      const urlPath = relativePath ? `/${relativePath}` : '/';
      
      // Process all children
      const children = [];
      
      // Check if this directory has a file with the same name
      const hasSameNameFile = siteMapConfig.hideSameNameFiles && items.some(item => {
        // Get filename without extension and check if it matches directory name
        const ext = path.extname(item);
        const filename = path.basename(item, ext);
        return filename === dirName && siteMapConfig.pageExtensions.includes(ext);
      });
      
      for (const item of items) {
        const itemPath = path.join(relativePath, item);
        
        // Skip excluded files and directories early
        if (shouldExcludeDir(itemPath) || siteMapConfig.excludedFiles.includes(itemPath)) {
          continue;
        }
        
        const itemFullPath = path.join(baseDir, itemPath);
        let itemStats;
        
        try {
          itemStats = fs.statSync(itemFullPath);
        } catch (err) {
          console.warn(`Warning: Could not stat ${itemFullPath}: ${err.message}`);
          continue;
        }
        
        // If it's a directory, recursively process it
        if (itemStats.isDirectory()) {
          const childDir = buildSiteStructure(baseDir, itemPath);
          if (childDir) {
            children.push(childDir);
          }
        } 
        // If it's a valid page file, add it to children
        else if (siteMapConfig.pageExtensions.includes(path.extname(item)) && !item.startsWith('_')) {
          // Skip index files as they represent the parent directory
          if (item === 'index.md' || item === 'index.html' || item === 'index.njk') {
            continue;
          }
          
          // Skip files with the same name as their parent directory
          if (siteMapConfig.hideSameNameFiles) {
            const filename = path.basename(item, path.extname(item));
            if (filename === dirName) {
              continue;
            }
          }
          
          // Create filename without extension
          const name = path.basename(item, path.extname(item));
          const pageUrlPath = `${urlPath === '/' ? '' : urlPath}/${name}`;
          
          // Skip files that match exclusion patterns
          if (relativePath === '' && siteMapConfig.excludedRootPages.includes(name)) {
            continue;
          }
          
          children.push({
            name: name,
            path: pageUrlPath,
            isPage: true,
            children: []
          });
        }
      }
      
      // Sort children: directories first, then pages, both alphabetically
      children.sort((a, b) => {
        // Sort directories first
        if (!a.isPage && b.isPage) return -1;
        if (a.isPage && !b.isPage) return 1;
        
        // Then alphabetically by name
        return a.name.localeCompare(b.name);
      });
      
      return {
        name: dirName || 'dame.is',
        path: urlPath,
        isPage: false,
        hasChildren: children.length > 0,
        children: children
      };
    }
  } catch (error) {
    console.error(`Error processing ${fullPath}:`, error);
    return null;
  }
  
  return null;
}

module.exports = function() {
  const baseDir = path.resolve(__dirname, '..');
  const structure = buildSiteStructure(baseDir);
  
  // Add debug information - can be removed later
  console.log('Site map built with the following exclusions:');
  console.log('- Excluded directories:', siteMapConfig.excludedDirs);
  console.log('- Excluded files:', siteMapConfig.excludedFiles.length);
  console.log('- Excluded root pages:', siteMapConfig.excludedRootPages.length);
  console.log('- Hiding same-name files in folders:', siteMapConfig.hideSameNameFiles);
  
  return structure;
}; 