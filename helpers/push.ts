import ObsidianGoogleDrive from "main";
import { Modal, Notice, setIcon, Setting, TFile, TFolder } from "obsidian";
import {
	batchAsyncs,
	fileNameFromPath,
	folderMimeType,
	foldersToBatches,
	getSyncMessage,
} from "./drive";
import { pull } from "./pull";

class ConfirmPushModal extends Modal {
	proceed: (res: boolean) => void;

	constructor(
		t: ObsidianGoogleDrive,
		initialOperations: [string, "create" | "delete" | "modify"][],
		proceed: (res: boolean) => void
	) {
		super(t.app);
		this.proceed = proceed;

		this.setTitle("Push confirmation");
		this.contentEl
			.createEl("p")
			.setText(
				"Do you want to push the following changes to Google Drive:"
			);
		const container = this.contentEl.createEl("div");

		const render = (operations: typeof initialOperations) => {
			container.empty();
			operations.map(([path, op]) => {
				const div = container.createDiv();
				div.addClass("operation-container");

				const p = div.createEl("p");
				p.createEl("b").setText(`${op[0].toUpperCase()}${op.slice(1)}`);
				p.createSpan().setText(`: ${path}`);

				if (
					op === "delete" &&
					operations.some(([file]) => path.startsWith(file + "/"))
				) {
					return;
				}

				const btn = div.createDiv().createEl("button");
				setIcon(btn, "trash-2");
				btn.onclick = async () => {
					const nestedFiles = operations
						.map(([file]) => file)
						.filter(
							(file) =>
								file.startsWith(path + "/") || file === path
						);
					const proceed = await new Promise<boolean>((resolve) => {
						new ConfirmUndoModal(
							t,
							op,
							nestedFiles,
							resolve
						).open();
					});

					if (!proceed) return;

					nestedFiles.forEach(
						(file) => delete t.settings.operations[file]
					);
					const newOperations = operations.filter(
						([file]) => !nestedFiles.includes(file)
					);
					if (!newOperations.length) return this.close();
					render(newOperations);
				};
			});
		};

		render(initialOperations);

		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((btn) =>
				btn
					.setButtonText("Confirm")
					.setCta()
					.onClick(() => {
						proceed(true);
						this.close();
					})
			);
	}

	onClose() {
		this.proceed(false);
	}
}

class ConfirmUndoModal extends Modal {
	proceed: (res: boolean) => void;
	t: ObsidianGoogleDrive;
	filePathToId: Record<string, string>;

	constructor(
		t: ObsidianGoogleDrive,
		operation: "create" | "delete" | "modify",
		files: string[],
		proceed: (res: boolean) => void
	) {
		super(t.app);
		this.t = t;
		this.filePathToId = Object.fromEntries(
			Object.entries(this.t.settings.driveIdToPath).map(([id, path]) => [
				path,
				id,
			])
		);

		const operationMap = {
			create: "creating",
			delete: "deleting",
			modify: "modifying",
		};

		this.setTitle("Undo confirmation");
		this.contentEl
			.createEl("p")
			.setText(
				`Are you sure you want to undo ${operationMap[operation]} the following file(s):`
			);
		this.contentEl.createEl("ul").append(
			...files.map((file) => {
				const li = this.contentEl.createEl("li");
				li.addClass("operation-file");
				li.setText(file);
				return li;
			})
		);
		this.proceed = proceed;
		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((btn) =>
				btn
					.setButtonText("Confirm")
					.setCta()
					.onClick(async () => {
						btn.setDisabled(true);
						if (operation === "delete") {
							await this.handleDelete(files);
						}
						if (operation === "create") {
							await this.handleCreate(files[0]);
						}
						if (operation === "modify") {
							await this.handleModify(files[0]);
						}
						proceed(true);
						this.close();
					})
			);
	}

	onClose() {
		this.proceed(false);
	}

	async handleDelete(paths: string[]) {
		const files = await this.t.drive.searchFiles({
			include: ["id", "mimeType", "properties", "modifiedTime"],
			matches: paths.map((path) => ({ properties: { path } })),
		});
		if (!files) {
			return new Notice("An error occurred fetching Google Drive files.");
		}

		const pathToFile = Object.fromEntries(
			files.map((file) => [file.properties.path, file])
		);

		const deletedFolders = paths.filter(
			(path) => pathToFile[path]?.mimeType === folderMimeType
		);

		if (deletedFolders.length) {
			const batches = foldersToBatches(deletedFolders);

			for (const batch of batches) {
				await Promise.all(
					batch.map((folder) => this.t.createFolder(folder))
				);
			}
		}

		const deletedFiles = paths.filter(
			(path) => pathToFile[path] && pathToFile[path].mimeType !== folderMimeType
		);

		await batchAsyncs(
			deletedFiles.map((path) => async () => {
				const onlineFile = await this.t.drive
					.getFile(this.filePathToId[path])
					.arrayBuffer();
				if (!onlineFile) {
					return new Notice(
						"An error occurred fetching Google Drive files."
					);
				}
				return this.t.createFile(
					path,
					onlineFile,
					pathToFile[path].modifiedTime
				);
			})
		);
	}

	async handleCreate(path: string) {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!file) return;
		return this.t.deleteFile(file);
	}

	async handleModify(path: string) {
		const file = this.app.vault.getFileByPath(path);
		if (!file) return;

		const [onlineFile, metadata] = await Promise.all([
			this.t.drive.getFile(this.filePathToId[path]).arrayBuffer(),
			this.t.drive.getFileMetadata(this.filePathToId[path]),
		]);
		if (!onlineFile || !metadata) {
			return new Notice("An error occurred fetching Google Drive files.");
		}
		return this.t.modifyFile(file, onlineFile, metadata.modifiedTime);
	}
}

export const findUntrackedLocalPaths = (
	allPaths: string[],
	driveIdToPath: Record<string, string>,
	operations: Record<string, "create" | "delete" | "modify">,
	configDir: string
): string[] => {
	const trackedPaths = new Set(Object.values(driveIdToPath));
	const configPrefix = configDir + "/";

	return allPaths.filter((p) => {
		if (!p || p === "/") return false;
		if (p === configDir || p.startsWith(configPrefix)) return false;
		if (trackedPaths.has(p)) return false;
		if (p in operations) return false;
		return true;
	});
};

export const queueUntrackedLocalFiles = async (t: ObsidianGoogleDrive) => {
	if (t.syncing) return;

	const { vault } = t.app;
	const allPaths = vault.getAllLoadedFiles().map((f) => f.path);
	const untracked = findUntrackedLocalPaths(
		allPaths,
		t.settings.driveIdToPath,
		t.settings.operations,
		vault.configDir
	);

	if (untracked.length === 0) {
		new Notice("All local files are already tracked on Google Drive.");
		return;
	}

	for (const p of untracked) {
		t.settings.operations[p] = "create";
	}
	await t.saveSettings();

	new Notice(
		`Queued ${untracked.length} untracked local item(s). Review and confirm to push.`
	);
	await push(t);
};

export const push = async (t: ObsidianGoogleDrive) => {
	if (t.syncing) return;
	const initialOperations = Object.entries(t.settings.operations).sort(
		([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
	); // Alphabetical

	const { vault } = t.app;
	const adapter = vault.adapter;

	const proceed = await new Promise<boolean>((resolve) => {
		new ConfirmPushModal(t, initialOperations, resolve).open();
	});

	if (!proceed) return;

	const syncNotice = await t.startSync();
	let failedCount = 0;

	try {
		await pull(t, true);

		const operations = Object.entries(t.settings.operations);

		const deletes = operations.filter(([_, op]) => op === "delete");
		const creates = operations.filter(([_, op]) => op === "create");
		const modifies = operations.filter(([_, op]) => op === "modify");

		const pathsToIds = Object.fromEntries(
			Object.entries(t.settings.driveIdToPath).map(([id, path]) => [
				path,
				id,
			])
		);

		const configOnDrive = await t.drive.searchFiles({
			include: ["properties"],
			matches: [{ properties: { config: "true" } }],
		});
		if (!configOnDrive) {
			new Notice("An error occurred fetching Google Drive files.");
			return;
		}

		await Promise.all(
			configOnDrive.map(async ({ properties }) => {
				if (
					properties?.path &&
					!(await adapter.exists(properties.path))
				) {
					deletes.push([properties.path, "delete"]);
				}
			})
		);

		if (deletes.length) {
			const deletesWithIds = deletes.filter(([path]) => Boolean(pathsToIds[path]));
			const deletesWithoutIds = deletes.filter(([path]) => !pathsToIds[path]);

			deletesWithoutIds.forEach(([path]) => {
				delete t.settings.operations[path];
			});

			if (deletesWithIds.length) {
				const deleteRequest = await t.drive.batchDelete(
					deletesWithIds.map(([path]) => pathsToIds[path])
				);
				if (deleteRequest === undefined) {
					failedCount += deletesWithIds.length;
					new Notice("An error occurred deleting Google Drive files.");
				} else {
					deletesWithIds.forEach(([path]) => {
						const id = pathsToIds[path];
						if (id) delete t.settings.driveIdToPath[id];
						delete pathsToIds[path];
						delete t.settings.operations[path];
					});
				}
			}
		}

		syncNotice.setMessage("Syncing (33%)");

		if (creates.length) {
			let completed = 0;
			const resolvedCreates = creates.map(([path]) => ({
				path,
				file: vault.getAbstractFileByPath(path),
			}));

			// Clean up stale create operations for files that no longer exist locally
			resolvedCreates
				.filter(({ file }) => !file)
				.forEach(({ path }) => delete t.settings.operations[path]);

			const files = resolvedCreates
				.map(({ file }) => file)
				.filter(Boolean);

			const folders = files.filter(
				(file) => file instanceof TFolder
			) as TFolder[];

			if (folders.length) {
				const batches = foldersToBatches(folders);

				for (const batch of batches) {
					await batchAsyncs(
						batch.map((folder) => async () => {
							const parentPath = folder.parent?.path || "";
							const isRootChild = !parentPath || parentPath === "/";
							const parentId = isRootChild
								? undefined
								: pathsToIds[parentPath];

							if (!isRootChild && !parentId) {
								failedCount++;
								return;
							}

							const id = await t.drive.createFolder({
								name: folder.name,
								parent: parentId,
								properties: { path: folder.path },
							});
							if (!id) {
								failedCount++;
								new Notice(
									"An error occurred creating Google Drive folders."
								);
								return;
							}

							completed++;
							syncNotice.setMessage(
								getSyncMessage(33, 66, completed, files.length)
							);

							t.settings.driveIdToPath[id] = folder.path;
							pathsToIds[folder.path] = id;
							delete t.settings.operations[folder.path];
						})
					);
				}
			}

			const notes = files.filter((file) => file instanceof TFile) as TFile[];

			await batchAsyncs(
				notes.map((note) => async () => {
					const parentPath = note.parent?.path || "";
					const isRootChild = !parentPath || parentPath === "/";
					const parentId = isRootChild
						? undefined
						: pathsToIds[parentPath];

					if (!isRootChild && !parentId) {
						failedCount++;
						return;
					}

					const id = await t.drive.uploadFile(
						new Blob([await vault.readBinary(note)]),
						note.name,
						parentId,
						{
							properties: { path: note.path },
						}
					);
					if (!id) {
						failedCount++;
						new Notice(
							"An error occurred creating Google Drive files."
						);
						return;
					}

					completed++;
					syncNotice.setMessage(
						getSyncMessage(33, 66, completed, files.length)
					);

					t.settings.driveIdToPath[id] = note.path;
					pathsToIds[note.path] = id;
					delete t.settings.operations[note.path];
				})
			);
		}

		if (modifies.length) {
			let completed = 0;

			const files = modifies
				.map(([path]) => {
					const file = vault.getFileByPath(path);
					if (!file) delete t.settings.operations[path];
					return file;
				})
				.filter((file): file is TFile => file instanceof TFile);

			const pathToId = Object.fromEntries(
				Object.entries(t.settings.driveIdToPath).map(([id, path]) => [
					path,
					id,
				])
			);

			await batchAsyncs(
				files.map((file) => async () => {
					const existingId = pathToId[file.path];
					let id: string | undefined;

					if (existingId) {
						id = await t.drive.updateFile(
							existingId,
							new Blob([await vault.readBinary(file)]),
							{}
						);
					} else {
						const parentPath = file.parent?.path || "";
						const isRootChild = !parentPath || parentPath === "/";
						const parentId = isRootChild
							? undefined
							: pathToId[parentPath];

						if (!isRootChild && !parentId) {
							failedCount++;
							return;
						}

						id = await t.drive.uploadFile(
							new Blob([await vault.readBinary(file)]),
							file.name,
							parentId,
							{ properties: { path: file.path } }
						);
						if (id) {
							t.settings.driveIdToPath[id] = file.path;
							pathsToIds[file.path] = id;
						}
					}

					if (!id) {
						failedCount++;
						new Notice(
							"An error occurred modifying Google Drive files."
						);
						return;
					}

					delete t.settings.operations[file.path];
					completed++;
					syncNotice.setMessage(
						getSyncMessage(66, 99, completed, files.length)
					);
				})
			);
		}

		const configFilesToSync = await t.drive.getConfigFilesToSync();

		const foldersToCreate = new Set<string>();
		configFilesToSync.forEach((path) => {
			const parts = path.split("/");
			for (let i = 1; i < parts.length; i++) {
				foldersToCreate.add(parts.slice(0, i).join("/"));
			}
		});

		foldersToCreate.forEach((folder) => {
			if (pathsToIds[folder]) foldersToCreate.delete(folder);
		});

		if (foldersToCreate.size) {
			const batches = foldersToBatches(Array.from(foldersToCreate));

			for (const batch of batches) {
				await batchAsyncs(
					batch.map((folder) => async () => {
						const id = await t.drive.createFolder({
							name: folder.split("/").pop() || "",
							parent: pathsToIds[
								folder.split("/").slice(0, -1).join("/")
							],
							properties: { path: folder, config: "true" },
						});
						if (!id) {
							failedCount++;
							new Notice(
								"An error occurred creating Google Drive folders."
							);
							return;
						}

						t.settings.driveIdToPath[id] = folder;
						pathsToIds[folder] = id;
					})
				);
			}
		}

		await batchAsyncs(
			configFilesToSync.map((path) => async () => {
				if (pathsToIds[path]) {
					const updated = await t.drive.updateFile(
						pathsToIds[path],
						new Blob([await adapter.readBinary(path)]),
						{}
					);
					if (!updated) failedCount++;
					return;
				}

				const id = await t.drive.uploadFile(
					new Blob([await adapter.readBinary(path)]),
					fileNameFromPath(path),
					pathsToIds[path.split("/").slice(0, -1).join("/")],
					{
						properties: { path, config: "true" },
					}
				);
				if (!id) {
					failedCount++;
					new Notice(
						"An error occurred creating Google Drive config files."
					);
					return;
				}

				t.settings.driveIdToPath[id] = path;
				pathsToIds[path] = id;
			})
		);

		if (failedCount > 0) {
			new Notice(
				`Push finished with ${failedCount} failed item(s). Failed changes were kept in queue to retry next push.`,
				0
			);
		} else {
			new Notice("Sync complete!");
		}
	} finally {
		await t.endSync(syncNotice, false);
	}
};
