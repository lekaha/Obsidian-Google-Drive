import ky from "ky";
import ObsidianGoogleDrive from "../main";
import { getDriveKy } from "./ky";
import { TAbstractFile, TFolder } from "obsidian";

export interface FileMetadata {
	id: string;
	name: string;
	description: string;
	mimeType: string;
	starred: boolean;
	properties: Record<string, string>;
	modifiedTime: string;
	parents?: string[];
	ownedByMe?: boolean;
	shortcutDetails?: {
		targetId: string;
		targetMimeType: string;
	};
}

export interface FolderInfo {
	name: string;
	parents: string[];
}

type StringSearch = string | { contains: string } | { not: string };
type DateComparison = { eq: string } | { gt: string } | { lt: string };

interface QueryMatch {
	name?: StringSearch | StringSearch[];
	mimeType?: StringSearch | StringSearch[];
	parent?: string;
	starred?: boolean;
	query?: string;
	properties?: Record<string, string>;
	modifiedTime?: DateComparison;
}

export const folderMimeType = "application/vnd.google-apps.folder";

const BLACKLISTED_CONFIG_FILES = [
	"graph.json",
	"workspace.json",
	"workspace-mobile.json",
];

const WHITELISTED_PLUGIN_FILES = [
	"manifest.json",
	"styles.css",
	"main.js",
	"data.json",
];

const stringSearchToQuery = (search: StringSearch) => {
	if (typeof search === "string") return `='${search}'`;
	if ("contains" in search) return ` contains '${search.contains}'`;
	if ("not" in search) return `!='${search.not}'`;
};

const queryHandlers = {
	name: (name: StringSearch) => "name" + stringSearchToQuery(name),
	mimeType: (mimeType: StringSearch) =>
		"mimeType" + stringSearchToQuery(mimeType),
	parent: (parent: string) => `'${parent}' in parents`,
	starred: (starred: boolean) => `starred=${starred}`,
	query: (query: string) => `fullText contains '${query}'`,
	properties: (properties: Record<string, string>) =>
		Object.entries(properties).map(
			([key, value]) =>
				`properties has { key='${key}' and value='${value}' }`
		),
	modifiedTime: (modifiedTime: DateComparison) => {
		if ("eq" in modifiedTime) return `modifiedTime='${modifiedTime.eq}'`;
		if ("gt" in modifiedTime) return `modifiedTime>'${modifiedTime.gt}'`;
		if ("lt" in modifiedTime) return `modifiedTime<'${modifiedTime.lt}'`;
	},
};

export const fileListToMap = (files: { id: string; name: string }[]) =>
	Object.fromEntries(files.map(({ id, name }) => [name, id]));

export const buildFolderIdToInfo = (
	files: FileMetadata[]
): Map<string, FolderInfo> => {
	const map = new Map<string, FolderInfo>();
	for (const file of files) {
		if (file.mimeType === folderMimeType && file.parents) {
			map.set(file.id, {
				name: file.name,
				parents: file.parents,
			});
		}
	}
	return map;
};

export const resolvePathFromParents = (
	file: FileMetadata,
	rootFolderId: string,
	folderIdToInfo: Map<string, FolderInfo>
): string | null => {
	if (file.properties?.path) {
		console.log(`[PULL DIAGNOSTIC] Path found in properties: ${file.properties.path}`);	
		return file.properties.path;
	}

	if (!file.parents || file.parents.length === 0) {
		console.log(`[PULL DIAGNOSTIC] No parents for ${file.name}`);
		return null;
	}

	const pathSegments: string[] = [];
	const visited = new Set<string>();
	let currentId: string | undefined = file.parents[0];
	let hops = 0;
	const maxHops = 50;

	pathSegments.unshift(file.name);

	console.log(`[PULL DIAGNOSTIC] Initial path segments: ${pathSegments.join("/")}, currentId: ${currentId}`);

	while (currentId && hops < maxHops) {
		console.log(`[PULL DIAGNOSTIC] Path segments: ${pathSegments.join("/")}, currentId: ${currentId}`);
		if (currentId === rootFolderId) {
			return pathSegments.join("/");
		}

		if (visited.has(currentId)) {
			console.warn(
				`[OGD] Circular parent reference detected for file "${file.name}" (ID: ${file.id})`
			);
			return null;
		}
		visited.add(currentId);

		const folderInfo = folderIdToInfo.get(currentId);
		if (!folderInfo) {
			console.log(`[PULL DIAGNOSTIC] No folderInfo for ${currentId}`);
			return null;
		}

		pathSegments.unshift(folderInfo.name);

		if (!folderInfo.parents || folderInfo.parents.length === 0) {
			console.log(`[PULL DIAGNOSTIC] No parents for ${currentId} (${folderInfo.name})`);
			break;
		}
		currentId = folderInfo.parents[0];
		hops++;
	}

	if (hops >= maxHops) {
		console.warn(
			`[OGD] Orphaned file detected: "${file.name}" (ID: ${file.id}) - parent chain exceeded ${maxHops} hops`
		);
		return null;
	}

	return pathSegments.join("/");
};

export const searchFilesRecursive = async (
	folderId: string,
	folderIdToInfo: Map<string, FolderInfo>,
	drive: ReturnType<typeof getDriveKy>,
	filesAccumulator: FileMetadata[] = [],
	depth = 0
): Promise<FileMetadata[]> => {
	const children = await drive.get(
		`drive/v3/files?fields=nextPageToken,files(id,name,mimeType,parents,properties,modifiedTime,ownedByMe,shortcutDetails)&pageSize=1000&q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&orderBy=name desc&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=user`
	).json<any>();

	const indent = "  ".repeat(depth);
	if (!children) {
		console.log(`[Drive API] ${indent}Searched folder ${folderId}, found 0 items`);
		return filesAccumulator;
	}
	console.log(`[Drive API] ${indent}Searched folder ${folderId}, found ${children.files?.length || 0} items`);

	let allChildren = children.files as FileMetadata[];
	let nextPageToken = children.nextPageToken;

	while (nextPageToken) {
		const nextPage = await drive.get(
			`drive/v3/files?fields=nextPageToken,files(id,name,mimeType,parents,properties,modifiedTime,ownedByMe,shortcutDetails)&pageSize=1000&q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&orderBy=name desc&pageToken=${nextPageToken}&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=user`
		).json<any>();
		if (!nextPage) break;
		allChildren.push(...nextPage.files);
		nextPageToken = nextPage.nextPageToken;
	}

	for (const f of allChildren) {
		if (f.mimeType === "application/vnd.google-apps.shortcut") {
			console.log(`[Drive API] ${indent}  ⚠️ "${f.name}" (ID: ${f.id}) is a shortcut${f.ownedByMe !== undefined ? `, ownedByMe=${f.ownedByMe}` : ''}${f.shortcutDetails ? `, target=${f.shortcutDetails.targetId} (type: ${f.shortcutDetails.targetMimeType})` : ''}`);
		} else if (f.ownedByMe === false) {
			console.log(`[Drive API] ${indent}  ⚠️ "${f.name}" (ID: ${f.id}) is NOT owned by you (shared file)`);
		}
	}

	filesAccumulator.push(...allChildren);

	const newFolders = buildFolderIdToInfo(allChildren);
	for (const [id, info] of newFolders) {
		folderIdToInfo.set(id, info);
	}
	
	for (const f of allChildren) {
		if (f.mimeType === "application/vnd.google-apps.shortcut" && f.shortcutDetails?.targetMimeType === folderMimeType && f.parents) {
			folderIdToInfo.set(f.id, {
				name: f.name,
				parents: f.parents,
			});
		}
	}
	if (!folderIdToInfo.has(folderId)) {
		const currentFolder = allChildren.find(f => f.id === folderId);
		if (currentFolder && currentFolder.mimeType === folderMimeType && currentFolder.parents) {
			folderIdToInfo.set(folderId, {
				name: currentFolder.name,
				parents: currentFolder.parents,
			});
		}
	}

	const subfolders = allChildren.filter(
		(f) => f.mimeType === folderMimeType || (f.mimeType === "application/vnd.google-apps.shortcut" && f.shortcutDetails?.targetMimeType === folderMimeType)
	);

	for (const subfolder of subfolders) {
		const targetId = subfolder.mimeType === "application/vnd.google-apps.shortcut" ? subfolder.shortcutDetails!.targetId : subfolder.id;
		await searchFilesRecursive(targetId, folderIdToInfo, drive, filesAccumulator, depth + 1);
	}

	return filesAccumulator;
};

export const getDriveClient = (t: ObsidianGoogleDrive) => {
	const drive = getDriveKy(t);

	const getQuery = (matches: QueryMatch[], includeVaultProperty = false) =>
		encodeURIComponent(
			`(${matches
				.map((match) => {
					const entries = Object.entries(match).flatMap(
						([key, value]) =>
							value === undefined
								? []
								: Array.isArray(value)
								? value.map((v) => [key, v])
								: [[key, value]]
					);
					return `(${entries
						.map(([key, value]) =>
							queryHandlers[key as keyof QueryMatch](
								value as never
							)
						)
						.join(" and ")})`;
				})
				.join(
					" or "
				)}) and trashed=false${
				includeVaultProperty
					? ` and properties has { key='vault' and value='${t.app.vault.getName()}' }`
					: ""
			}`
		);

	const paginateFiles = async ({
		matches,
		pageToken,
		order = "descending",
		pageSize = 30,
		include = [
			"id",
			"name",
			"mimeType",
			"starred",
			"description",
			"properties",
		],
		includeVaultProperty = false,
	}: {
		matches?: QueryMatch[];
		order?: "ascending" | "descending";
		pageToken?: string;
		pageSize?: number;
		include?: (keyof FileMetadata)[];
		includeVaultProperty?: boolean;
	}) => {
		const files = await drive
			.get(
				`drive/v3/files?fields=nextPageToken,files(${include.join(
					","
				)})&pageSize=${pageSize}&q=${
					matches ? getQuery(matches, includeVaultProperty) : "trashed=false"
				}${
					matches?.find(({ query }) => query)
						? ""
						: "&orderBy=name" +
						  (order === "ascending" ? "" : " desc")
				}${pageToken ? "&pageToken=" + pageToken : ""}&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=user`
			)
			.json<any>();
		if (!files) return;
		return files as {
			nextPageToken?: string;
			files: FileMetadata[];
		};
	};

	const searchFiles = async (
		data: {
			matches?: QueryMatch[];
			order?: "ascending" | "descending";
			include?: (keyof FileMetadata)[];
			includeVaultProperty?: boolean;
		},
		includeObsidian = false
	) => {
		const includeVP = data.includeVaultProperty ?? true;
		const files = await paginateFiles({ ...data, pageSize: 1000, includeVaultProperty: includeVP });
		if (!files) return;

		while (files.nextPageToken) {
			const nextPage = await paginateFiles({
				...data,
				pageToken: files.nextPageToken,
				pageSize: 1000,
			});
			if (!nextPage) return;
			files.files.push(...nextPage.files);
			files.nextPageToken = nextPage.nextPageToken;
		}

		if (includeObsidian) return files.files as FileMetadata[];

		return files.files.filter(
			({ properties }) => properties?.obsidian !== "vault"
		) as FileMetadata[];
	};

	const getRootFolderId = async () => {
		const files = await searchFiles(
			{
				matches: [{ properties: { obsidian: "vault" } }],
			},
			true
		);
		if (!files) return;
		if (!files.length) {
			const rootFolder = await drive
				.post(`drive/v3/files`, {
					json: {
						name: t.app.vault.getName(),
						mimeType: folderMimeType,
						description: "Obsidian Vault: " + t.app.vault.getName(),
						properties: {
							obsidian: "vault",
							vault: t.app.vault.getName(),
						},
					},
				})
				.json<any>();
			if (!rootFolder) return;
			return rootFolder.id as string;
		} else {
			return files[0].id as string;
		}
	};

	const createFolder = async ({
		name,
		parent,
		description,
		properties,
		modifiedTime,
	}: {
		name: string;
		description?: string;
		parent?: string;
		properties?: Record<string, string>;
		modifiedTime?: string;
	}) => {
		if (!parent) {
			parent = await getRootFolderId();
			if (!parent) return;
		}

		if (!properties) properties = {};
		if (!properties.vault) properties.vault = t.app.vault.getName();

		const folder = await drive
			.post(`drive/v3/files`, {
				json: {
					name,
					mimeType: folderMimeType,
					description,
					parents: [parent],
					properties,
					modifiedTime,
				},
			})
			.json<any>();
		if (!folder) return;
		return folder.id as string;
	};

	const uploadFile = async (
		file: Blob,
		name: string,
		parent?: string,
		metadata?: Partial<Omit<FileMetadata, "id">>
	) => {
		if (!parent) {
			parent = await getRootFolderId();
			if (!parent) return;
		}

		if (!metadata) metadata = {};
		if (!metadata.properties) metadata.properties = {};
		if (!metadata.properties.vault) {
			metadata.properties.vault = t.app.vault.getName();
		}

		const form = new FormData();
		form.append(
			"metadata",
			new Blob(
				[
					JSON.stringify({
						name,
						mimeType: file.type,
						parents: [parent],
						...metadata,
					}),
				],
				{ type: "application/json" }
			)
		);
		form.append("file", file);

		const result = await drive
			.post(`upload/drive/v3/files?uploadType=multipart&fields=id`, {
				body: form,
			})
			.json<any>();
		if (!result) return;

		return result.id as string;
	};

	const updateFile = async (
		id: string,
		newContent: Blob,
		newMetadata: Partial<Omit<FileMetadata, "id">> = {}
	) => {
		const form = new FormData();
		form.append(
			"metadata",
			new Blob([JSON.stringify(newMetadata)], {
				type: "application/json",
			})
		);
		form.append("file", newContent);

		const result = await drive
			.patch(
				`upload/drive/v3/files/${id}?uploadType=multipart&fields=id`,
				{
					body: form,
				}
			)
			.json<any>();
		if (!result) return;

		return result.id as string;
	};

	const updateFileMetadata = async (
		id: string,
		metadata: Partial<Omit<FileMetadata, "id">>
	) => {
		const result = await drive
			.patch(`drive/v3/files/${id}`, {
				json: metadata,
			})
			.json<any>();
		if (!result) return;
		return result.id as string;
	};

	const deleteFile = async (id: string) => {
		const result = await drive.delete(`drive/v3/files/${id}`);
		if (!result.ok) return;
		return true;
	};

	const getFile = (id: string) =>
		drive.get(`drive/v3/files/${id}?alt=media&acknowledgeAbuse=true`);

	const getFileMetadata = (id: string) =>
		drive.get(`drive/v3/files/${id}`).json<FileMetadata>();

	const idFromPath = async (path: string) => {
		const idFromMapping = Object.entries(t.settings.driveIdToPath).find(
			([, p]) => p === path
		)?.[0];
		if (idFromMapping) return idFromMapping;

		const files = await searchFiles({
			matches: [{ properties: { path } }],
		});
		if (!files?.length) return;
		return files[0].id as string;
	};

	const idsFromPaths = async (paths: string[]) => {
		const idToPath = t.settings.driveIdToPath;
		const fromMapping = paths
			.map((path) => {
				const id = Object.entries(idToPath).find(([, p]) => p === path)?.[0];
				return id ? { id, path } : null;
			})
			.filter(Boolean) as { id: string; path: string }[];

		const unmappedPaths = paths.filter(
			(p) => !fromMapping.some((m) => m.path === p)
		);

		if (!unmappedPaths.length) return fromMapping;

		const fromSearch = await searchFiles({
			matches: unmappedPaths.map((path) => ({ properties: { path } })),
		});
		if (!fromSearch) return fromMapping.length ? fromMapping : undefined;

		const fromSearchMapped = fromSearch.map((file) => ({
			id: file.id,
			path: file.properties.path,
		}));

		return [...fromMapping, ...fromSearchMapped];
	};

	const batchDelete = async (ids: string[]) => {
		const body = new FormData();

		// Loop through file IDs to create each delete request
		ids.forEach((fileId, index) => {
			const deleteRequest = [
				`--batch_boundary`,
				"Content-Type: application/http",
				"",
				`DELETE /drive/v3/files/${fileId} HTTP/1.1`,
				"",
				"",
			].join("\r\n");

			body.append(`request_${index + 1}`, deleteRequest);
		});

		body.append("", "--batch_boundary--");

		const result = await drive
			.post(`batch/drive/v3`, {
				headers: {
					"Content-Type": "multipart/mixed; boundary=batch_boundary",
				},
				body,
			})
			.text();
		if (!result) return;
		return result;
	};

	const getChangesStartToken = async () => {
		const result = await drive
			.get(`drive/v3/changes/startPageToken`)
			.json<any>();
		if (!result) return;
		return result.startPageToken as string;
	};

	const getChanges = async (startToken: string) => {
		if (!startToken) return { changes: [], newStartPageToken: "" };

		const request = (token: string) =>
			drive
				.get(
					`drive/v3/changes?${new URLSearchParams({
						pageToken: token,
						pageSize: "1000",
						includeRemoved: "true",
					}).toString()}`
				)
				.json<any>();

		const result = await request(startToken);
		if (!result) return;

		let newStartPageToken = result.newStartPageToken;

		while (result.nextPageToken) {
			const nextPage = await request(result.nextPageToken);
			if (!nextPage) return;
			result.changes.push(...nextPage.changes);
			newStartPageToken = nextPage.newStartPageToken;
			result.nextPageToken = nextPage.nextPageToken;
		}

		return {
			changes: result.changes as {
				kind: string;
				removed: boolean;
				file: FileMetadata;
				fileId: string;
				time: string;
			}[],
			newStartPageToken,
		};
	};

	const deleteFilesMinimumOperations = async (files: TAbstractFile[]) => {
		const folders = files.filter(
			(file) => file instanceof TFolder
		) as TFolder[];

		if (folders.length) {
			const maxDepth = Math.max(
				...folders.map(({ path }) => path.split("/").length)
			);

			for (let depth = 1; depth <= maxDepth; depth++) {
				const foldersToDelete = files.filter(
					(file) =>
						file instanceof TFolder &&
						file.path.split("/").length === depth
				);
				await Promise.all(
					foldersToDelete.map((folder) => t.deleteFile(folder))
				);
				foldersToDelete.forEach(
					(folder) =>
						(files = files.filter(
							({ path }) =>
								!path.startsWith(folder.path + "/") &&
								path !== folder.path
						))
				);
			}
		}

		await Promise.all(files.map((file) => t.deleteFile(file)));
	};

	const getConfigFilesToSync = async () => {
		const configFilesToSync: string[] = [];
		const { vault } = t.app;
		const { adapter } = vault;

		const [configFiles, plugins] = await Promise.all([
			adapter.list(vault.configDir),
			adapter.list(vault.configDir + "/plugins"),
		]);

		await Promise.all(
			configFiles.files
				.filter(
					(path) =>
						!BLACKLISTED_CONFIG_FILES.includes(
							fileNameFromPath(path)
						)
				)
				.map(async (path) => {
					const file = await adapter.stat(path);
					if ((file?.mtime || 0) > t.settings.lastSyncedAt) {
						configFilesToSync.push(path);
					}
				})
				.concat(
					plugins.folders.map(async (plugin) => {
						const files = await adapter.list(plugin);
						await Promise.all(
							files.files
								.filter((path) =>
									WHITELISTED_PLUGIN_FILES.includes(
										fileNameFromPath(path)
									)
								)
								.map(async (path) => {
									const file = await adapter.stat(path);
									if (
										(file?.mtime || 0) >
										t.settings.lastSyncedAt
									) {
										configFilesToSync.push(path);
									}
								})
						);
					})
				)
		);

		return configFilesToSync;
	};

	return {
		paginateFiles,
		searchFiles,
		getRootFolderId,
		createFolder,
		uploadFile,
		updateFile,
		updateFileMetadata,
		deleteFile,
		getFile,
		getFileMetadata,
		idFromPath,
		idsFromPaths,
		getChangesStartToken,
		getChanges,
		batchDelete,
		checkConnection,
		deleteFilesMinimumOperations,
		getConfigFilesToSync,
		resolvePathFromParents,
		searchFilesRecursive,
	};
};

export const checkConnection = async () => {
	try {
		if (!navigator.onLine) return false;
		// Use a CORS-friendly endpoint that returns proper Access-Control-Allow-Origin headers
		await ky.get(
			"https://www.googleapis.com/discovery/v1/apis",
			{ timeout: 5000 }
		);
		return true;
	} catch {
		return false;
	}
};

export const batchAsyncs = async (
	requests: (() => Promise<any>)[],
	batchSize = 10
) => {
	const results = [];
	for (let i = 0; i < requests.length; i += batchSize) {
		const batch = requests.slice(i, i + batchSize);
		results.push(...(await Promise.all(batch.map((request) => request()))));
	}
	return results;
};

export const getSyncMessage = (
	min: number,
	max: number,
	completed: number,
	total: number
) => `Syncing (${Math.floor(min + (max - min) * (completed / total))}%)`;

export const fileNameFromPath = (path: string) => path.split("/").slice(-1)[0];

/**
 * @returns Batches in increasing order of depth
 */
export const foldersToBatches: {
	(folders: string[]): string[][];
	(folders: TFolder[]): TFolder[][];
} = (folders) => {
	if (folders.length === 0) return [];
	const maxDepth = Math.max(
		...folders.map(
			(folder) =>
				(folder instanceof TFolder ? folder.path : folder).split(
					"/"
				).length
		)
	);

	const batches: (typeof folders)[] = new Array(maxDepth)
		.fill(0)
		.map(() => []);

	folders.forEach((folder) => {
		batches[
			(folder instanceof TFolder ? folder.path : folder).split("/")
				.length - 1
		].push(folder as any);
	});

	return batches as any;
};
