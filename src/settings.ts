import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";

// Avoid a hard import of the main plugin class to prevent circular imports.
// Define a minimal plugin interface that this settings tab depends on.
export interface GraphCrossingPluginLike {
	settings: MyPluginSettings;
	saveSettings: () => Promise<void>;
}

export interface MyPluginSettings {
	centeringForce: number;
	repelForce: number;
	linkForce: number;
	linkDistance: number;
}

export const DEFAULT_SETTINGS: MyPluginSettings = {
	centeringForce: 0.005,
	repelForce: 5000,
	linkForce: 0.01,
	linkDistance: 50
};

export class GraphCrossingSettingTab extends PluginSettingTab {
	plugin: GraphCrossingPluginLike;

	constructor(app: App, plugin: GraphCrossingPluginLike) {
		super(app, plugin as any);
		this.plugin = plugin;
	}

	override display(): void {
		// Obsidian provides `containerEl` on PluginSettingTab at runtime
		const containerEl = (this as any).containerEl;

		containerEl.empty();
		containerEl.createEl('h2', { text: 'Graph Force Settings' });

		this.addSliderSetting(
			'Centering Force',
			'How strongly nodes are pulled toward the center (lower = less centering)',
			this.plugin.settings.centeringForce,
			0,
			0.05,
			0.001,
			(value) => {
				this.plugin.settings.centeringForce = value;
			}
		);

		this.addSliderSetting(
			'Repel Force',
			'How strongly nodes push each other apart',
			this.plugin.settings.repelForce,
			1000,
			10000,
			100,
			(value) => {
				this.plugin.settings.repelForce = value;
			}
		);

		this.addSliderSetting(
			'Link Force',
			'How strongly connected nodes are pulled together',
			this.plugin.settings.linkForce,
			0.001,
			0.05,
			0.001,
			(value) => {
				this.plugin.settings.linkForce = value;
			}
		);

		this.addSliderSetting(
			'Link Distance',
			'Minimum distance between connected nodes',
			this.plugin.settings.linkDistance,
			20,
			150,
			5,
			(value) => {
				this.plugin.settings.linkDistance = value;
			}
		);

		// Add Reset to defaults button
		const footer = containerEl.createEl('div', { cls: 'graph-settings-footer' });
		const resetBtn = footer.createEl('button', { text: 'Reset to Defaults' });
		resetBtn.onclick = async () => {
			this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
			await this.plugin.saveSettings();
			this.display();
		};
	}

	private addSliderSetting(
		name: string,
		description: string,
		value: number,
		min: number,
		max: number,
		step: number,
		updateValue: (value: number) => void
	): void {
		// Create the setting and a small value display next to the slider
		const setting = new Setting((this as any).containerEl)
			.setName(name)
			.setDesc(description);

		const valueDisplay = setting.descEl.createEl('span', { text: String(value), cls: 'slider-value' });

		setting.addSlider((slider: any) => slider
			.setLimits(min, max, step)
			.setValue(value)
			.onChange(async (nextValue: number) => {
				valueDisplay.setText(String(nextValue));
				updateValue(nextValue);
				await this.plugin.saveSettings();
			}));
	}
}
