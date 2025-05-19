// Site Map Component for dame.is
// This script creates an interactive site map with collapsible sections

document.addEventListener('DOMContentLoaded', () => {
  initializeSiteMap();
});

function initializeSiteMap() {
  const siteMapContainer = document.getElementById('site-map');
  if (!siteMapContainer) return;

  // Get the current page path
  const currentPath = window.location.pathname;

  // First try to get data from the inline script
  const inlineData = document.getElementById('site-structure-data');
  if (inlineData) {
    try {
      const siteStructure = JSON.parse(inlineData.textContent);
      renderSiteMap(siteMapContainer, siteStructure, currentPath);
      return;
    } catch (error) {
      console.warn('Error parsing inline site structure data:', error);
      // Fall through to fetch method
    }
  }

  // If inline data not available or failed to parse, fetch the site structure file
  fetch('/site-structure.json')
    .then(response => {
      if (!response.ok) {
        throw new Error('Failed to load site structure');
      }
      return response.json();
    })
    .then(siteStructure => {
      renderSiteMap(siteMapContainer, siteStructure, currentPath);
    })
    .catch(error => {
      console.error('Error loading site structure:', error);
      
      // Use static fallback structure if both methods fail
      const fallbackStructure = {
        name: 'dame.is',
        path: '/',
        isPage: false,
        hasChildren: true,
        children: [
          {
            name: 'creating',
            path: '/creating',
            isPage: false,
            hasChildren: false,
            children: []
          },
          {
            name: 'writing',
            path: '/writing',
            isPage: false,
            hasChildren: false,
            children: []
          },
          {
            name: 'sharing',
            path: '/sharing',
            isPage: false,
            hasChildren: false,
            children: []
          },
          {
            name: 'supported',
            path: '/supported',
            isPage: false,
            hasChildren: false,
            children: []
          }
        ]
      };
      
      renderSiteMap(siteMapContainer, fallbackStructure, currentPath);
    });
}

function renderSiteMap(container, structure, currentPath) {
  // Create the root element
  const rootElement = document.createElement('div');
  rootElement.className = 'site-map-root';
  
  // Create the root node
  const rootNode = document.createElement('div');
  rootNode.className = 'site-map-node root-node';
  
  // Check if we're on the homepage
  const isHomePage = currentPath === '/' || currentPath === '';
  
  const rootLink = document.createElement('a');
  rootLink.href = '/';
  rootLink.className = 'site-map-link root-link' + (isHomePage ? ' active' : '');
  rootLink.textContent = 'dame.is';
  
  rootNode.appendChild(rootLink);
  rootElement.appendChild(rootNode);
  
  // Create a container for the first-level items
  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'site-map-children';
  
  // Track if any page in this section is active
  let hasActivePage = false;
  
  // Add each first-level item
  if (structure && structure.children) {
    structure.children.forEach(item => {
      const { node: itemNode, isActive } = createMapNode(item, currentPath);
      childrenContainer.appendChild(itemNode);
      
      if (isActive) {
        hasActivePage = true;
      }
    });
  }
  
  rootElement.appendChild(childrenContainer);
  container.appendChild(rootElement);
  
  // After rendering, expand all parent folders of active items
  expandActivePathFolders();
}

function createMapNode(item, currentPath) {
  const nodeContainer = document.createElement('div');
  nodeContainer.className = 'site-map-node-container';
  
  const node = document.createElement('div');
  node.className = 'site-map-node';
  
  // Check if this node is active (or contains active nodes)
  const isDirectMatch = item.path === currentPath || 
                        currentPath.startsWith(item.path + '/');
  
  let containsActivePage = isDirectMatch;
  
  // Create the link
  const link = document.createElement('a');
  link.href = item.path;
  link.className = 'site-map-link';
  
  // Add active class if this is the current page
  if (isDirectMatch && item.path === currentPath) {
    link.classList.add('active');
  }
  
  link.textContent = item.name;
  
  // Add icon or visual indicator for pages vs folders
  if (item.isPage) {
    link.classList.add('page-link');
  } else {
    const folderClass = 'folder-link' + (isDirectMatch ? ' active' : '');
    link.classList.add(...folderClass.split(' '));
  }
  
  // Add data attributes for expanding parent folders later
  if (isDirectMatch) {
    link.setAttribute('data-active-path', 'true');
  }
  
  node.appendChild(link);
  
  // If the item has children, add a toggle button
  if (item.hasChildren && item.children && item.children.length > 0) {
    const toggleButton = document.createElement('button');
    toggleButton.className = 'site-map-toggle';
    toggleButton.innerHTML = '<span class="toggle-icon">+</span>';
    toggleButton.setAttribute('aria-label', `Toggle ${item.name} submenu`);
    
    node.appendChild(toggleButton);
    
    // Create the children container (initially collapsed)
    const childrenContainer = document.createElement('div');
    // If this is in the active path, don't collapse it initially
    childrenContainer.className = isDirectMatch ? 'site-map-children' : 'site-map-children collapsed';
    
    // Add each child and track if any are active
    item.children.forEach(child => {
      const { node: childNode, isActive } = createMapNode(child, currentPath);
      childrenContainer.appendChild(childNode);
      
      if (isActive) {
        containsActivePage = true;
      }
    });
    
    nodeContainer.appendChild(node);
    nodeContainer.appendChild(childrenContainer);
    
    // Add event listener to toggle button
    toggleButton.addEventListener('click', (e) => {
      e.preventDefault();
      childrenContainer.classList.toggle('collapsed');
      
      // Update the toggle icon
      const toggleIcon = toggleButton.querySelector('.toggle-icon');
      if (childrenContainer.classList.contains('collapsed')) {
        toggleIcon.textContent = '+';
      } else {
        toggleIcon.textContent = '−'; // This is a minus sign, not a hyphen
      }
    });
    
    // Update the toggle button state
    const toggleIcon = toggleButton.querySelector('.toggle-icon');
    toggleIcon.textContent = childrenContainer.classList.contains('collapsed') ? '+' : '−';
  } else {
    nodeContainer.appendChild(node);
  }
  
  return { node: nodeContainer, isActive: containsActivePage };
}

// Function to expand all parent folders of active items
function expandActivePathFolders() {
  const activeElements = document.querySelectorAll('[data-active-path="true"]');
  
  activeElements.forEach(element => {
    // Find all parent site-map-children containers and remove the collapsed class
    let parent = element.parentElement;
    
    while (parent) {
      // Find the closest site-map-children container
      const container = parent.closest('.site-map-children');
      if (!container) break;
      
      // Remove collapsed class
      container.classList.remove('collapsed');
      
      // Update the toggle button if it exists
      const toggleButton = container.previousElementSibling?.querySelector('.site-map-toggle');
      if (toggleButton) {
        const toggleIcon = toggleButton.querySelector('.toggle-icon');
        if (toggleIcon) {
          toggleIcon.textContent = '−'; // Minus sign for expanded
        }
      }
      
      // Move up the tree
      parent = container.parentElement;
    }
  });
} 