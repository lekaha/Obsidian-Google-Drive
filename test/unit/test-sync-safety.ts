import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Minimal runtime stub for "obsidian" so we can import plugin modules in Node.js
import Module from "node:module";

class TAbstractFile {
	path: string;
	name: string;
	constructor(p: string) {
		this.path = p;
		this.name = p.split("/").pop() || "";
	}
}
class TFile extends TAbstractFile {}
class TFolder extends TAbstractFile {
	children: TAbstractFile[];
	constructor(p: string, children: TAbstractFile[] = []) {
		super(p);
		this.children = children;
	}
}
class Notice {
	constructor(public message: string) {}
	setMessage(m: string) {
		this.message = m;
	}
	hide() {}
}
class Modal {}

const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (request: string, ...args: any[]) {
	if (request === "obsidian") return "obsidian";
	return originalResolve.call(this, request, ...args);
};
require.cache["obsidian"] = {
	id: "obsidian",
	filename: "obsidian",
	loaded: true,
	exports: {
		TAbstractFile,
		TFile,
		TFolder,
		Notice,
		Modal,
		Platform: { isDesktopApp: false, isMobile: true },
	},
} as any;

async function main() {
	const {
		escapeDriveQueryValue,
		isPluginDataJson,
		areArrayBuffersEqual,
		buildConflictPath,
	} = await import("../../helpers/drive");
	const { hasPreservedDescendants } = await import("../../helpers/pull");
	const { findUntrackedLocalPaths } = await import("../../helpers/push");

	// 1. Drive query escaping
	assert.equal(escapeDriveQueryValue("John's Vault"), "John\\'s Vault");
	assert.equal(escapeDriveQueryValue("a\\b'c"), "a\\\\b\\'c");

	// 2. Plugin data.json exclusion
	assert.equal(
		isPluginDataJson(".obsidian/plugins/google-drive-sync/data.json", ".obsidian"),
		true
	);
	assert.equal(
		isPluginDataJson(".obsidian/plugins/other-plugin/data.json", ".obsidian"),
		false
	);
	assert.equal(
		isPluginDataJson(".obsidian/plugins/google-drive-sync/manifest.json", ".obsidian"),
		false
	);

	// 3. ArrayBuffer equality
	const enc = new TextEncoder();
	assert.equal(
		areArrayBuffersEqual(enc.encode("hello").buffer, enc.encode("hello").buffer),
		true
	);
	assert.equal(
		areArrayBuffersEqual(enc.encode("hello").buffer, enc.encode("world").buffer),
		false
	);
	assert.equal(
		areArrayBuffersEqual(enc.encode("hello").buffer, enc.encode("hello!").buffer),
		false
	);

	// 4. Conflict path generation
	const fixedDate = new Date("2026-11-23T01:38:05.000Z");
	assert.equal(
		buildConflictPath("folder/note.md", fixedDate),
		"folder/note (conflict 2026-11-23_01-38-05).md"
	);
	assert.equal(
		buildConflictPath("README", fixedDate),
		"README (conflict 2026-11-23_01-38-05)"
	);
	assert.equal(
		buildConflictPath("a/b/my.archive.tar.gz", fixedDate),
		"a/b/my.archive.tar (conflict 2026-11-23_01-38-05).gz"
	);

	// 5. Folder deletion safety (hasPreservedDescendants)
	const emptyFolder = new TFolder("empty", []);
	assert.equal(
		hasPreservedDescendants(emptyFolder as any, new Set(["empty"]), {}),
		false,
		"Empty folder should be safe to delete"
	);

	const deletedChild = new TFile("dir/old.md");
	const folderAllDeleted = new TFolder("dir", [deletedChild]);
	assert.equal(
		hasPreservedDescendants(
			folderAllDeleted as any,
			new Set(["dir", "dir/old.md"]),
			{}
		),
		false,
		"Folder with all children deleted should be safe to delete"
	);

	const unsyncedChild = new TFile("dir/new-local.md");
	const folderWithNewLocal = new TFolder("dir", [deletedChild, unsyncedChild]);
	assert.equal(
		hasPreservedDescendants(
			folderWithNewLocal as any,
			new Set(["dir", "dir/old.md"]),
			{ "dir/new-local.md": "create" }
		),
		true,
		"Folder containing an unsynced local file MUST be preserved"
	);

	const modifiedChild = new TFile("dir/edited.md");
	const folderWithModified = new TFolder("dir", [modifiedChild]);
	assert.equal(
		hasPreservedDescendants(
			folderWithModified as any,
			new Set(["dir", "dir/edited.md"]),
			{ "dir/edited.md": "modify" }
		),
		true,
		"Folder containing a locally modified file MUST be preserved"
	);

	const nestedUnsynced = new TFile("dir/sub/keep.md");
	const subFolder = new TFolder("dir/sub", [nestedUnsynced]);
	const parentFolder = new TFolder("dir", [subFolder]);
	assert.equal(
		hasPreservedDescendants(
			parentFolder as any,
			new Set(["dir", "dir/sub"]),
			{}
		),
		true,
		"Folder containing a nested non-deleted file MUST be preserved"
	);

	// 6. Untracked local file discovery
	const untracked = findUntrackedLocalPaths(
		[
			"/",
			"",
			".obsidian",
			".obsidian/app.json",
			"already-synced.md",
			"already-queued.md",
			"preexisting-folder",
			"preexisting-folder/note.md",
		],
		{ id1: "already-synced.md" },
		{ "already-queued.md": "modify" },
		".obsidian"
	);
	assert.deepEqual(untracked, [
		"preexisting-folder",
		"preexisting-folder/note.md",
	]);

	// 7. Android bundle safety check: no top-level require("http") or require("electron")
	const bundlePath = path.resolve(process.cwd(), "main.js");
	assert.ok(fs.existsSync(bundlePath), "main.js bundle must exist");
	const bundle = fs.readFileSync(bundlePath, "utf8");
	// Check that require("http") is NOT at top-level module scope (e.g. var import_http = require("http"))
	assert.equal(
		/\bimport_http\s*=\s*require\("http"\)/.test(bundle),
		false,
		"main.js must not have top-level require('http') that crashes Android"
	);

	console.log("All sync safety unit tests passed!");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
