declare module 'obsidian' {
    export type AnyObject = Record<string, any>;

    export type TFile = {
        path: string;
        basename: string;
        extension: string;
    };

    export type WorkspaceLeaf = AnyObject;

    export type App = AnyObject & {
        vault: Vault;
        workspace: Workspace;
        metadataCache: MetadataCache;
    };

    export class Notice {
        constructor(text: string);
    }

    export class Plugin {
        app: App;
        constructor();
        loadData(): Promise<any>;
        saveData(data: any): Promise<void>;
        addCommand(cmd: any): void;
        registerView(type: string, factory: (leaf: WorkspaceLeaf) => any): void;
        addSettingTab(tab: any): void;
    }

    export class ItemView {
        // containerEl is a DOM wrapper provided by Obsidian with helper methods
        containerEl: any;
        constructor(leaf: WorkspaceLeaf);
        registerDomEvent(target: any, event: string, handler: (...args: any[]) => any): void;
    }

    export class PluginSettingTab {
        // containerEl supports Obsidian helper methods like `empty` and `createEl`
        containerEl: any;
        constructor(app: App, plugin: Plugin);
        display(): void;
    }

    export class Setting {
        constructor(container: any);
        // Description element where Setting may render help text
        descEl: any;
        setName(name: string): this;
        setDesc(desc: string): this;
        addSlider(f: (slider: any) => any): this;
    }

    export interface Workspace {
        getLeavesOfType(type: string): WorkspaceLeaf[];
        getLeaf(open?: boolean): WorkspaceLeaf;
        setActiveLeaf(leaf: WorkspaceLeaf): void;
        getLeavesOfType(type: string): WorkspaceLeaf[];
        // Simplified
        getLeaves(): WorkspaceLeaf[];
    }

    export interface MetadataCache {
        getFileCache(file: TFile): AnyObject | null;
        getFirstLinkpathDest(link: string, sourcePath?: string): TFile | null;
    }

    export interface Vault {
        getFiles(): TFile[];
        cachedRead(file: TFile): Promise<string>;
        getAbstractFileByPath(path: string): any;
        create(path: string, data: string): Promise<TFile>;
        createFolder(path: string): Promise<void>;
    }
}
