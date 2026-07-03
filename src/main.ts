import { Notice, Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, GraphCrossingSettingTab } from './settings.js';
import type { MyPluginSettings } from './settings.js';
import { GraphCrossingMinimizer } from './graph.js';
import { CustomGraphView, CUSTOM_GRAPH_VIEW_TYPE } from './custom-graph-view.js';

export default class GraphCrossingPlugin extends Plugin {
	settings!: MyPluginSettings;
	graphMinimizer: GraphCrossingMinimizer | undefined;

	async onload() {
		await this.loadSettings();
		// `app` exists at runtime; assert availability
		// @ts-ignore
		this.graphMinimizer = new GraphCrossingMinimizer(this.app);

		this.addCommand({
			id: 'open-graph-view',
			name: 'Open graph view',
			checkCallback: (checking: boolean) => {
				if (checking) return true;
				void this.openCustomGraphView();
				return true;
			}
		});

		this.addCommand({
			id: 'minimize-graph-crossings',
			name: 'Minimize graph crossings',
			checkCallback: (checking: boolean) => {
				if (checking) return !!this.graphMinimizer;
				void this.minimizeCrossings();
				return true;
			}
		});

		this.registerView(CUSTOM_GRAPH_VIEW_TYPE, (leaf: any) => new CustomGraphView(leaf, (this as any).app));
		this.addSettingTab(new GraphCrossingSettingTab((this as any).app, this as any));
	}

	async minimizeCrossings() {
		new Notice('Building graph from vault...');
		if (!this.graphMinimizer) {
			new Notice('Graph minimizer not initialized!');
			return;
		}

		await this.graphMinimizer.buildFromVault();
		const stats = this.graphMinimizer.getOptimizationStats();
		new Notice(`Crossings: ${stats.before} → ${stats.after} (${stats.improvement} reduced)`);
	}

	async openCustomGraphView() {
		const leaves = (this as any).app.workspace.getLeavesOfType(CUSTOM_GRAPH_VIEW_TYPE);
		const syncViewSettings = (view: CustomGraphView) => {
			view.updateForceSettings(this.settings);
		};

		if (leaves.length > 0 && leaves[0]) {
			const view = (leaves[0] as any).view;
			if (view instanceof CustomGraphView) {
				syncViewSettings(view);
			}
			(this as any).app.workspace.setActiveLeaf(leaves[0]);
			return;
		}

		const leaf = (this as any).app.workspace.getLeaf(true);
		// setViewState is provided by Obsidian runtime
		// @ts-ignore
		await leaf.setViewState({ type: CUSTOM_GRAPH_VIEW_TYPE });
		const createdLeaf = (this as any).app.workspace.getLeavesOfType(CUSTOM_GRAPH_VIEW_TYPE).find((candidate: any) => candidate.view instanceof CustomGraphView);
		if (createdLeaf?.view instanceof CustomGraphView) {
			syncViewSettings(createdLeaf.view);
		}
	}

	onunload() {
		// Remove any open custom graph views when the plugin unloads
		try {
			// @ts-ignore runtime API
			this.app.workspace.detachLeavesOfType(CUSTOM_GRAPH_VIEW_TYPE);
		} catch (e) {
			// ignore if API unavailable in tests
		}
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<MyPluginSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
