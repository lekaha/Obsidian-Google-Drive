import ObsidianGoogleDrive from "../main";
import { Notice, TFile, TFolder } from "obsidian";
import {
	batchAsyncs,
	FileMetadata,
	folderMimeType,
	foldersToBatches,
	getSyncMessage,
	FolderInfo,
	resolvePathFromParents,
	searchFilesRecursive,
} from "./drive";
import { getDriveKy } from "./ky";
import { refreshAccessToken } from "./ky";

export const pull = async (
	t: ObsidianGoogleDrive,
	silenceNotices?: boolean
) => {
	let syncNotice: any = null;

	if (!silenceNotices) {
		if (t.syncing) return;
		syncNotice = await t.startSync();
	}

	const { vault } = t.app;
	const adapter = vault.adapter;

	if (!t.accessToken.token) await refreshAccessToken(t);

	const rootFolderId = await t.drive.getRootFolderId();
	if (!rootFolderId) {
		return new Notice("An error occurred fetching Google Drive root folder.");
	}

	const folderIdToInfo = new Map<string, FolderInfo>();
	const allDriveFiles = await searchFilesRecursive(
		rootFolderId,
		folderIdToInfo,
		getDriveKy(t)
	);

	console.log(`[PULL] Total files/folders found: ${allDriveFiles.length}`);
	console.log(`[PULL] Folder ID to Info map size: ${folderIdToInfo.size}`);
	// Log folder ID to info map for debugging
	const folderInfoEntries = Array.from(folderIdToInfo.entries());
	console.log(`[PULL] Folder ID to Info map entries: ${JSON.stringify(folderInfoEntries.map(([id, info]) => `${id} => {name: ${info.name}, parents: ${JSON.stringify(info.parents)}}`))}`);

	// Log all folders for debugging
	const allFolders = allDriveFiles.filter(f => f.mimeType === folderMimeType);
	console.log(`[PULL] All folders found: ${JSON.stringify(allFolders.map(f => ({ name: f.name, id: f.id, parents: f.parents, hasPropertiesPath: !!f.properties?.path })))}`);

	// Log all item names for debugging
	const allNames = allDriveFiles.map(f => f.name);
	console.log(`[PULL] All items found: ${JSON.stringify(allNames)}`);
	
	console.log(`[PULL] career found? ${!!(allDriveFiles.find(f => f.name === "career"))}`, allDriveFiles.find(f => f.name === "career") ? JSON.stringify(allDriveFiles.find(f => f.name === "career")) : "");
	console.log(`[PULL] market-research found? ${!!(allDriveFiles.find(f => f.name === "market-research"))}`, allDriveFiles.find(f => f.name === "market-research") ? JSON.stringify(allDriveFiles.find(f => f.name === "market-research")) : "");

	const recentlyModified = allDriveFiles.filter(
		(f) => {
			const isCareerOrMarket = f.name === "career" || f.name === "market-research";
			const notInMapping = !(f.id in t.settings.driveIdToPath);
			const modifiedAfterSync = new Date(f.modifiedTime).getTime() > t.settings.lastSyncedAt;
			
			if (notInMapping || modifiedAfterSync) {
				if (isCareerOrMarket) console.log(`[PULL FILTER-HIT] ✅ INCLUDING "${f.name}" (${f.id}) - notInMapping: ${notInMapping}, modifiedAfterSync: ${modifiedAfterSync}, mimeType: ${f.mimeType}`);
				console.log(`[PULL FILTER] ✅ INCLUDING "${f.name}" (${f.id}) - notInMapping: ${notInMapping}, modifiedAfterSync: ${modifiedAfterSync}`);
				return true;
			}
			
			const mappedPath = t.settings.driveIdToPath[f.id];
			if (!mappedPath) {
				console.log(`[PULL FILTER] ✅ INCLUDING "${f.name}" (${f.id}) - mappedPath is null (shouldn't happen)`);
				return true;
			}
			
			const localFile = vault.getFileByPath(mappedPath);
			const localFolder = vault.getFolderByPath(mappedPath);
			const localExists = localFile !== null || localFolder !== null;
			const included = !localExists;

			if (isCareerOrMarket) {
				console.log(`[PULL FILTER-HIT] ❌ SKIPPING "${f.name}" (${f.id}) - mappedPath: "${mappedPath}", localFile: ${localFile !== null}, localFolder: ${localFolder?.name || 'N/A'}, localExists: ${localExists}`);
			} else {
				console.log(`[PULL FILTER] ❌ SKIPPING "${f.name}" (${f.id}) - notInMapping: false, modifiedAfterSync: ${modifiedAfterSync}, mappedPath: "${mappedPath}", localExists: ${localExists}`);
			}
			return included;
		}
	);

	console.log(`[PULL FILTER] Summary: ${recentlyModified.length}/${allDriveFiles.length} items included in recentlyModified`);

	const changeResult = await t.drive.getChanges(t.settings.changesToken);
	if (!changeResult) {
		return new Notice("An error occurred fetching Google Drive changes.");
	}

	const { changes, newStartPageToken } = changeResult;

	const resolvePath = (file: FileMetadata): string | null => {
		const resolved = resolvePathFromParents(file, rootFolderId, folderIdToInfo);
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
		Object.entries(t.settings.driveIdToPath).map(([id, path]) => [path, id])
	);

	const deletions = changes
		.filter(({ removed }) => removed)
		.map(({ fileId, file }) => {
			const path = t.settings.driveIdToPath[fileId];
			if (!path) return;

			if (file?.parents) {
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

			const localFile = vault.getAbstractFileByPath(path);

			if (!localFile && t.settings.operations[path] === "delete") {
				delete t.settings.operations[path];
				return;
			}
			return localFile;
		});

	if (!recentlyModified.length && !deletions.length) {
		if (silenceNotices) return;
		await t.endSync(syncNotice);
		return new Notice("You're up to date!");
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
			.filter((file) => file instanceof TFile)
			.filter((file: TFile) => {
				if (t.settings.operations[file.path] === "modify") {
					if (!pathToId[file.path]) {
						t.settings.operations[file.path] = "create";
					}
					return;
				}
				return true;
			}) as TFile[];

		const deletionPaths = deletions.map((file) => file?.path);

		const deletedFolders = deletions
			.filter((folder) => folder instanceof TFolder)
			.filter((folder: TFolder) => {
				if (pathToId[folder.path]) return;
				if (
					folder.children.find(
						({ path }) => !deletionPaths.includes(path)
					)
				) {
					return true;
				}
				t.settings.operations[folder.path] = "create";
			}) as TFolder[];

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

		console.log(`[PULL] newFolders count: ${newFolders.length}`);
		const newFolderNames = newFolders.map(f => f.name);
		console.log(`[PULL] newFolders includes 'career'? ${newFolderNames.includes('career')}`);
		console.log(`[PULL] newFolders includes 'market-research'? ${newFolderNames.includes('market-research')}`);

		const folderPaths = newFolders.map(f => ({
			name: f.name,
			id: f.id,
			parents: f.parents,
			path: resolvePath(f)
		}));
		console.log(`[PULL] All folders and resolved paths:`);
		for (const fp of folderPaths) {
			console.log(`  ${fp.name} (${fp.id}) parents: ${JSON.stringify(fp.parents)} => path: ${fp.path || 'NULL (UNRESOLVABLE)'}`);
		}

		if (newFolders.length) {
			const batches = foldersToBatches(
				newFolders
					.map((f) => resolvePath(f))
					.filter((p): p is string => p !== null)
			);

			console.log(`[PULL] Folder batches (total ${batches.length}):`);
			batches.forEach((batch, i) => {
				console.log(`  Batch ${i} (depth ${i+1}): ${batch.join(", ") || "(empty)"}`);
			});

			for (const batch of batches) {
				await Promise.all(
					batch.map(async (folder) => {
						const isCareerOrMarket = folder.includes("career") || folder.includes("market-research");
						if (isCareerOrMarket) console.log(`[CREATEFOLDER-HIT] Processing folder: ${folder}`);
						console.log(`[PULL] Processing folder: ${folder}`);
						delete t.settings.operations[folder];
						if (
							vault.getFolderByPath(folder) ||
							(await adapter.exists(folder))
						) {
							if (isCareerOrMarket) console.log(`[CREATEFOLDER-HIT] Folder already exists, skipping: ${folder}`);
							console.log(`[PULL] Folder already exists, skipping: ${folder}`);
							
							// FIX: Track existing folders so they aren't stuck in "new" status
							const fileMetadata = recentlyModified.find(f => resolvePath(f) === folder);
							if (fileMetadata) {
								t.settings.driveIdToPath[fileMetadata.id] = folder;
							}
							return;
						}
						console.log(`[PULL] Creating folder: ${folder}`);
						if (isCareerOrMarket) console.log(`[CREATEFOLDER-HIT] Calling createFolder for: ${folder}`);
						try {
							await t.createFolder(folder);
							if (isCareerOrMarket) console.log(`[CREATEFOLDER-HIT] createFolder succeeded for: ${folder}`);
						} catch (e: any) {
							console.log(`[CREATEFOLDER-HIT] createFolder FAILED for "${folder}" with error: ${e?.message || e}`);
							throw e;
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
				if (!resolvedPath) return;

				const localFile =
					vault.getFileByPath(resolvedPath) ||
					(await adapter.exists(resolvedPath));
				const operation = t.settings.operations[resolvedPath];

				completed++;

				if (localFile && operation === "modify") {
					return;
				}

				if (localFile && operation === "create") {
					t.settings.operations[resolvedPath] = "modify";
					return;
				}

				const content = await t.drive.getFile(file.id).arrayBuffer();

				syncNotice?.setMessage(
					getSyncMessage(33, 100, completed, newNotes.length)
				);

				if (localFile instanceof TFile) {
					return t.modifyFile(localFile, content, file.modifiedTime);
				}

				return t.upsertFile(
					resolvedPath,
					content,
					file.modifiedTime
				);
			})
		);
	};

	await upsertFiles();

	const deleteConfigs = async () => {
		const configDeletions = await Promise.all(
			changes
				.filter(({ removed }) => removed)
				.map(async ({ fileId }) => {
					const path = t.settings.driveIdToPath[fileId];
					if (!path || vault.getAbstractFileByPath(path)) return;
					const stat = await adapter.stat(path);
					if (!stat) return;
					return { path, type: stat.type };
				})
		);

		let configDeletionsFiltered = configDeletions.filter(Boolean) as {
			path: string;
			type: "file" | "folder";
		}[];

		const trashMethod = (vault as any).getConfig("trashOption");

		if (trashMethod === "local" || trashMethod === "system") {
			const deletionMethod =
				trashMethod === "local"
					? adapter.trashLocal
					: adapter.trashSystem;

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
						foldersToDelete.map(({ path }) => deletionMethod(path))
					);
					foldersToDelete.forEach(
						(folder) =>
							(configDeletionsFiltered =
								configDeletionsFiltered.filter(
									({ path }) =>
										!path.startsWith(folder.path + "/") &&
										path !== folder.path
								))
					);
				}
			}

			return Promise.all(
				configDeletionsFiltered.map(({ path }) => deletionMethod(path))
			);
		}

		const deletedFiles = configDeletionsFiltered.filter(
			(file) => file.type === "file"
		);
		await Promise.all(deletedFiles.map(({ path }) => adapter.remove(path)));

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
					adapter.rmdir(folder, false);
				})
			);
		}
	};

	await deleteConfigs();

	if (newStartPageToken) {
		t.settings.changesToken = newStartPageToken;
	}
	t.settings.lastSyncedAt = Date.now();
	await t.saveSettings();

	if (silenceNotices) return;

	await t.endSync(syncNotice);

	new Notice("Files have been synced from Google Drive!");
};
