import ObsidianGoogleDrive from "../main";
import { Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import {
	areArrayBuffersEqual,
	batchAsyncs,
	buildConflictPath,
	FileMetadata,
	folderMimeType,
	foldersToBatches,
	getSyncMessage,
	FolderInfo,
	isPluginDataJson,
	resolvePathFromParents,
	searchFilesRecursive,
} from "./drive";
import { getDriveKy, refreshAccessToken } from "./ky";

const CLOCK_SKEW_BUFFER_MS = 60_000;

export const isPathLocallyDeleted = (
	path: string,
	operations: Record<string, "create" | "delete" | "modify">
): boolean => {
	if (operations[path] === "delete") return true;
	const parts = path.split("/");
	for (let i = 1; i < parts.length; i++) {
		const ancestor = parts.slice(0, i).join("/");
		if (operations[ancestor] === "delete") return true;
	}
	return false;
};

export const hasPreservedDescendants = (
	folder: TFolder,
	deletionPathSet: Set<string>,
	operations: Record<string, "create" | "delete" | "modify">
): boolean => {
	for (const child of folder.children) {
		const op = operations[child.path];
		if (op === "create" || op === "modify") {
			return true;
		}
		if (!deletionPathSet.has(child.path)) {
			return true;
		}
		if (
			child instanceof TFolder &&
			hasPreservedDescendants(child, deletionPathSet, operations)
		) {
			return true;
		}
	}
	return false;
};

export const pull = async (
	t: ObsidianGoogleDrive,
	silenceNotices?: boolean
) => {
	let syncNotice: Notice | undefined = undefined;

	if (!silenceNotices) {
		if (t.syncing) return;
		syncNotice = await t.startSync();
	}

	let failedCount = 0;
	let conflictCount = 0;

	try {
		const { vault } = t.app;
		const adapter = vault.adapter;

		if (!t.accessToken.token) await refreshAccessToken(t);

		const rootFolderId = await t.drive.getRootFolderId();
		if (!rootFolderId) {
			new Notice("An error occurred fetching Google Drive root folder.");
			return;
		}

		const changeResult = await t.drive.getChanges(t.settings.changesToken);
		if (!changeResult) {
			new Notice("An error occurred fetching Google Drive changes.");
			return;
		}

		const { changes, newStartPageToken } = changeResult;
		const changedFileIds = new Set(
			changes
				.filter((c) => !c.removed && !c.file?.trashed)
				.map((c) => c.fileId)
		);

		const folderIdToInfo = new Map<string, FolderInfo>();
		const allDriveFiles = await searchFilesRecursive(
			rootFolderId,
			folderIdToInfo,
			getDriveKy(t)
		);

		const recentlyModified = allDriveFiles.filter((f) => {
			const mappedPath = t.settings.driveIdToPath[f.id];
			if (
				mappedPath &&
				isPathLocallyDeleted(mappedPath, t.settings.operations)
			) {
				return false;
			}

			const notInMapping = !(f.id in t.settings.driveIdToPath);
			const inChangesFeed = changedFileIds.has(f.id);
			const modifiedAfterSync =
				new Date(f.modifiedTime).getTime() >
				t.settings.lastSyncedAt - CLOCK_SKEW_BUFFER_MS;

			if (notInMapping || inChangesFeed || modifiedAfterSync) {
				return true;
			}

			if (!mappedPath) {
				return true;
			}

			const localFile = vault.getFileByPath(mappedPath);
			const localFolder = vault.getFolderByPath(mappedPath);
			const localExists = localFile !== null || localFolder !== null;
			return !localExists;
		});

		const resolvePath = (file: FileMetadata): string | null => {
			const resolved = resolvePathFromParents(
				file,
				rootFolderId,
				folderIdToInfo
			);
			if (!resolved) {
				console.warn(
					`[OGD] Skipping file "${file.name}" (ID: ${file.id}) - could not resolve path to root folder`
				);
			}
			return resolved;
		};

		for (const file of allDriveFiles) {
			const path = resolvePath(file);
			if (path) {
				t.settings.driveIdToPath[file.id] = path;
			}
		}

		const pathToId = Object.fromEntries(
			Object.entries(t.settings.driveIdToPath).map(([id, path]) => [
				path,
				id,
			])
		);

		const removedConfigPaths: string[] = [];

		const deletions = changes
			.filter(({ removed, file }) => removed || file?.trashed)
			.map(({ fileId, file }) => {
				const path = t.settings.driveIdToPath[fileId];
				if (!path || isPluginDataJson(path, vault.configDir)) return;

				if (!file?.trashed && file?.parents) {
					const stillInVault = file.parents.some((p) => {
						if (p === rootFolderId) return true;
						const info = folderIdToInfo.get(p);
						if (!info) return false;
						let current = info.parents?.[0];
						const visited = new Set<string>();
						while (current) {
							if (current === rootFolderId) return true;
							if (visited.has(current)) return false;
							visited.add(current);
							const next = folderIdToInfo.get(current);
							if (!next) return false;
							current = next.parents?.[0];
						}
						return false;
					});
					if (stillInVault) {
						return;
					}
				}

				delete t.settings.driveIdToPath[fileId];
				if (pathToId[path] === fileId) {
					delete pathToId[path];
				}

				const localFile = vault.getAbstractFileByPath(path);

				if (!localFile) {
					if (t.settings.operations[path] === "delete") {
						delete t.settings.operations[path];
					} else {
						removedConfigPaths.push(path);
					}
					return;
				}
				return localFile;
			})
			.filter((f): f is TAbstractFile => Boolean(f));

		if (
			!recentlyModified.length &&
			!deletions.length &&
			!removedConfigPaths.length
		) {
			if (newStartPageToken) {
				t.settings.changesToken = newStartPageToken;
			}
			await t.saveSettings();
			if (!silenceNotices) {
				new Notice("You're up to date!");
			}
			return;
		}

		for (const file of recentlyModified) {
			const path = resolvePath(file);
			if (path) {
				pathToId[path] = file.id;
			}
		}

		t.settings.driveIdToPath = Object.fromEntries(
			Object.entries(pathToId).map(([path, id]) => [id, path])
		);

		const deleteFiles = async () => {
			const deletedFiles = deletions
				.filter((file): file is TFile => file instanceof TFile)
				.filter((file) => {
					const op = t.settings.operations[file.path];
					if (op === "modify" || op === "create") {
						if (!pathToId[file.path]) {
							t.settings.operations[file.path] = "create";
						}
						return false;
					}
					return true;
				});

			const deletionPathSet = new Set(deletions.map((file) => file.path));

			const deletedFolders = deletions
				.filter((folder): folder is TFolder => folder instanceof TFolder)
				.filter((folder) => {
					if (pathToId[folder.path]) return false;
					if (
						hasPreservedDescendants(
							folder,
							deletionPathSet,
							t.settings.operations
						)
					) {
						t.settings.operations[folder.path] = "create";
						return false;
					}
					return true;
				});

			await t.drive.deleteFilesMinimumOperations([
				...deletedFolders,
				...deletedFiles,
			]);
		};

		await deleteFiles();

		syncNotice?.setMessage("Syncing (33%)");

		const upsertFiles = async () => {
			const newFolders = recentlyModified.filter(
				({ mimeType }) => mimeType === folderMimeType
			);

			if (newFolders.length) {
				const batches = foldersToBatches(
					newFolders
						.map((f) => resolvePath(f))
						.filter((p): p is string => p !== null)
				);

				for (const batch of batches) {
					await Promise.all(
						batch.map(async (folder) => {
							if (
								isPathLocallyDeleted(
									folder,
									t.settings.operations
								)
							) {
								return;
							}
							delete t.settings.operations[folder];
							if (
								vault.getFolderByPath(folder) ||
								(await adapter.exists(folder))
							) {
								const fileMetadata = recentlyModified.find(
									(f) => resolvePath(f) === folder
								);
								if (fileMetadata) {
									t.settings.driveIdToPath[fileMetadata.id] =
										folder;
								}
								return;
							}
							try {
								await t.createFolder(folder);
							} catch (e) {
								console.error(
									`[OGD] Failed to create folder "${folder}":`,
									e
								);
								failedCount++;
							}
						})
					);
				}
			}

			let completed = 0;

			const newNotes = recentlyModified.filter(
				({ mimeType }) => mimeType !== folderMimeType
			);

			await batchAsyncs(
				newNotes.map((file: FileMetadata) => async () => {
					const resolvedPath = resolvePath(file);
					if (
						!resolvedPath ||
						isPluginDataJson(resolvedPath, vault.configDir) ||
						isPathLocallyDeleted(resolvedPath, t.settings.operations)
					) {
						return;
					}

					const localFile =
						vault.getFileByPath(resolvedPath) ||
						(await adapter.exists(resolvedPath));
					const operation = t.settings.operations[resolvedPath];

					completed++;

					try {
						const content = await t.drive
							.getFile(file.id)
							.arrayBuffer();

						syncNotice?.setMessage(
							getSyncMessage(33, 100, completed, newNotes.length)
						);

						if (
							localFile &&
							(operation === "modify" || operation === "create")
						) {
							const isConfigFile = resolvedPath.startsWith(
								vault.configDir + "/"
							);
							if (operation === "create") {
								t.settings.operations[resolvedPath] = "modify";
							}
							if (!isConfigFile) {
								const localContent =
									localFile instanceof TFile
										? await vault.readBinary(localFile)
										: await adapter.readBinary(resolvedPath);
								if (!areArrayBuffersEqual(localContent, content)) {
									const conflictPath =
										buildConflictPath(resolvedPath);
									await t.upsertFile(
										conflictPath,
										content,
										file.modifiedTime
									);
									conflictCount++;
								}
							}
							return;
						}

						if (localFile instanceof TFile) {
							await t.modifyFile(
								localFile,
								content,
								file.modifiedTime
							);
							return;
						}

						await t.upsertFile(
							resolvedPath,
							content,
							file.modifiedTime
						);
					} catch (e) {
						console.error(
							`[OGD] Failed to pull "${resolvedPath}" (ID: ${file.id}):`,
							e
						);
						failedCount++;
					}
				})
			);
		};

		await upsertFiles();

		const deleteConfigs = async () => {
			if (!removedConfigPaths.length) return;

			const configDeletions = await Promise.all(
				removedConfigPaths.map(async (path) => {
					if (isPluginDataJson(path, vault.configDir)) return;
					if (vault.getAbstractFileByPath(path)) return;
					const stat = await adapter.stat(path);
					if (!stat) return;
					return { path, type: stat.type };
				})
			);

			let configDeletionsFiltered = configDeletions.filter(Boolean) as {
				path: string;
				type: "file" | "folder";
			}[];

			if (!configDeletionsFiltered.length) return;

			const trashMethod = (vault as any).getConfig("trashOption");

			if (trashMethod === "local" || trashMethod === "system") {
				const deletionMethod =
					trashMethod === "local"
						? adapter.trashLocal.bind(adapter)
						: adapter.trashSystem.bind(adapter);

				const folders = configDeletionsFiltered.filter(
					(file) => file.type === "folder"
				);

				if (folders.length) {
					const maxDepth = Math.max(
						...folders.map(({ path }) => path.split("/").length)
					);

					for (let depth = 1; depth <= maxDepth; depth++) {
						const foldersToDelete = configDeletionsFiltered.filter(
							(file) =>
								file.type === "folder" &&
								file.path.split("/").length === depth
						);
						await Promise.all(
							foldersToDelete.map(({ path }) =>
								deletionMethod(path)
							)
						);
						foldersToDelete.forEach(
							(folder) =>
								(configDeletionsFiltered =
									configDeletionsFiltered.filter(
										({ path }) =>
											!path.startsWith(
												folder.path + "/"
											) && path !== folder.path
									))
						);
					}
				}

				await Promise.all(
					configDeletionsFiltered.map(({ path }) =>
						deletionMethod(path)
					)
				);
				return;
			}

			const deletedFiles = configDeletionsFiltered.filter(
				(file) => file.type === "file"
			);
			await Promise.all(
				deletedFiles.map(({ path }) => adapter.remove(path))
			);

			const deletedFolders = configDeletionsFiltered.filter(
				(file) => file.type === "folder"
			);
			const batches = foldersToBatches(
				deletedFolders.map(({ path }) => path)
			);
			batches.reverse();

			for (const batch of batches) {
				await Promise.all(
					batch.map(async (folder) => {
						const list = await adapter.list(folder);
						if (list.files.length + list.folders.length) return;
						await adapter.rmdir(folder, false);
					})
				);
			}
		};

		await deleteConfigs();

		if (failedCount === 0) {
			if (newStartPageToken) {
				t.settings.changesToken = newStartPageToken;
			}
			t.settings.lastSyncedAt = Date.now();
		}
		await t.saveSettings();

		if (conflictCount > 0) {
			new Notice(
				`Sync conflict detected on ${conflictCount} file(s)! Your local changes were kept and cloud versions were saved as "(conflict ...)" copies.`,
				0
			);
		}

		if (!silenceNotices) {
			if (failedCount > 0) {
				new Notice(
					`Pull finished with ${failedCount} error(s). Please try pulling again.`
				);
			} else {
				new Notice("Files have been synced from Google Drive!");
			}
		}
	} finally {
		if (!silenceNotices) {
			await t.endSync(syncNotice);
		}
	}
};
