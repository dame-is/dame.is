---
layout: base
title: /logging
pinned: true
---

# /logging

<div class="log-container-wrapper">
    <div id="loading-logs">Loading logs...</div>
    <div id="log-entries"></div>
    <button id="see-more-logs" class="see-more-button">See More Logs</button>
</div>

<script>
    // Initialize the log loader when the page loads
    document.addEventListener('DOMContentLoaded', function() {
        initializeLogLoader();
    });
</script> 