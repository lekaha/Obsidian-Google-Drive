import { checkConnection, getDriveClient } from "helpers/drive";
import { refreshAccessToken } from "helpers/ky";
import { startAuthFlow, type PkceState } from "helpers/oauth";
import { pull } from "helpers/pull";
import { push } from "helpers/push";
import { reset } from "helpers/reset";
import {
	App,
	debounce,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	Menu,
} from "obsidian";

interface PluginSettings {
	refreshToken: string;
	clientId: string;
	clientSecret: string;
	operations: Record<string, "create" | "delete" | "modify">;
	driveIdToPath: Record<string, string>;
	lastSyncedAt: number;
	changesToken: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
	refreshToken: "",
	clientId: "",
	clientSecret: "",
	operations: {},
	driveIdToPath: {},
	lastSyncedAt: 0,
	changesToken: "",
};

export default class ObsidianGoogleDrive extends Plugin {
	settings: PluginSettings;
	accessToken = {
		token: "",
		expiresAt: 0,
	};
	pkceState: PkceState | undefined;
	drive = getDriveClient(this);
	ribbonIcon: HTMLElement;
	syncing: boolean;

	async onload() {
		const { vault } = this.app;

		await this.loadSettings();

		this.addSettingTab(new SettingsTab(this.app, this));

		if (!this.settings.refreshToken && !this.settings.clientId) {
			new Notice(
				"Please add your refresh token to Google Drive Sync through our website or our readme/this plugin's settings. If you haven't already, PLEASE read through this plugin's readme or website CAREFULLY for instructions on how to use this plugin. If you don't know what you're doing, your data could get DELETED.",
				0
			);
			return;
		}

		if (!this.settings.refreshToken && this.settings.clientId) {
			new Notice(
				"Client ID configured. Click 'Authenticate' in settings to sign in with Google.",
				0
			);
		}

		this.ribbonIcon = this.addRibbonIcon(
			"refresh-cw",
			"Obsidian Google Drive",
			(event) => {
				if (this.syncing) return;
				const menu = new Menu();

				menu.addItem((item) =>
					item
						.setTitle("Pull from Drive")
						.setIcon("cloud-download")
						.onClick(() => {
							pull(this);
						})
				);

				menu.addItem((item) =>
					item
						.setTitle("Push to Drive")
						.setIcon("cloud-upload")
						.onClick(() => {
							push(this);
						})
				);
				menu.addItem((item) =>
					item
						.setTitle("Reset from Drive")
						.setIcon("triangle-alert")
						.onClick(() => {
							reset(this);
						})
				);
				menu.showAtMouseEvent(event);
			}
		);

		this.addCommand({
			id: "push",
			name: "Push to Google Drive",
			callback: () => push(this),
		});

		this.addCommand({
			id: "pull",
			name: "Pull from Google Drive",
			callback: () => pull(this),
		});

		this.addCommand({
			id: "reset",
			name: "Reset local vault to Google Drive",
			callback: () => reset(this),
		});

		this.registerEvent(
			this.app.workspace.on("quit", () => this.saveSettings())
		);

		this.app.workspace.onLayoutReady(() =>
			this.registerEvent(vault.on("create", this.handleCreate.bind(this)))
		);
		this.registerEvent(vault.on("delete", this.handleDelete.bind(this)));
		this.registerEvent(vault.on("modify", this.handleModify.bind(this)));

		if (this.settings.refreshToken) {
			if (!this.settings.changesToken) {
				const initialToken = await this.drive.getChangesStartToken();
				if (initialToken) {
					this.settings.changesToken = initialToken;
					await this.saveSettings();
				}
			}

			checkConnection().then(async (connected) => {
				if (connected) {
					this.syncing = true;
					this.ribbonIcon.addClass("spin");
					await pull(this, true);
					await this.endSync();
				}
			});
		} else if (this.settings.clientId) {
			new Notice(
				"Click 'Authenticate' in settings to sign in with Google.",
				0
			);
		}
	}

	onunload() {
		return this.saveSettings();
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	saveSettings() {
		return this.saveData(this.settings);
	}

	debouncedSaveSettings = debounce(this.saveSettings.bind(this), 500, true);

	handleCreate(file: TAbstractFile) {
		if (this.settings.operations[file.path] === "delete") {
			if (file instanceof TFile) {
				this.settings.operations[file.path] = "modify";
			} else {
				delete this.settings.operations[file.path];
			}
		} else {
			this.settings.operations[file.path] = "create";
		}
		this.debouncedSaveSettings();
	}

	handleDelete(file: TAbstractFile) {
		if (this.settings.operations[file.path] === "create") {
			delete this.settings.operations[file.path];
		} else {
			this.settings.operations[file.path] = "delete";
		}
		this.debouncedSaveSettings();
	}

	handleModify(file: TFile) {
		const operation = this.settings.operations[file.path];
		if (operation === "create" || operation === "modify") {
			return;
		}
		this.settings.operations[file.path] = "modify";
		this.debouncedSaveSettings();
	}

	handleRename(file: TAbstractFile, oldPath: string) {
		this.handleDelete({ ...file, path: oldPath });
		this.handleCreate(file);
		this.debouncedSaveSettings();
	}

	async createFolder(path: string) {
		console.log(`[CREATEFOLDER] Attempting to create folder: "${path}"`);
		const isCareerOrMarket = path.includes("career") || path.includes("market-research");
		if (isCareerOrMarket) console.log(`[CREATEFOLDER-HIT] main.createFolder called for: "${path}"`);
		const parentPath = path.split("/").slice(0, -1).join("/");
		if (parentPath) {
			const parentExists = this.app.vault.getFolderByPath(parentPath) || await this.app.vault.adapter.exists(parentPath);
			if (isCareerOrMarket) console.log(`[CREATEFOLDER-HIT] Parent folder "${parentPath}" exists: ${!!parentExists}`);
			if (!parentExists) {
				console.log(`[CREATEFOLDER] WARNING: Parent folder "${parentPath}" does NOT exist for "${path}"!`);
			}
		}
		const oldOperation = this.settings.operations[path];
		try {
			await this.app.vault.createFolder(path);
			if (isCareerOrMarket) console.log(`[CREATEFOLDER-HIT] main.createFolder succeeded for: "${path}"`);
		} catch (e: any) {
			console.log(`[CREATEFOLDER] FAILED to create "${path}": ${e?.message || e}`);
			throw e;
		}
		this.settings.operations[path] = oldOperation;
		if (!oldOperation) delete this.settings.operations[path];
	}

	async createFile(
		path: string,
		content: ArrayBuffer,
		modificationDate?: number | string | Date
	) {
		const oldOperation = this.settings.operations[path];
		if (typeof modificationDate === "string") {
			modificationDate = new Date(modificationDate);
		}
		if (modificationDate instanceof Date) {
			modificationDate = modificationDate.getTime();
		}

		await this.app.vault.createBinary(path, content, {
			mtime: modificationDate,
		});
		this.settings.operations[path] = oldOperation;
		if (!oldOperation) delete this.settings.operations[path];
	}

	async modifyFile(
		file: TFile,
		content: ArrayBuffer,
		modificationDate?: number | string | Date
	) {
		const oldOperation = this.settings.operations[file.path];
		if (typeof modificationDate === "string") {
			modificationDate = new Date(modificationDate);
		}
		if (modificationDate instanceof Date) {
			modificationDate = modificationDate.getTime();
		}

		await this.app.vault.modifyBinary(file, content, {
			mtime: modificationDate,
		});
		this.settings.operations[file.path] = oldOperation;
		if (!oldOperation) delete this.settings.operations[file.path];
	}

	async upsertFile(
		file: string,
		content: ArrayBuffer,
		modificationDate?: number | string | Date
	) {
		const oldOperation = this.settings.operations[file];
		if (typeof modificationDate === "string") {
			modificationDate = new Date(modificationDate);
		}
		if (modificationDate instanceof Date) {
			modificationDate = modificationDate.getTime();
		}

		await this.app.vault.adapter.writeBinary(file, content, {
			mtime: modificationDate,
		});
		this.settings.operations[file] = oldOperation;
		if (!oldOperation) delete this.settings.operations[file];
	}

	async deleteFile(file: TAbstractFile) {
		const oldOperation = this.settings.operations[file.path];
		await this.app.fileManager.trashFile(file);
		delete this.settings.operations[file.path];
		if (!oldOperation) delete this.settings.operations[file.path];
	}

	async startSync() {
		if (!(await checkConnection())) {
			throw new Notice(
				"You are not connected to the internet, so you cannot sync right now. Please try syncing once you have connection again."
			);
		}
		this.ribbonIcon.addClass("spin");
		this.syncing = true;
		return new Notice("Syncing (0%)", 0);
	}

	async endSync(syncNotice?: Notice, retainConfigChanges = true) {
		if (retainConfigChanges) {
			const configFilesToSync = await this.drive.getConfigFilesToSync();

			this.settings.lastSyncedAt = Date.now();

			await Promise.all(
				configFilesToSync.map(async (file) =>
					this.app.vault.adapter.writeBinary(
						file,
						await this.app.vault.adapter.readBinary(file),
						{ mtime: Date.now() }
					)
				)
			);
		} else {
			this.settings.lastSyncedAt = Date.now();
		}

		await this.saveSettings();
		this.ribbonIcon.removeClass("spin");
		this.syncing = false;
		syncNotice?.hide();
	}
}

class SettingsTab extends PluginSettingTab {
	plugin: ObsidianGoogleDrive;

	constructor(app: App, plugin: ObsidianGoogleDrive) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		const { vault } = this.app;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Google Drive Sync Setup" });

		containerEl.createEl("p", {
			text: "Configure your Google Cloud credentials to authenticate with Google Drive. Follow the step-by-step guide below to create your credentials.",
		});

		const setupLink = containerEl.createEl("a", {
			href: "https://developers.google.com/workspace/guides/configure-oauth-consent",
			text: "Setup Instructions: Configure Google Cloud OAuth",
		});
		setupLink.setAttr("target", "_blank");

		containerEl.createEl("br");

		new Setting(containerEl)
			.setName("Google Client ID")
			.setDesc(
				"Your Google Cloud OAuth 2.0 Client ID. Required for authentication."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your Client ID")
					.setValue(this.plugin.settings.clientId)
					.onChange(async (value) => {
						this.plugin.settings.clientId = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Google Client Secret (optional)")
			.setDesc(
				"Your Google Cloud OAuth 2.0 Client Secret. Optional for PKCE flow."
			)
			.addText((text) =>
				text
					.setPlaceholder("Enter your Client Secret (optional)")
					.setValue(this.plugin.settings.clientSecret)
					.onChange(async (value) => {
						this.plugin.settings.clientSecret = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Authenticate with Google")
			.setDesc(
				this.plugin.settings.refreshToken
					? "Currently authenticated. Click to re-authenticate."
					: this.plugin.settings.clientId
						? "Click to start the Google authentication flow."
						: "Enter your Client ID first, then click to authenticate."
			)
			.addButton((button) =>
				button
					.setButtonText("Authenticate")
					.setCta()
					.onClick(async () => {
						if (!this.plugin.settings.clientId) {
							new Notice(
								"Please enter your Google Client ID first."
							);
							return;
						}

						try {
							await startAuthFlow(this.plugin);
						} catch (e: any) {
							new Notice(`Authentication error: ${e.message || e}`);
						}
					})
			);

		containerEl.createEl("br");
		containerEl.createEl("h3", { text: "Legacy Authentication" });

		containerEl.createEl("p", {
			text: "If you have an existing refresh token from the previous authentication method, you can enter it below. This method is deprecated.",
			cls: "mod-warning",
		});

		new Setting(containerEl)
			.setName("Legacy Refresh Token")
			.setDesc(
				"Deprecated: Use the PKCE authentication flow above instead."
			)
			.addText((text) => {
				const cancel = () => {
					this.plugin.settings.refreshToken = "";
					text.setValue("");
					return this.plugin.saveSettings();
				};

				text.setPlaceholder("Enter your legacy refresh token")
					.setValue(this.plugin.settings.refreshToken)
					.onChange(async (value) => {
						this.plugin.settings.refreshToken = value;
						if (!value) {
							return this.plugin.debouncedSaveSettings();
						}
						if (!(await refreshAccessToken(this.plugin))) {
							text.setValue("");
							return;
						}
						if (
							vault
								.getAllLoadedFiles()
								.filter(({ path }) => path !== "/").length > 0
						) {
							new Notice(
								"Your current vault is not empty! If you want our plugin to handle the initial sync, you have to clear out the current vault. Check the readme or website for more details.",
								0
							);
							return cancel();
						}

						const changesToken =
							await this.plugin.drive.getChangesStartToken();
						if (!changesToken) {
							return new Notice(
								"An error occurred fetching Google Drive changes token."
							);
						}
						this.plugin.settings.changesToken = changesToken;

						await this.plugin.saveSettings();
						new Notice(
							"Refresh token saved! Reload Obsidian to activate sync.",
							0
						);
					});
			});
	}
}
