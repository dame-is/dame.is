const fs = require('fs');
const path = require('path');

// Get all koan files from the koans directory
module.exports = function() {
    const koansDir = path.join(__dirname, 'koans');
    const koanFiles = fs.readdirSync(koansDir)
        .filter(file => file.endsWith('.md'))
        .sort((a, b) => {
            // Extract numbers from filenames for proper numerical sorting
            const numA = parseInt(a.match(/^(\d+)_/)?.[1] || 0);
            const numB = parseInt(b.match(/^(\d+)_/)?.[1] || 0);
            return numA - numB;
        })
        .map(file => `/_data/koans/${file}`);
    
    return koanFiles;
}; 