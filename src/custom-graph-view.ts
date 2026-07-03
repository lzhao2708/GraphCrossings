import { ItemView, Notice } from 'obsidian';
import type { App, TFile, WorkspaceLeaf } from 'obsidian';
import { getSuggestedFilePath, GraphCrossingMinimizer } from './graph.js';

export const CUSTOM_GRAPH_VIEW_TYPE = 'custom-graph-view';

interface NodeData {
    id: string;
    label: string;
    isGhost?: boolean;
    x: number;
    y: number;
    vx: number;
    vy: number;
    fx: number;
    fy: number;
}

export class CustomGraphView extends ItemView {
    private minimizer: GraphCrossingMinimizer | null = null;
    private canvas: HTMLCanvasElement | null = null;
    private ctx: CanvasRenderingContext2D | null = null;
    private nodes: Map<string, NodeData> = new Map();
    private hoveredNode: string | null = null;
    private hoverFadeAlpha = 0;
    private draggedNode: string | null = null;
    private dragOffset = { x: 0, y: 0 };
    private animationId: number | null = null;
    private isRunning = false;
    public app: App;

    // Transform state for zoom/pan
    private offsetX = 0;
    private offsetY = 0;
    private scale = 0.5;
    private isPanning = false;
    private panStart = { x: 0, y: 0 };
    private mouseDownPos = { x: 0, y: 0 };

    // Force-directed layout parameters (loaded from settings)
    private REPULSION = 7750;      // 3/4 of slider range
    private ATTRACTION = 0.05;      // Max link force
    private CENTERING = 0.00257;    // Halfway on slider
    private DAMPING = 0.9;
    private MIN_DISTANCE = 50;      // 1/4 of slider range
    private readonly FRICTION = 0.02; // Friction force to resist movement

    // Centering slider curve parameters
    private readonly CENTERING_MIN = 0.0002;
    private readonly CENTERING_MAX = 0.008;
    private readonly CENTERING_EXPONENT = 1.6;
    private readonly CENTERING_RANGE = this.CENTERING_MAX - this.CENTERING_MIN;

    // Link Force slider curve parameters
    private readonly LINK_FORCE_MIN = 0.001;
    private readonly LINK_FORCE_MAX = 0.05;
    private readonly LINK_FORCE_EXPONENT = 1.3;
    private readonly LINK_FORCE_RANGE = this.LINK_FORCE_MAX - this.LINK_FORCE_MIN;

    constructor(leaf: WorkspaceLeaf, app: App) {
        super(leaf);
        this.app = app;
    }

    getViewType(): string {
        return CUSTOM_GRAPH_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Optimized Graph';
    }

    // Update force parameters from settings
    updateForceSettings(settings: { centeringForce: number; repelForce: number; linkForce: number; linkDistance: number }): void {
        this.CENTERING = settings.centeringForce;
        this.REPULSION = settings.repelForce;
        this.ATTRACTION = settings.linkForce;
        this.MIN_DISTANCE = settings.linkDistance;
    }

    async onOpen(): Promise<void> {
        // `containerEl` exists on ItemView provided by Obsidian
        // use non-null assertion to satisfy TS in this environment
        const container = this.containerEl!;
        container.empty();

        const graphShell = container.createEl('div', { cls: 'custom-graph-shell' });

        // Create header
        const header = graphShell.createEl('div', { cls: 'custom-graph-header' });
        header.createEl('h2', { text: 'Graph Crossing Minimizer' });

        const buttonContainer = header.createEl('div', { cls: 'button-container' });

        const refreshBtn = buttonContainer.createEl('button', { text: 'Refresh' });
        refreshBtn.onclick = () => this.refreshGraph();

        const optimizeBtn = buttonContainer.createEl('button', { text: 'Optimize' });
        optimizeBtn.onclick = () => this.runOptimization();

        const canvasWrapper = graphShell.createEl('div', { cls: 'graph-canvas-wrapper' });

        // Create canvas
        this.canvas = canvasWrapper.createEl('canvas', { cls: 'custom-graph-canvas' }) as HTMLCanvasElement;
        this.ctx = this.canvas!.getContext('2d');

        // Create controls container embedded inside the graph window
        const controlsContainer = canvasWrapper.createEl('div', { cls: 'graph-controls-panel' });

        // Centering Force slider
        const centeringControl = controlsContainer.createEl('div', { cls: 'control-group' });
        centeringControl.createEl('label', { text: 'Centering' });
        const centeringSlider = centeringControl.createEl('input') as HTMLInputElement;
        centeringSlider.type = 'range';
        centeringSlider.min = '0';
        centeringSlider.max = '100';
        centeringSlider.step = '1';
        centeringSlider.value = String(this.getCenteringSliderValue(this.CENTERING));
        centeringSlider.oninput = () => {
            const sliderValue = parseFloat(centeringSlider.value);
            this.CENTERING = this.getCenteringValue(sliderValue);
        };

        // Repel Force slider
        const repelControl = controlsContainer.createEl('div', { cls: 'control-group' });
        repelControl.createEl('label', { text: 'Repel' });
        const repelSlider = repelControl.createEl('input') as HTMLInputElement;
        repelSlider.type = 'range';
        repelSlider.min = '7750';
        repelSlider.max = '20000';
        repelSlider.step = '100';
        repelSlider.value = String(this.REPULSION);
        repelSlider.oninput = () => {
            this.REPULSION = parseFloat(repelSlider.value);
        };

        // Link Force slider
        const linkForceControl = controlsContainer.createEl('div', { cls: 'control-group' });
        linkForceControl.createEl('label', { text: 'Link Force' });
        const linkForceSlider = linkForceControl.createEl('input') as HTMLInputElement;
        linkForceSlider.type = 'range';
        linkForceSlider.min = '0';
        linkForceSlider.max = '100';
        linkForceSlider.step = '1';
        linkForceSlider.value = String(this.getLinkForceSliderValue(this.ATTRACTION));
        linkForceSlider.oninput = () => {
            const sliderValue = parseFloat(linkForceSlider.value);
            this.ATTRACTION = this.getLinkForceValue(sliderValue);
        };

        // Link Distance slider
        const linkDistControl = controlsContainer.createEl('div', { cls: 'control-group' });
        linkDistControl.createEl('label', { text: 'Link Dist' });
        const linkDistSlider = linkDistControl.createEl('input') as HTMLInputElement;
        linkDistSlider.type = 'range';
        linkDistSlider.min = '20';
        linkDistSlider.max = '150';
        linkDistSlider.step = '5';
        linkDistSlider.value = String(this.MIN_DISTANCE);
        linkDistSlider.oninput = () => {
            this.MIN_DISTANCE = Math.min(150, Math.max(20, parseFloat(linkDistSlider.value)));
        };

        // registerDomEvent is provided by Obsidian's ItemView in runtime; assert existence
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        this.registerDomEvent(window, 'resize', () => this.resizeCanvas());

        this.resizeCanvas();
        this.setupInteraction();
        this.refreshGraph();
    }

    private getCenteringValue(sliderValue: number): number {
        const normalized = Math.pow(sliderValue / 100, this.CENTERING_EXPONENT);
        return this.CENTERING_MIN + normalized * this.CENTERING_RANGE;
    }

    private getCenteringSliderValue(value: number): number {
        const clamped = Math.min(this.CENTERING_MAX, Math.max(this.CENTERING_MIN, value));
        const normalized = (clamped - this.CENTERING_MIN) / this.CENTERING_RANGE;
        return Math.round(Math.pow(normalized, 1 / this.CENTERING_EXPONENT) * 100);
    }

    private getLinkForceValue(sliderValue: number): number {
        const normalized = Math.pow(sliderValue / 100, this.LINK_FORCE_EXPONENT);
        return this.LINK_FORCE_MIN + normalized * this.LINK_FORCE_RANGE;
    }

    private getLinkForceSliderValue(value: number): number {
        const clamped = Math.min(this.LINK_FORCE_MAX, Math.max(this.LINK_FORCE_MIN, value));
        const normalized = (clamped - this.LINK_FORCE_MIN) / this.LINK_FORCE_RANGE;
        return Math.round(Math.pow(normalized, 1 / this.LINK_FORCE_EXPONENT) * 100);
    }

    private resizeCanvas(): void {
        if (!this.canvas) return;
        const container = this.canvas.parentElement;

        const width = container?.clientWidth || window.innerWidth;
        const height = container?.clientHeight ? container.clientHeight - 60 : window.innerHeight - 60;

        this.canvas.width = Math.max(400, width);
        this.canvas.height = Math.max(400, height);

        // Re-center nodes if simulation hasn't started
        if (this.nodes.size > 0 && !this.isRunning) {
            this.initializeNodePositions();
        }
    }

    private getWorldCoordinates(clientX: number, clientY: number): { x: number; y: number } {
        if (!this.canvas) {
            return { x: 0, y: 0 };
        }

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;
        const canvasX = (clientX - rect.left) * scaleX;
        const canvasY = (clientY - rect.top) * scaleY;

        return {
            x: (canvasX - this.offsetX) / this.scale,
            y: (canvasY - this.offsetY) / this.scale
        };
    }

    private setupInteraction(): void {
        if (!this.canvas) return;

        // Zoom with mouse wheel
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const rect = this.canvas!.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;

            const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(0.1, Math.min(5, this.scale * zoomFactor));

            // Zoom toward mouse position
            this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
            this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
            this.scale = newScale;

            this.render();
        }, { passive: false });

        // Pan with middle mouse button or shift+drag
        this.canvas.addEventListener('mousedown', (e) => {
            this.mouseDownPos = { x: e.clientX, y: e.clientY };

            // Middle mouse button or shift key held
            if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
                e.preventDefault();
                this.isPanning = true;
                this.panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
                return;
            }

            const { x, y } = this.getWorldCoordinates(e.clientX, e.clientY);

            // Check if clicking on a node
            for (const [nodeId, node] of this.nodes) {
                const dx = x - node.x;
                const dy = y - node.y;
                if (dx * dx + dy * dy < 225) { // 15px radius
                    this.draggedNode = nodeId;
                    this.dragOffset = { x: dx, y: dy };
                    node.vx = 0;
                    node.vy = 0;
                    break;
                }
            }
        });

        this.canvas.addEventListener('mousemove', (e) => {
            // Handle panning
            if (this.isPanning) {
                this.offsetX = e.clientX - this.panStart.x;
                this.offsetY = e.clientY - this.panStart.y;
                this.render();
                return;
            }

            // Handle dragging
            if (this.draggedNode) {
                const node = this.nodes.get(this.draggedNode);
                if (node) {
                    const { x, y } = this.getWorldCoordinates(e.clientX, e.clientY);
                    node.x = x - this.dragOffset.x;
                    node.y = y - this.dragOffset.y;
                    node.vx = 0;
                    node.vy = 0;
                }
                return;
            }

            // Handle hover (convert to world coordinates)
            const { x, y } = this.getWorldCoordinates(e.clientX, e.clientY);

            this.hoveredNode = null;
            for (const [nodeId, node] of this.nodes) {
                const dx = x - node.x;
                const dy = y - node.y;
                if (dx * dx + dy * dy < 225) {
                    this.hoveredNode = nodeId;
                    break;
                }
            }
            this.render();
        });

        this.canvas.addEventListener('mouseup', () => {
            if (this.isPanning) {
                this.isPanning = false;
                return;
            }
            if (this.draggedNode && !this.isRunning) {
                this.startSimulation();
            }
            this.draggedNode = null;
        });

        this.canvas.addEventListener('mouseleave', () => {
            this.isPanning = false;
            this.draggedNode = null;
            this.hoveredNode = null;
            this.render();
        });

        this.canvas.addEventListener('click', (e) => {
            // Calculate distance moved since mousedown
            const dx = e.clientX - this.mouseDownPos.x;
            const dy = e.clientY - this.mouseDownPos.y;
            const moved = Math.sqrt(dx * dx + dy * dy);

            // Only open file if it was a clean click (minimal movement)
            if (this.hoveredNode && moved < 5) {
                void this.handleNodeClick(this.hoveredNode);
            }
        });

        // Double-click to reset view
        this.canvas.addEventListener('dblclick', () => {
            this.offsetX = 0;
            this.offsetY = 0;
            this.scale = 1;
            this.render();
        });
    }

    private async refreshGraph(): Promise<void> {
        this.minimizer = new GraphCrossingMinimizer(this.app);
        await this.minimizer.buildFromVault();

        // Stop any existing simulation
        this.stopSimulation();

        // Initialize nodes
        this.nodes.clear();
        const centerX = this.canvas ? this.canvas.width / 2 : 400;
        const centerY = this.canvas ? this.canvas.height / 2 : 300;

        for (const [nodeId, minimizerNode] of this.minimizer.nodes) {
            // Random initial position around center
            const angle = Math.random() * Math.PI * 2;
            const radius = 50 + Math.random() * 100;
            this.nodes.set(nodeId, {
                id: nodeId,
                label: minimizerNode.label,
                isGhost: minimizerNode.isGhost ?? false,
                x: centerX + Math.cos(angle) * radius,
                y: centerY + Math.sin(angle) * radius,
                vx: 0,
                vy: 0,
                fx: 0,
                fy: 0
            });
        }

        // Start simulation
        this.startSimulation();

        new Notice(`Loaded ${this.minimizer.nodes.size} nodes, ${this.minimizer.edges.length} edges`);
    }

    private async handleNodeClick(nodeId: string): Promise<void> {
        const node = this.nodes.get(nodeId);
        if (!node) {
            return;
        }

        if (node.isGhost) {
            const suggested = getSuggestedFilePath(node.id);

            // Try a few path variants to see if a file already exists
            const candidates = [
                node.id,
                `${node.id}.md`,
                node.id.replace(/\.md$/i, ''),
                suggested
            ];

            for (const candidate of candidates) {
                const existing = (this.app.vault.getAbstractFileByPath(candidate) as any);
                if (isTFile(existing)) {
                    (this.app.workspace.getLeaf(true) as any).openFile(existing);
                    return;
                }
            }

            try {
                await this.ensureParentFolder(suggested);
                const createdFile = await this.app.vault.create(suggested, '');
                await this.refreshGraph();
                (this.app.workspace.getLeaf(true) as any).openFile(createdFile);
            } catch (error) {
                console.error('Failed to create ghost node file:', error);
                new Notice(`Could not create ${suggested}`);
            }

            return;
        }

        const candidates = [nodeId, `${nodeId}.md`, nodeId.replace(/\.md$/i, '')];
        for (const candidate of candidates) {
            const file = (this.app.vault.getAbstractFileByPath(candidate) as any);
            if (isTFile(file)) {
                (this.app.workspace.getLeaf(true) as any).openFile(file);
                return;
            }
        }
    }

    private async ensureParentFolder(targetPath: string): Promise<void> {
        const parentPath = targetPath.split('/').slice(0, -1).join('/');
        if (!parentPath) {
            return;
        }

        const segments = parentPath.split('/').filter(Boolean);
        let currentPath = '';
        for (const segment of segments) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            try {
                await this.app.vault.createFolder(currentPath);
            } catch (error) {
                if (!(error instanceof Error) || !error.message.includes('already exists')) {
                    throw error;
                }
            }
        }
    }

    private initializeNodePositions(): void {
        if (!this.canvas) return;
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;

        let i = 0;
        for (const node of this.nodes.values()) {
            const angle = (i / this.nodes.size) * Math.PI * 2;
            const radius = 100;
            node.x = centerX + Math.cos(angle) * radius;
            node.y = centerY + Math.sin(angle) * radius;
            i++;
        }
    }

    private startSimulation(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.simulationStep();
    }

    private stopSimulation(): void {
        this.isRunning = false;
        if (this.animationId !== null) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
    }

    private simulationStep(): void {
        if (!this.isRunning || !this.minimizer) return;

        const edges = this.minimizer.edges;
        const nodesArray = Array.from(this.nodes.values());

        // Reset forces
        for (const node of nodesArray) {
            node.fx = 0;
            node.fy = 0;
        }

        // Calculate repulsion between all nodes
        for (let i = 0; i < nodesArray.length; i++) {
            for (let j = i + 1; j < nodesArray.length; j++) {
                const a = nodesArray[i];
                const b = nodesArray[j];
                if (!a || !b) continue;

                const dx = b.x - a.x;
                const dy = b.y - a.y;
                let dist = Math.sqrt(dx * dx + dy * dy);
                const repulsionMinDistance = Math.max(this.MIN_DISTANCE, 30);
                if (dist < repulsionMinDistance) dist = repulsionMinDistance;

                const force = this.REPULSION / (dist * dist);
                const fx = (dx / dist) * force;
                const fy = (dy / dist) * force;

                a.fx -= fx;
                a.fy -= fy;
                b.fx += fx;
                b.fy += fy;
            }
        }

        // Calculate attraction for connected nodes
        for (const edge of edges) {
            const a = this.nodes.get(edge.source);
            const b = this.nodes.get(edge.target);
            if (!a || !b) continue;

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) continue;

            const idealDistance = this.MIN_DISTANCE;
            const springForce = this.ATTRACTION * (dist - idealDistance);
            const fx = (dx / dist) * springForce;
            const fy = (dy / dist) * springForce;

            a.fx += fx;
            a.fy += fy;
            b.fx -= fx;
            b.fy -= fy;
        }

        // Centering force
        const centerX = this.canvas ? this.canvas.width / 2 : 400;
        const centerY = this.canvas ? this.canvas.height / 2 : 300;
        const centeringStrength = this.CENTERING * 0.7;
        for (const node of nodesArray) {
            node.fx += (centerX - node.x) * centeringStrength;
            node.fy += (centerY - node.y) * centeringStrength;
        }

        // Friction force (resists velocity, stronger when moving slowly)
        for (const node of nodesArray) {
            const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
            const adaptiveFriction = this.FRICTION * (1 + 1 / Math.max(speed, 0.1));
            node.fx -= node.vx * adaptiveFriction;
            node.fy -= node.vy * adaptiveFriction;
        }

        // Update velocities and positions
        let totalVelocity = 0;
        const velocityFloor = 0.0001;
        for (const node of nodesArray) {
            // Skip dragged node
            if (node.id === this.draggedNode) continue;

            node.vx = (node.vx + node.fx) * this.DAMPING;
            node.vy = (node.vy + node.fy) * this.DAMPING;

            // Clamp tiny velocities to zero to prevent endless drift
            if (Math.abs(node.vx) < velocityFloor) node.vx = 0;
            if (Math.abs(node.vy) < velocityFloor) node.vy = 0;

            node.x += node.vx;
            node.y += node.vy;

            totalVelocity += Math.abs(node.vx) + Math.abs(node.vy);
        }

        // Render
        this.render();

        // Continue simulation if there's significant movement
        if (totalVelocity > 0.1) {
            this.animationId = requestAnimationFrame(() => this.simulationStep());
        } else {
            this.isRunning = false;
            this.animationId = null;
        }
    }

    private runOptimization(): void {
        if (!this.minimizer || !this.canvas) return;

        this.minimizer.minimizeCrossings(20);

        // Apply optimized positions from layers
        const layers = this.minimizer.getOptimizedLayers();
        // const centerX/centerY not required here
        const layerHeight = (this.canvas.height - 100) / Math.max(layers.length, 1);

        for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
            const layer = layers[layerIdx];
            if (!layer) continue;
            const layerWidth = (this.canvas.width - 100) / Math.max(layer.length, 1);

            for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
                const nodeId = layer[nodeIdx];
                if (!nodeId) continue;
                const node = this.nodes.get(nodeId);
                if (node) {
                    node.x = 50 + nodeIdx * layerWidth + layerWidth / 2;
                    node.y = 50 + layerIdx * layerHeight;
                    node.vx = 0;
                    node.vy = 0;
                }
            }
        }

        // Restart simulation to settle
        this.startSimulation();

        const stats = this.minimizer.getOptimizationStats();
        new Notice(`Optimized: ${stats.before} → ${stats.after} crossings`);
    }

    private updateHoverAnimation(): void {
        const targetAlpha = this.hoveredNode ? 1 : 0;
        this.hoverFadeAlpha += (targetAlpha - this.hoverFadeAlpha) * 0.18;
        if (Math.abs(targetAlpha - this.hoverFadeAlpha) < 0.001) {
            this.hoverFadeAlpha = targetAlpha;
        }
    }

    private render(): void {
        if (!this.ctx || !this.canvas) return;

        this.updateHoverAnimation();

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        if (!this.minimizer) return;

        // Apply transform
        ctx.save();
        ctx.translate(this.offsetX, this.offsetY);
        ctx.scale(this.scale, this.scale);

        const hoverAlpha = this.hoverFadeAlpha;

        // Draw edges
        for (const edge of this.minimizer.edges) {
            const sourceNode = this.nodes.get(edge.source);
            const targetNode = this.nodes.get(edge.target);

            if (sourceNode && targetNode) {
                const isConnectedToHover = !!this.hoveredNode && (edge.source === this.hoveredNode || edge.target === this.hoveredNode);
                const edgeAlpha = isConnectedToHover ? 0.95 * hoverAlpha : 0.55;
                ctx.strokeStyle = isConnectedToHover ? 'rgba(255,255,255,0.95)' : 'rgba(140, 180, 255, 0.9)';
                ctx.globalAlpha = edgeAlpha;
                ctx.lineWidth = isConnectedToHover ? (2.4 / this.scale) : (1.3 / this.scale);
                ctx.beginPath();
                ctx.moveTo(sourceNode.x, sourceNode.y);
                ctx.lineTo(targetNode.x, targetNode.y);
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;

        // Draw nodes
        for (const [nodeId, node] of this.nodes) {
            const isHovered = nodeId === this.hoveredNode;
            const isDragged = nodeId === this.draggedNode;
            const radius = isHovered || isDragged ? 12 : 8;
            const baseFill = node.isGhost
                ? '#5a5a5a'
                : '#4dabf7';
            const hoverFill = node.isGhost ? '#7a7a7a' : '#ff6b6b';

            ctx.beginPath();
            ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = isHovered ? hoverFill : isDragged ? '#ffd93d' : baseFill;
            ctx.globalAlpha = node.isGhost ? 0.45 : (isHovered ? 0.95 : 0.85);
            ctx.fill();
            ctx.globalAlpha = 1;

            if (node.isGhost) {
                ctx.beginPath();
                ctx.arc(node.x, node.y, radius + 1.2, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(220, 220, 220, 0.35)';
                ctx.lineWidth = 0.8 / this.scale;
                ctx.stroke();
            }

            // Node label
            if (this.scale >= 0.7) {
                const label = node.label.length > 15 ? node.label.substring(0, 12) + '...' : node.label;
                const labelY = node.y + radius + 15 / this.scale;

                if (isHovered) {
                    const labelWidth = Math.max(80, ctx.measureText(label).width + 18);
                    const labelX = node.x - labelWidth / 2;
                    const labelHeight = 22 / this.scale;
                    ctx.globalAlpha = 0.18 + 0.82 * hoverAlpha;
                    ctx.fillStyle = 'rgba(20, 20, 20, 0.95)';
                    ctx.fillRect(labelX, labelY - labelHeight + 2, labelWidth, labelHeight);
                    ctx.globalAlpha = 1;
                    ctx.fillStyle = '#fff';
                    ctx.font = `${11 / this.scale}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.fillText(label, node.x, labelY);
                } else if (this.scale >= 0.9) {
                    ctx.fillStyle = '#fff';
                    ctx.font = `${11 / this.scale}px sans-serif`;
                    ctx.textAlign = 'center';
                    ctx.fillText(label, node.x, labelY);
                }
            }
        }

        ctx.restore();

        // Draw zoom indicator
        ctx.fillStyle = '#888';
        ctx.font = '12px sans-serif';
        ctx.fillText(`Zoom: ${Math.round(this.scale * 100)}%`, 10, height - 10);
    }

    async onClose(): Promise<void> {
        this.stopSimulation();
    }
}

// Runtime type guard for files (TFile is a type-only shape)
function isTFile(obj: any): obj is TFile {
    return !!obj && typeof obj.path === 'string' && typeof obj.basename === 'string';
}