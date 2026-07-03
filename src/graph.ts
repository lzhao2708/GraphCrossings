// filepath: src/graph.ts
import type { App, TFile } from 'obsidian';

export interface GraphNode {
    id: string;
    label: string;
    isGhost?: boolean;
}

export interface GraphEdge {
    source: string;
    target: string;
}

export interface GraphData {
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export function normalizeGraphPath(value: string): string {
    return value
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
}

export function getSuggestedFilePath(linkText: string): string {
    const linkWithoutAnchor = linkText.split('#')[0] ?? '';
    const linkWithoutBlock = linkWithoutAnchor.split('^')[0] ?? '';
    const cleanedLink = normalizeGraphPath(linkWithoutBlock);
    if (!cleanedLink) {
        return 'Untitled.md';
    }

    const hasExplicitExtension = /\.[^.\/]+$/.test(cleanedLink);
    return hasExplicitExtension ? cleanedLink : `${cleanedLink}.md`;
}

export function findMatchingFileForLink(linkText: string, files: TFile[]): TFile | null {
    const linkWithoutAnchor = linkText.split('#')[0] ?? '';
    const linkWithoutBlock = linkWithoutAnchor.split('^')[0] ?? '';
    const cleanedLink = normalizeGraphPath(linkWithoutBlock);
    if (!cleanedLink) {
        return null;
    }

    const candidates = new Set<string>();
    const addCandidate = (candidate: string): void => {
        const normalized = normalizeGraphPath(candidate);
        if (normalized) {
            candidates.add(normalized.toLowerCase());
        }
    };

    addCandidate(cleanedLink);

    if (cleanedLink.endsWith('.md')) {
        addCandidate(cleanedLink.slice(0, -3));
    } else {
        addCandidate(`${cleanedLink}.md`);
    }

    if (cleanedLink.endsWith('.markdown')) {
        addCandidate(cleanedLink.slice(0, -10));
    } else {
        addCandidate(`${cleanedLink}.markdown`);
    }

    const noExtension = cleanedLink.replace(/\.[^.]+$/, '');
    if (noExtension !== cleanedLink) {
        addCandidate(noExtension);
    }
    addCandidate(`${noExtension}.md`);
    addCandidate(`${noExtension}.markdown`);

    for (const file of files) {
        const normalizedPath = normalizeGraphPath(file.path).toLowerCase();
        const normalizedPathWithoutExtension = normalizeGraphPath(file.path.replace(/\.[^.]+$/, '')).toLowerCase();
        const normalizedBasename = normalizeGraphPath(file.basename).toLowerCase();

        if (
            candidates.has(normalizedPath) ||
            candidates.has(normalizedPathWithoutExtension) ||
            candidates.has(normalizedBasename)
        ) {
            return file;
        }
    }

    return null;
}

/**
 * Graph crossing minimizer using layered graph approach
 * Uses barycenter heuristic for crossing reduction
 */
export class GraphCrossingMinimizer {
    private _nodes: Map<string, GraphNode> = new Map();
    private _edges: GraphEdge[] = [];
    private _edgeSet: Set<string> = new Set(); // Track unique edges to avoid duplicates
    private _graphFiles: TFile[] = [];
    private layers: string[][] = []; // Ordered nodes per layer

    // Public getters
    get nodes(): Map<string, GraphNode> { return this._nodes; }
    get edges(): GraphEdge[] { return this._edges; }

    constructor(private app: App) { }

    /**
     * Build graph from vault metadata
     */
    async buildFromVault(): Promise<GraphData> {
        this._nodes.clear();
        this._edges = [];
        this._edgeSet.clear();

        const files = this.app.vault.getFiles().filter((file: any) => this.isSupportedGraphFile(file));
        this._graphFiles = files;

        // Create nodes (use normalized paths as ids)
        for (const file of files) {
            const id = normalizeGraphPath(file.path);
            this._nodes.set(id, {
                id,
                label: file.basename
            });
        }

        // Create edges from links
        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);

            // 1. Process regular text links (cache.links)
            const links = (cache as any)?.['links'];
            if (links) {
                for (const link of links) {
                    this.addEdgeFromLink(file.path, (link as any).link);
                }
            }

            // 2. Process embeds (cache.embeds)
            const embeds = (cache as any)?.['embeds'];
            if (embeds) {
                for (const embed of embeds) {
                    this.addEdgeFromLink(file.path, (embed as any).link);
                }
            }

            // 3. Process links in frontmatter/properties
            const frontmatter = (cache as any)?.['frontmatter'];
            if (frontmatter) {
                this.processFrontmatterLinks(file.path, frontmatter as Record<string, unknown>);
            }

            // 4. Process links in tables and lists by parsing file content
            try {
                const fileContent = await this.app.vault.cachedRead(file);
                if (fileContent) {
                    this.processContentLinks(file.path, fileContent);
                }
            } catch (e) {
                // Ignore read errors for files that can't be read
            }
        }

        return this.getGraphData();
    }

    private isSupportedGraphFile(file: TFile): boolean {
        const skipExtensions = new Set([
            'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg',
            'pdf', 'mp4', 'mp3', 'wav', 'zip', 'rar', '7z', 'tar', 'gz',
            'exe', 'dll', 'dmg', 'iso', 'woff', 'woff2', 'ttf', 'otf', 'ico'
        ]);

        return !skipExtensions.has(file.extension.toLowerCase());
    }

    private ensureGhostNode(linkText: string): string | null {
        const linkWithoutAnchor = linkText.split('#')[0] ?? '';
        const linkWithoutBlock = linkWithoutAnchor.split('^')[0] ?? '';
        const cleanedLink = normalizeGraphPath(linkWithoutBlock);
        if (!cleanedLink) {
            return null;
        }

        if (!this._nodes.has(cleanedLink)) {
            this._nodes.set(cleanedLink, {
                id: cleanedLink,
                label: cleanedLink.split('/').pop() || cleanedLink,
                isGhost: true
            });
        }

        return cleanedLink;
    }

    /**
     * Add an edge from a link, resolving the target path
     */
    private addEdgeFromLink(sourcePath: string, linkText: string): void {
        // Try to resolve the link target using Obsidian first
        let target = this.app.metadataCache.getFirstLinkpathDest(linkText, sourcePath);

        // If not found, try adding a markdown extension
        if (!target) {
            target = this.app.metadataCache.getFirstLinkpathDest(linkText + '.md', sourcePath);
        }

        // If still not found, try removing .md from linkText if present
        if (!target && linkText.endsWith('.md')) {
            target = this.app.metadataCache.getFirstLinkpathDest(linkText.slice(0, -3), sourcePath);
        }

        // Fall back to scanning known vault files for matching paths and basenames
        if (!target) {
            target = findMatchingFileForLink(linkText, this._graphFiles);
        }

        if (!target) {
            const ghostNodeId = this.ensureGhostNode(linkText);
            if (ghostNodeId) {
                const sourceId = normalizeGraphPath(sourcePath);
                const edgeKey = `${sourceId}->${ghostNodeId}`;
                if (!this._edgeSet.has(edgeKey)) {
                    this._edgeSet.add(edgeKey);
                    this._edges.push({ source: sourceId, target: ghostNodeId });
                }
            }
            return;
        }

        // Use the target path (normalize it)
        const targetPath = normalizeGraphPath(target.path);
        const sourceId = normalizeGraphPath(sourcePath);

        // Try common variants and pick the first that exists in our nodes
        const candidates = [
            targetPath,
            targetPath.replace(/\.md$/i, ''),
            `${targetPath}.md`
        ];

        let normalizedTarget: string | null = null;
        for (const c of candidates) {
            if (this._nodes.has(c)) {
                normalizedTarget = c;
                break;
            }
        }

        if (normalizedTarget) {
            const edgeKey = `${sourceId}->${normalizedTarget}`;
            if (!this._edgeSet.has(edgeKey)) {
                this._edgeSet.add(edgeKey);
                this._edges.push({ source: sourceId, target: normalizedTarget });
            }
        }
    }

    /**
     * Process links in frontmatter properties
     */
    private processFrontmatterLinks(sourcePath: string, frontmatter: Record<string, unknown>): void {
        const processValue = (value: unknown): void => {
            if (typeof value === 'string') {
                // Check for wiki-style links in string values
                const linkMatches = value.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g);
                if (linkMatches) {
                    for (const match of linkMatches) {
                        const linkText = match.slice(2, -2).split('|')[0];
                        if (linkText) {

                            this.addEdgeFromLink(sourcePath, linkText);
                        }
                    }
                }
            } else if (Array.isArray(value)) {
                for (const item of value) {
                    processValue(item);
                }
            } else if (value && typeof value === 'object') {
                // Recursively process nested objects - use for...in instead of Object.values
                const obj = value as Record<string, unknown>;
                for (const k in obj) {
                    if (Object.prototype.hasOwnProperty.call(obj, k)) {
                        processValue(obj[k]);
                    }
                }
            }
        };

        // Use for...in instead of Object.values
        for (const key in frontmatter) {
            if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
                processValue(frontmatter[key]);
            }
        }
    }

    /**
     * Process links in table cells and list items from raw content
     */
    private processContentLinks(sourcePath: string, content: string): void {
        // Match wiki-style links: [[link]] or [[link|alias]]
        const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        let match;

        while ((match = linkRegex.exec(content)) !== null) {
            const linkText = match[1];
            // Skip block references (lines starting with ^) and undefined
            if (linkText && !linkText.includes('^')) {
                this.addEdgeFromLink(sourcePath, linkText);
            }
        }
    }

    /**
     * Get current graph data
     */
    getGraphData(): GraphData {
        return {
            nodes: Array.from(this._nodes.values()),
            edges: [...this._edges]
        };
    }

    /**
     * Create layers based on distance from root nodes
     * Root nodes = files with no incoming edges
     */
    createLayers(): string[][] {
        const inDegree = new Map<string, number>();
        const outDegree = new Map<string, number>();

        // Initialize degrees
        for (const node of this.nodes.keys()) {
            inDegree.set(node, 0);
            outDegree.set(node, 0);
        }

        // Calculate degrees
        for (const edge of this.edges) {
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
            outDegree.set(edge.source, (outDegree.get(edge.source) || 0) + 1);
        }

        // Find root nodes (no incoming edges)
        const roots: string[] = [];
        for (const [node, degree] of inDegree) {
            if (degree === 0) {
                roots.push(node);
            }
        }

        // If no roots found (e.g., fully connected graph), use first node as root
        if (roots.length === 0 && this.nodes.size > 0) {
            roots.push(this.nodes.keys().next().value!);
        }

        // BFS to assign layers
        const layerMap = new Map<string, number>();
        const queue: string[] = [...roots];

        for (const root of roots) {
            layerMap.set(root, 0);
        }

        let head = 0;
        while (head < queue.length) {
            const current = queue[head++];
            if (current === undefined) continue;
            const currentLayer = layerMap.get(current) || 0;

            // Get neighbors (outgoing edges)
            const neighbors = this.edges
                .filter(e => e.source === current)
                .map(e => e.target);

            for (const neighbor of neighbors) {
                if (!layerMap.has(neighbor)) {
                    layerMap.set(neighbor, currentLayer + 1);
                    queue.push(neighbor);
                }
            }
        }

        // Handle disconnected nodes (assign to last layer)
        for (const node of this.nodes.keys()) {
            if (!layerMap.has(node)) {
                layerMap.set(node, -1); // Will be placed in last layer
            }
        }

        // Group by layer
        const maxLayer = Math.max(...Array.from(layerMap.values()).filter(l => l >= 0));
        this.layers = Array.from({ length: maxLayer + 2 }, () => []);

        for (const [node, layer] of layerMap) {
            const targetLayer = layer === -1 ? maxLayer + 1 : layer;
            if (this.layers[targetLayer]) {
                this.layers[targetLayer].push(node);
            }
        }

        return this.layers;
    }

    /**
     * Count edge crossings between two layers
     */
    private countCrossings(layer1: string[], layer2: string[]): number {
        const index1 = new Map(layer1.map((n, i) => [n, i]));
        const index2 = new Map(layer2.map((n, i) => [n, i]));

        // Get edges between these layers
        const edges: [number, number][] = [];
        for (const edge of this.edges) {
            const i1 = index1.get(edge.source);
            const i2 = index2.get(edge.target);
            if (i1 !== undefined && i2 !== undefined) {
                edges.push([i1, i2]);
            }
        }

        // Count crossings using reduce
        const crossings = edges.reduce((count, edgeA, i) => {
            return count + edges.slice(i + 1).reduce((innerCount, edgeB) => {
                const [a1, a2] = edgeA;
                const [b1, b2] = edgeB;
                // Crossing if one edge goes "forward" and other goes "backward"
                return ((a1 < b1 && a2 > b2) || (a1 > b1 && a2 < b2))
                    ? innerCount + 1
                    : innerCount;
            }, 0);
        }, 0);

        return crossings;
    }

    /**
     * Calculate total crossings in the current layout
     */
    countTotalCrossings(): number {
        return this.layers.reduce((total, layer, i) => {
            const nextLayer = this.layers[i + 1];
            if (!nextLayer) return total;
            return total + this.countCrossings(layer, nextLayer);
        }, 0);
    }

    /**
     * Barycenter heuristic: reorder nodes to minimize crossings
     * Iteratively adjusts node positions based on average position of neighbors
     */
    minimizeCrossings(iterations: number = 10): string[][] {
        if (this.layers.length === 0) {
            this.createLayers();
        }

        for (let iter = 0; iter < iterations; iter++) {
            // Sweep from left to right
            this.sweep(true);

            // Sweep from right to left
            this.sweep(false);
        }

        return this.layers;
    }

    /**
     * Single sweep pass (left-to-right or right-to-left)
     */
    private sweep(leftToRight: boolean): void {
        const layers = leftToRight ? this.layers : this.layers.map(l => [...l]).reverse();

        for (let i = 0; i < layers.length - 1; i++) {
            const currentLayer = layers[i];
            const nextLayer = layers[i + 1];

            if (!currentLayer || !nextLayer) continue;

            // Calculate barycenter for each node in current layer
            const barycenters = new Map<string, number>();

            for (const node of currentLayer) {
                // Get positions of this node's neighbors in next layer
                const neighborPositions: number[] = [];

                for (const edge of this.edges) {
                    if (leftToRight) {
                        if (edge.source === node && nextLayer.includes(edge.target)) {
                            neighborPositions.push(nextLayer.indexOf(edge.target));
                        }
                    } else {
                        if (edge.target === node && nextLayer.includes(edge.source)) {
                            neighborPositions.push(nextLayer.indexOf(edge.source));
                        }
                    }
                }

                if (neighborPositions.length > 0) {
                    const avg = neighborPositions.reduce((a, b) => a + b, 0) / neighborPositions.length;
                    barycenters.set(node, avg);
                } else {
                    barycenters.set(node, currentLayer.indexOf(node));
                }
            }

            // Sort current layer by barycenter
            const sortedLayer = [...currentLayer].sort((a, b) =>
                (barycenters.get(a) || 0) - (barycenters.get(b) || 0)
            );
            layers[i] = sortedLayer;
        }

        if (!leftToRight) {
            this.layers = layers.reverse();
        }
    }

    /**
     * Get all layers with optimized order
     */
    getOptimizedLayers(): string[][] {
        return this.layers;
    }

    /**
     * Get crossing count before and after optimization
     */
    getOptimizationStats(): { before: number; after: number; improvement: number } {
        // Create initial layers
        this.createLayers();
        const before = this.countTotalCrossings();

        // Optimize
        this.minimizeCrossings(20);
        const after = this.countTotalCrossings();

        return {
            before,
            after,
            improvement: before - after
        };
    }
}