/**
 * Graph Visualization Framework
 * A D3-based interactive graph visualization tool
 */

class GraphVisualizer {
    /**
     * Create a new graph visualizer
     * @param {HTMLElement} container - The container element for the visualization
     * @param {Object} config - Configuration options
     */
    constructor(container, config = {}) {
        this.container = container;
        this.config = {
            nodeRadius: 8,
            nodeColor: '#4CAF50',
            edgeColor: '#9ca3af',
            edgeWidth: 1.5,
            arrowSize: 6, 
            labelFontSize: 10,
            ...config
        };
        
        // Data
        this.data = null;
        this.nodes = [];
        this.edges = [];
        this.nodeMap = new Map();
        
        // Elements
        this.svg = null;
        this.zoomGroup = null;
        this.nodeGroup = null;
        this.edgeGroup = null;
        this.labelGroup = null;
        this.tooltip = document.getElementById('node-tooltip');
        
        // Initialize
        this.initVisualization();
    }
    
    /**
     * Initialize the visualization components
     */
    initVisualization() {
        // Calculate dimensions
        this.width = this.container.clientWidth;
        this.height = this.container.clientHeight;
        
        // Create SVG
        this.svg = d3.select(this.container)
            .append('svg')
            .attr('width', this.width)
            .attr('height', this.height)
            .attr('class', 'graph-svg');
        
        // Create zoom behavior
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 8])
            .on('zoom', (event) => {
                this.zoomGroup.attr('transform', event.transform);
            });
        
        // Apply zoom
        this.svg.call(this.zoom);
        
        // Create groups for visualization elements
        this.zoomGroup = this.svg.append('g');
        this.edgeGroup = this.zoomGroup.append('g').attr('class', 'edges');
        this.nodeGroup = this.zoomGroup.append('g').attr('class', 'nodes');
        this.labelGroup = this.zoomGroup.append('g').attr('class', 'labels');
        
        // Create arrow marker for directed edges
        this.svg.append('defs')
            .append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '0 -5 10 10')
            .attr('refX', 20)
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', this.config.arrowSize)
            .attr('markerHeight', this.config.arrowSize)
            .append('path')
            .attr('d', 'M0,-5L10,0L0,5')
            .attr('fill', this.config.edgeColor);
        
        // Initialize simulation
        this.simulation = d3.forceSimulation()
            .force('charge', d3.forceManyBody().strength(-100))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(d => this.config.nodeRadius * 1.5))
            .on('tick', () => this.updatePositions());
    }
    
    /**
     * Load graph data into the visualization
     * @param {Object} data - Graph data in JGF format
     */
    loadData(data) {
        if (!data || !data.graph) {
            console.error('Invalid graph data format');
            return;
        }
        
        this.data = data;
        this.processData();
        this.render();
        this.applyLayout('force');
    }
    
    /**
     * Process the graph data into a format suitable for D3
     */
    processData() {
        const nodeData = this.data.graph.nodes || {};
        const edgeData = this.data.graph.edges || [];
        
        // Process nodes
        this.nodes = Object.entries(nodeData).map(([id, node]) => {
            return {
                id: id,
                label: node.label || id,
                metadata: node.metadata || {},
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                color: this.getNodeColor(node)
            };
        });
        
        // Create map for quick node lookup
        this.nodeMap = new Map(this.nodes.map(node => [node.id, node]));
        
        // Process edges
        this.edges = edgeData.map(edge => {
            const source = this.nodeMap.get(edge.source);
            const target = this.nodeMap.get(edge.target);
            
            if (!source || !target) {
                console.warn(`Edge references non-existent node: ${edge.source} -> ${edge.target}`);
                return null;
            }
            
            return {
                source,
                target,
                relation: edge.relation || 'relates_to',
                directed: edge.directed ?? this.data.graph.directed ?? true
            };
        }).filter(Boolean);
    }
    
    /**
     * Render the graph visualization
     */
    render() {
        // Clear existing elements
        this.nodeGroup.selectAll('*').remove();
        this.edgeGroup.selectAll('*').remove();
        this.labelGroup.selectAll('*').remove();
        
        // Draw edges
        this.edgeElements = this.edgeGroup
            .selectAll('line')
            .data(this.edges)
            .enter()
            .append('line')
            .attr('class', 'edge')
            .attr('stroke', this.config.edgeColor)
            .attr('stroke-width', this.config.edgeWidth)
            .attr('marker-end', d => d.directed ? 'url(#arrowhead)' : null)
            .on('mouseover', (event, d) => {
                d3.select(event.target).classed('highlight', true);
                this.showEdgeTooltip(event, d);
            })
            .on('mouseout', (event) => {
                d3.select(event.target).classed('highlight', false);
                this.hideTooltip();
            });
        
        // Draw nodes
        this.nodeElements = this.nodeGroup
            .selectAll('circle')
            .data(this.nodes)
            .enter()
            .append('circle')
            .attr('class', d => `node node-${(d.metadata.type || 'default').toLowerCase()}`)
            .attr('r', this.config.nodeRadius)
            .attr('fill', d => d.color)
            .attr('stroke', '#fff')
            .attr('stroke-width', 1.5)
            .call(d3.drag()
                .on('start', (event, d) => this.dragStarted(event, d))
                .on('drag', (event, d) => this.dragged(event, d))
                .on('end', (event, d) => this.dragEnded(event, d))
            )
            .on('mouseover', (event, d) => {
                d3.select(event.target).classed('node-highlight', true);
                this.showNodeTooltip(event, d);
            })
            .on('mouseout', (event) => {
                d3.select(event.target).classed('node-highlight', false);
                this.hideTooltip();
            })
            .on('click', (event, d) => this.nodeClicked(event, d));
        
        // Draw labels
        this.labelElements = this.labelGroup
            .selectAll('text')
            .data(this.nodes)
            .enter()
            .append('text')
            .text(d => d.label)
            .attr('font-size', this.config.labelFontSize)
            .attr('dx', this.config.nodeRadius + 2)
            .attr('dy', 4)
            .attr('fill', '#4b5563')
            .style('pointer-events', 'none'); // Make labels non-interactive
    }
    
    /**
     * Update positions of nodes and edges during simulation
     */
    updatePositions() {
        // Update edges
        this.edgeElements
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
        
        // Update nodes
        this.nodeElements
            .attr('cx', d => d.x)
            .attr('cy', d => d.y);
        
        // Update labels
        this.labelElements
            .attr('x', d => d.x)
            .attr('y', d => d.y);
    }
    
    /**
     * Apply a layout algorithm to the graph
     * @param {string} layoutType - Type of layout to apply
     */
    applyLayout(layoutType) {
        // Stop any current simulation
        this.simulation.stop();
        
        // Reset fixed positions
        this.nodes.forEach(node => {
            node.fx = null;
            node.fy = null;
        });
        
        // Apply the selected layout
        switch (layoutType) {
            case 'force':
                this.forceDirectedLayout();
                break;
            case 'circular':
                this.circularLayout();
                break;
            case 'grid':
                this.gridLayout();
                break;
            case 'tree':
                this.treeLayout();
                break;
            default:
                this.forceDirectedLayout();
        }
    }
    
    /**
     * Apply force-directed layout
     */
    forceDirectedLayout() {
        // Configure force layout
        this.simulation
            .nodes(this.nodes)
            .force('link', d3.forceLink(this.edges)
                .id(d => d.id)
                .distance(100)
            )
            .alpha(1)
            .restart();
    }
    
    /**
     * Apply circular layout
     */
    circularLayout() {
        const radius = Math.min(this.width, this.height) * 0.4;
        const angleStep = (2 * Math.PI) / this.nodes.length;
        
        this.nodes.forEach((node, i) => {
            node.x = this.width / 2 + radius * Math.cos(i * angleStep);
            node.y = this.height / 2 + radius * Math.sin(i * angleStep);
            node.fx = node.x;
            node.fy = node.y;
        });
        
        // Run simulation briefly to handle edges
        this.simulation
            .nodes(this.nodes)
            .force('link', d3.forceLink(this.edges)
                .id(d => d.id)
                .distance(100)
            )
            .alpha(0.1)
            .restart();
        
        setTimeout(() => this.simulation.stop(), 300);
    }
    
    /**
     * Apply grid layout
     */
    gridLayout() {
        const cols = Math.ceil(Math.sqrt(this.nodes.length));
        const padding = Math.min(this.width, this.height) * 0.1;
        const cellWidth = (this.width - padding * 2) / cols;
        const cellHeight = (this.height - padding * 2) / cols;
        
        this.nodes.forEach((node, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            node.x = padding + col * cellWidth + cellWidth / 2;
            node.y = padding + row * cellHeight + cellHeight / 2;
            node.fx = node.x;
            node.fy = node.y;
        });
        
        // Run simulation briefly to handle edges
        this.simulation
            .nodes(this.nodes)
            .force('link', d3.forceLink(this.edges)
                .id(d => d.id)
                .distance(100)
            )
            .alpha(0.1)
            .restart();
        
        setTimeout(() => this.simulation.stop(), 300);
    }
    
    /**
     * Apply tree layout (hierarchical)
     */
    treeLayout() {
        if (this.nodes.length === 0) return;
        
        // Find a good root node - preferably one with many outgoing edges
        let rootId = this.findRootNode();
        let root = this.nodeMap.get(rootId);
        
        // Track nodes that have been positioned
        const positioned = new Set([rootId]);
        const levels = {};
        levels[0] = [root];
        
        // Position root
        root.x = this.width / 2;
        root.y = 50;
        root.fx = root.x;
        root.fy = root.y;
        
        // BFS to position nodes by level
        const maxLevels = 5; // Prevent infinite loops
        
        for (let level = 0; level < maxLevels; level++) {
            const nodesAtLevel = levels[level] || [];
            if (nodesAtLevel.length === 0) break;
            
            levels[level + 1] = [];
            
            // For each node at this level, position its children
            nodesAtLevel.forEach(node => {
                // Find outgoing edges
                const outgoingEdges = this.edges.filter(e => e.source.id === node.id);
                const children = outgoingEdges
                    .map(e => e.target)
                    .filter(target => !positioned.has(target.id));
                
                // Position children
                if (children.length) {
                    const levelY = 100 + level * 100;
                    const width = Math.min(this.width - 100, children.length * 80);
                    const startX = Math.max(50, (this.width - width) / 2);
                    
                    children.forEach((child, i) => {
                        child.x = startX + (i * width / Math.max(1, children.length - 1));
                        child.y = levelY;
                        child.fx = child.x;
                        child.fy = child.y;
                        
                        positioned.add(child.id);
                        levels[level + 1].push(child);
                    });
                }
            });
        }
        
        // Position any remaining nodes in a grid at the bottom
        const remainingNodes = this.nodes.filter(node => !positioned.has(node.id));
        
        if (remainingNodes.length) {
            const cols = Math.ceil(Math.sqrt(remainingNodes.length));
            const padding = 50;
            const bottom = this.height - padding;
            const cellWidth = (this.width - padding * 2) / Math.max(1, cols);
            
            remainingNodes.forEach((node, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                node.x = padding + col * cellWidth + cellWidth / 2;
                node.y = bottom - row * 80;
                node.fx = node.x;
                node.fy = node.y;
            });
        }
        
        // Run simulation briefly to handle edges
        this.simulation
            .nodes(this.nodes)
            .force('link', d3.forceLink(this.edges)
                .id(d => d.id)
                .distance(100)
            )
            .alpha(0.1)
            .restart();
        
        setTimeout(() => this.simulation.stop(), 300);
    }
    
    /**
     * Find a suitable root node for hierarchical layouts
     * @returns {string} ID of the selected root node
     */
    findRootNode() {
        // Count outgoing edges for each node
        const outDegrees = {};
        this.edges.forEach(edge => {
            outDegrees[edge.source.id] = (outDegrees[edge.source.id] || 0) + 1;
        });
        
        // Find node with highest out-degree
        let maxOutDegree = 0;
        let rootId = this.nodes[0].id;
        
        for (const [nodeId, outDegree] of Object.entries(outDegrees)) {
            if (outDegree > maxOutDegree) {
                maxOutDegree = outDegree;
                rootId = nodeId;
            }
        }
        
        return rootId;
    }
    
    /**
     * Handle the start of node dragging
     */
    dragStarted(event, node) {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        node.fx = node.x;
        node.fy = node.y;
    }
    
    /**
     * Handle node dragging
     */
    dragged(event, node) {
        node.fx = event.x;
        node.fy = event.y;
    }
    
    /**
     * Handle the end of node dragging
     */
    dragEnded(event, node) {
        if (!event.active) this.simulation.alphaTarget(0);
        // Keep the node fixed where it was dragged
        // node.fx = null;
        // node.fy = null;
    }
    
    /**
     * Handle node click event
     */
    nodeClicked(event, node) {
        // Show node details
        this.showNodeDetails(node);
        
        // Highlight connected edges and nodes
        this.highlightConnections(node);
        
        // Dispatch custom event
        const clickEvent = new CustomEvent('nodeSelected', { detail: node });
        this.container.dispatchEvent(clickEvent);
    }
    
    /**
     * Show node tooltip
     */
    showNodeTooltip(event, node) {
        if (!this.tooltip) return;
        
        const content = `
            <div class="font-medium">${node.label}</div>
            <div class="text-xs text-gray-500">${node.metadata.type || 'Node'}</div>
            ${this.getNodeTooltipDetails(node)}
        `;
        
        this.tooltip.innerHTML = content;
        this.tooltip.style.left = `${event.pageX + 10}px`;
        this.tooltip.style.top = `${event.pageY + 10}px`;
        this.tooltip.style.display = 'block';
    }
    
    /**
     * Show edge tooltip
     */
    showEdgeTooltip(event, edge) {
        if (!this.tooltip) return;
        
        const content = `
            <div class="font-medium">Relationship</div>
            <div class="text-xs">
                <span class="text-blue-500">${edge.source.label}</span>
                <span class="mx-2 text-gray-500">${edge.relation}</span>
                <span class="text-blue-500">${edge.target.label}</span>
            </div>
        `;
        
        this.tooltip.innerHTML = content;
        this.tooltip.style.left = `${event.pageX + 10}px`;
        this.tooltip.style.top = `${event.pageY + 10}px`;
        this.tooltip.style.display = 'block';
    }
    
    /**
     * Hide tooltip
     */
    hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = 'none';
        }
    }
    
    /**
     * Get additional details for node tooltip
     */
    getNodeTooltipDetails(node) {
        if (!node.metadata || Object.keys(node.metadata).length === 0) {
            return '';
        }
        
        // Display a subset of metadata for tooltip (to keep it compact)
        const keyMapping = {
            'cvss': 'CVSS Score',
            'category': 'Category',
            'platform': 'Platform',
            'purpose': 'Purpose',
            'os': 'Operating System',
            'ip': 'IP Address'
        };
        
        const priorityKeys = ['cvss', 'category', 'platform', 'purpose', 'os', 'ip'];
        const keysToShow = priorityKeys.filter(key => node.metadata[key]);
        
        if (keysToShow.length === 0) {
            return '';
        }
        
        let details = '<div class="mt-1 text-xs">';
        keysToShow.forEach(key => {
            const label = keyMapping[key] || key;
            details += `<div><span class="text-gray-500">${label}:</span> ${node.metadata[key]}</div>`;
        });
        details += '</div>';
        
        return details;
    }
    
    /**
     * Show detailed node information in the sidebar
     */
    showNodeDetails(node) {
        const detailsElement = document.getElementById('node-details');
        if (!detailsElement) return;
        
        // Create a formatted display of node details
        let details = `
            <div class="mb-3">
                <h3 class="text-lg font-medium text-gray-900">${node.label}</h3>
                <p class="text-sm text-indigo-600">${node.metadata.type || 'Node'}</p>
            </div>
        `;
        
        // Add metadata if available
        if (node.metadata && Object.keys(node.metadata).length > 0) {
            details += `<div class="space-y-2">`;
            
            for (const [key, value] of Object.entries(node.metadata)) {
                if (value !== undefined && value !== null && key !== 'type') {
                    details += `
                        <div>
                            <span class="text-xs font-medium text-gray-500">${key.toUpperCase()}</span>
                            <p class="mt-1 text-sm text-gray-900">${value}</p>
                        </div>
                    `;
                }
            }
            
            details += `</div>`;
        }
        
        detailsElement.innerHTML = details;
        
        // Update edge list
        this.showNodeEdges(node);
    }
    
    /**
     * Show edges connected to the selected node
     */
    showNodeEdges(node) {
        const edgeListElement = document.getElementById('edge-list');
        if (!edgeListElement) return;
        
        // Find all edges connected to this node
        const connectedEdges = this.edges.filter(edge => 
            edge.source.id === node.id || edge.target.id === node.id
        );
        
        if (connectedEdges.length === 0) {
            edgeListElement.innerHTML = `<p class="italic">No connections for this node</p>`;
            return;
        }
        
        // Group by incoming and outgoing
        const outgoing = connectedEdges.filter(edge => edge.source.id === node.id);
        const incoming = connectedEdges.filter(edge => edge.target.id === node.id);
        
        let edgeList = `<div class="space-y-4">`;
        
        // Outgoing edges
        if (outgoing.length > 0) {
            edgeList += `
                <div>
                    <h4 class="font-medium text-gray-700 mb-1">Outgoing (${outgoing.length})</h4>
                    <ul class="space-y-1">
            `;
            
            outgoing.forEach(edge => {
                edgeList += `
                    <li class="flex items-center text-xs">
                        <span class="text-gray-500 mr-1">${edge.relation}:</span>
                        <span class="font-medium">${edge.target.label}</span>
                    </li>
                `;
            });
            
            edgeList += `</ul></div>`;
        }
        
        // Incoming edges
        if (incoming.length > 0) {
            edgeList += `
                <div>
                    <h4 class="font-medium text-gray-700 mb-1">Incoming (${incoming.length})</h4>
                    <ul class="space-y-1">
            `;
            
            incoming.forEach(edge => {
                edgeList += `
                    <li class="flex items-center text-xs">
                        <span class="font-medium">${edge.source.label}</span>
                        <span class="text-gray-500 mx-1">${edge.relation}</span>
                    </li>
                `;
            });
            
            edgeList += `</ul></div>`;
        }
        
        edgeList += `</div>`;
        edgeListElement.innerHTML = edgeList;
    }
    
    /**
     * Highlight connections to a selected node
     */
    highlightConnections(node) {
        // Reset all highlights
        this.nodeElements.classed('node-highlight', false);
        this.edgeElements.classed('highlight', false);
        
        // Highlight the selected node
        this.nodeElements
            .filter(d => d.id === node.id)
            .classed('node-highlight', true);
        
        // Highlight edges connected to this node
        this.edgeElements
            .filter(d => d.source.id === node.id || d.target.id === node.id)
            .classed('highlight', true);
        
        // Highlight connected nodes
        this.nodeElements
            .filter(d => {
                return this.edges.some(edge => 
                    (edge.source.id === node.id && edge.target.id === d.id) ||
                    (edge.target.id === node.id && edge.source.id === d.id)
                );
            })
            .classed('node-highlight', true);
    }
    
    /**
     * Reset zoom level
     */
    resetZoom() {
        this.svg.transition()
            .duration(750)
            .call(this.zoom.transform, d3.zoomIdentity);
    }
    
    /**
     * Update node size
     */
    updateNodeSize(size) {
        this.config.nodeRadius = size;
        this.nodeElements.attr('r', size);
        
        // Also update arrow marker reference point
        this.svg.select('marker#arrowhead')
            .attr('refX', size * 2.5);
    }
    
    /**
     * Get color for a node based on its type
     */
    getNodeColor(node) {
        if (!node.metadata || !node.metadata.type) {
            return this.config.nodeColor;
        }
        
        const typeColors = {
            'Vulnerability': '#f87171', // red-400
            'Weakness': '#fbbf24',      // amber-400
            'Tactic': '#34d399',        // emerald-400
            'Technique': '#a78bfa',     // purple-400
            'Command': '#f472b6',       // pink-400
            'Tool': '#fb923c',          // orange-400
            'Framework': '#a3e635',     // lime-400
            'Detection': '#38bdf8',     // sky-400
            'Guide': '#c084fc',         // violet-400
            'Asset': '#60a5fa'          // blue-400
        };
        
        return typeColors[node.metadata.type] || this.config.nodeColor;
    }
    
    /**
     * Search for nodes by label or metadata
     */
    searchNodes(term) {
        if (!term) return [];
        
        term = term.toLowerCase();
        
        return this.nodes.filter(node => {
            // Check label
            if (node.label.toLowerCase().includes(term)) {
                return true;
            }
            
            // Check metadata
            if (node.metadata) {
                return Object.entries(node.metadata).some(([key, value]) => {
                    return value && value.toString().toLowerCase().includes(term);
                });
            }
            
            return false;
        });
    }
    
    /**
     * Focus the view on a specific node
     */
    focusNode(nodeId) {
        const node = this.nodeMap.get(nodeId);
        if (!node) return;
        
        // Highlight the node and its connections
        this.nodeClicked(null, node);
        
        // Center view on the node
        const scale = 1.5;
        const transform = d3.zoomIdentity
            .translate(this.width / 2, this.height / 2)
            .scale(scale)
            .translate(-node.x, -node.y);
        
        this.svg.transition()
            .duration(750)
            .call(this.zoom.transform, transform);
    }
}