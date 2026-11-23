import ObsidianGoogleDrive from "main";
import {
	batchAsyncs,
	folderMimeType,
	foldersToBatches,
	getSyncMessage,
} from "./drive";
import {
	Notice,
	TAbstractFile,
	TFile,
	TFolder,
	Modal,
	Setting,
} from "obsidian";
import { pull } from "./pull";

export class ConfirmResetModal extends Modal {
	proceed: (res: boolean) => void;
	constructor(t: ObsidianGoogleDrive, proceed: (res: boolean) => void) {
		super(t.app);
		this.proceed = proceed;

		this.setTitle(
			"Are you sure you want to reset the data from Google Drive?"
		);
		this.setContent(
			"You'll loose all the local changes to your data and load only the information on your google drive. This step is irreversible."
		);
		new Setting(this.contentEl)
			.addButton((btn) =>
				btn.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((btn) =>
				btn
					.setButtonText("RESET!")
					.setWarning()
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

export const reset = async (t: ObsidianGoogleDrive) => {
	if (t.syncing) return;

	const proceed = await new Promise<boolean>((resolve) => {
		new ConfirmResetModal(t, resolve).open();
	});
	if (!proceed) return;

	const syncNotice = await t.startSync();
	let failedCount = 0;

	try {
		await pull(t, true);

		const { vault } = t.app;

		const operations = Object.entries(t.settings.operations);
		const deletes = operations.filter(([_, op]) => op === "delete");
		const creates = operations.filter(([_, op]) => op === "create");
		const modifies = operations.filter(([_, op]) => op === "modify");

		const filePathToId = Object.fromEntries(
			Object.entries(t.settings.driveIdToPath).map(([id, path]) => [
				path,
				id,
			])
		);

		if (creates.length) {
			await t.drive.deleteFilesMinimumOperations(
				creates
					.map(([path]) => vault.getAbstractFileByPath(path))
					.filter(
						(file): file is TAbstractFile =>
							file instanceof TAbstractFile
					)
			);
			creates.forEach(([path]) => delete t.settings.operations[path]);
		}

		syncNotice.setMessage("Syncing (33%)");

		if (modifies.length) {
			let completed = 0;
			const files = modifies
				.map(([path]) => vault.getFileByPath(path))
				.filter((file): file is TFile => file instanceof TFile);
			await batchAsyncs(
				files.map((file) => async () => {
					const driveId = filePathToId[file.path];
					if (!driveId) {
						failedCount++;
						return;
					}
					try {
						const [onlineFile, metadata] = await Promise.all([
							t.drive.getFile(driveId).arrayBuffer(),
							t.drive.getFileMetadata(driveId),
						]);
						if (!onlineFile || !metadata) {
							failedCount++;
							new Notice(
								"An error occurred fetching Google Drive files."
							);
							return;
						}

						completed++;
						syncNotice.setMessage(
							getSyncMessage(33, 66, completed, files.length)
						);
						await t.modifyFile(
							file,
							onlineFile,
							metadata.modifiedTime
						);
						delete t.settings.operations[file.path];
					} catch (e) {
						console.error(
							`[OGD] Reset failed for modified file "${file.path}":`,
							e
						);
						failedCount++;
					}
				})
			);
		}

		if (deletes.length) {
			const files = await t.drive.searchFiles({
				include: ["id", "mimeType", "properties", "modifiedTime"],
				matches: deletes.map(([path]) => ({ properties: { path } })),
			});
			if (!files) {
				new Notice("An error occurred fetching Google Drive files.");
				return;
			}

			const pathToFile = Object.fromEntries(
				files
					.filter((file) => file.properties?.path)
					.map((file) => [file.properties.path, file])
			);

			const deletedFolders = deletes.filter(
				([path]) => pathToFile[path]?.mimeType === folderMimeType
			);

			if (deletedFolders.length) {
				const batches = foldersToBatches(
					deletedFolders.map(([path]) => path)
				);

				for (const batch of batches) {
					await Promise.all(
						batch.map(async (folder) => {
							await t.createFolder(folder);
							delete t.settings.operations[folder];
						})
					);
				}
			}

			let completed = 0;

			const deletedFiles = deletes.filter(
				([path]) =>
					pathToFile[path] &&
					pathToFile[path].mimeType !== folderMimeType
			);

			await batchAsyncs(
				deletedFiles.map(([path]) => async () => {
					const driveId = filePathToId[path] || pathToFile[path]?.id;
					if (!driveId) {
						failedCount++;
						return;
					}
					try {
						const onlineFile = await t.drive
							.getFile(driveId)
							.arrayBuffer();
						if (!onlineFile) {
							failedCount++;
							new Notice(
								"An error occurred fetching Google Drive files."
							);
							return;
						}
						completed++;
						syncNotice.setMessage(
							getSyncMessage(
								66,
								99,
								completed,
								deletedFiles.length
							)
						);
						await t.createFile(
							path,
							onlineFile,
							pathToFile[path].modifiedTime
						);
						delete t.settings.operations[path];
					} catch (e) {
						console.error(
							`[OGD] Reset failed for deleted file "${path}":`,
							e
						);
						failedCount++;
					}
				})
			);
		}

		if (failedCount > 0) {
			new Notice(
				`Reset finished with ${failedCount} error(s). Please try again.`
			);
		} else {
			t.settings.operations = {};
			new Notice("Reset complete.");
		}
	} finally {
		await t.endSync(syncNotice);
	}
};
