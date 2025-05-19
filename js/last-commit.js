async function updateLastCommit() {
    try {
        const response = await fetch('https://api.github.com/repos/dame-is/dame.is/commits/main');
        const data = await response.json();
        
        const commitDate = new Date(data.commit.author.date);
        const relativeTime = getRelativeTimeString(commitDate);
        
        const commitElement = document.querySelector('.last-updated-timestamp');
        if (commitElement) {
            const commitUrl = data.html_url;
            const commitHash = data.sha.substring(0, 7);
            
            commitElement.innerHTML = `
                <span title="${commitDate.toLocaleString()}">${relativeTime}
                    (<a href="${commitUrl}" target="_blank">${commitHash}</a>)
                </span>
            `;
        }
    } catch (error) {
        console.error('Error fetching commit info:', error);
    }
}

function getRelativeTimeString(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    const intervals = {
        year: 31536000,
        month: 2592000,
        week: 604800,
        day: 86400,
        hour: 3600,
        minute: 60
    };
    
    for (const [unit, seconds] of Object.entries(intervals)) {
        const interval = Math.floor(diffInSeconds / seconds);
        if (interval >= 1) {
            return interval === 1 ? `${interval} ${unit} ago` : `${interval} ${unit}s ago`;
        }
    }
    
    return 'just now';
}

// Update on page load
document.addEventListener('DOMContentLoaded', updateLastCommit);

// Update every 5 minutes
setInterval(updateLastCommit, 300000); 