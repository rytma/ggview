/**
 * Main application script for Graph Visualization Framework
 * Initializes and configures the graph visualizer
 */

let visualizer; // Global reference to the visualizer instance

/**
 * Initialize the graph visualizer with the provided data
 * @param {Object} graphData - Graph data in JGF format
 */
function initGraphVisualizer(graphData) {
    const container = document.getElementById('graph-container');

    visualizer = new GraphVisualizer(container, {
        nodeRadius: 8,
        nodeColor: '#4f46e5',
        edgeColor: '#9ca3af'
    });

    // Load data
    visualizer.loadData(graphData);

    // Bind UI controls
    bindUIControls();

    // Initialize search functionality
    initSearch();
}

/**
 * Bind UI control events
 */
function bindUIControls() {
    // Layout selector
    document.getElementById('layoutSelector').addEventListener('change', function(e) {
        visualizer.applyLayout(e.target.value);
    });

    // Reset zoom button
    document.getElementById('resetZoomBtn').addEventListener('click', function() {
        visualizer.resetZoom();
    });

    // Node size slider (if present)
    const sizeSlider = document.getElementById('nodeSizeSlider');
    if (sizeSlider) {
        sizeSlider.addEventListener('input', function(e) {
            visualizer.updateNodeSize(parseInt(e.target.value));
        });
    }
}

/**
 * Initialize search functionality
 */
function initSearch() {
    const searchBtn = document.getElementById('searchBtn');
    const searchInput = document.getElementById('searchInput');
    const searchResults = document.getElementById('searchResults');
    const clearSearchBtn = document.getElementById('clearSearchBtn');

    if (!searchBtn || !searchInput || !searchResults) return;

    // Search input event
    searchInput.addEventListener('input', debounce(function(e) {
        const term = e.target.value.trim();

        if (term.length < 2) {
            searchResults.innerHTML = '';
            return;
        }

        const results = visualizer.searchNodes(term);

        if (results.length === 0) {
            searchResults.innerHTML = '<p class="p-2 text-gray-500">No matching nodes found</p>';
            return;
        }

        // Display results
        let resultsHtml = '';

        results.slice(0, 10).forEach(node => {
            resultsHtml += `
                <div class="search-result-item" data-node-id="${node.id}">
                    <div class="font-medium">${node.label}</div>
                    <div class="text-xs text-gray-500">${node.metadata.type || 'Node'}</div>
                </div>
            `;
        });

        searchResults.innerHTML = resultsHtml;

        // Add click handlers to results
        document.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', function() {
                const nodeId = this.dataset.nodeId;
                visualizer.focusNode(nodeId);
            });
        });
    }, 300));

    // Clear search button
    if (clearSearchBtn) {
        clearSearchBtn.addEventListener('click', function() {
            searchInput.value = '';
            searchResults.innerHTML = '';
        });
    }
}

/**
 * Debounce function to limit how often a function can be called
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}
