import * as fs from "fs";
import ky from "ky";
import { pull } from "../../helpers/pull";
import { getDriveClient } from "../../helpers/drive";

const mockApp = {
	vault: {
		getName: () => "lekaha",
		adapter: {
			exists: async (p: string) => fs.existsSync(p),
			stat: async (p: string) => {
				if (!fs.existsSync(p)) return null;
				const s = fs.statSync(p);
				return { type: s.isDirectory() ? "folder" : "file", mtime: s.mtimeMs };
			},
			list: async (p: string) => ({ files: [], folders: [] }),
			writeBinary: async (p: string, d: any) => console.log(`[Mock] Write binary to ${p}`),
			readBinary: async (p: string) => new ArrayBuffer(0),
		},
		getAbstractFileByPath: (p: string) => null,
		getFileByPath: (p: string) => null,
		getFolderByPath: (p: string) => null,
		getAbstractFileByPathOrNull: (p: string) => null,
		createBinary: async (p: string, d: any) => console.log(`[Mock] Create binary ${p}`),
		modifyBinary: async (f: any, d: any) => console.log(`[Mock] Modify binary`),
	},
	fileManager: {
		trashFile: async (f: any) => console.log(`[Mock] Trash file`),
	},
	workspace: {
		on: () => {},
	}
};

class MockPlugin {
	app = mockApp as any;
	settings: any;
	accessToken = { token: "", expiresAt: 0 };
	syncing = false;
	ribbonIcon = { addClass: () => {}, removeClass: () => {} };
	drive: any;

	constructor(settings: any) {
		this.settings = settings;
		this.drive = getDriveClient(this as any);
	}

	async saveSettings() {
		console.log("[Mock] Settings saved");
	}
	async loadData() {
		return this.settings;
	}
	async startSync() {
		console.log("[Mock] Sync started");
		return { setMessage: (m: string) => console.log(`[Notice] ${m}`), hide: () => {} };
	}
	async endSync(n: any) {
		console.log("[Mock] Sync ended");
		n?.hide();
	}
	async createFolder(p: string) {
		console.log(`[Mock] Create folder ${p}`);
	}
	async upsertFile(p: string, c: any, m: any) {
		console.log(`[Mock] Upsert file ${p}`);
	}
	async modifyFile(f: any, c: any, m: any) {
		console.log(`[Mock] Modify file`);
	}
	async deleteFile(f: any) {
		console.log(`[Mock] Delete file`);
	}
}

async function refreshAccessTokenViaLegacy(refreshToken: string): Promise<string> {
	const response = await ky
		.post("https://ogd.richardxiong.com/api/access", {
			json: { refresh_token: refreshToken },
		})
		.json<any>();
	
	return response.access_token;
}

async function refreshAccessTokenViaPkce(
	refreshToken: string,
	clientId: string,
	clientSecret?: string
): Promise<string> {
	const params = new URLSearchParams({
		refresh_token: refreshToken,
		client_id: clientId,
		grant_type: "refresh_token",
		...(clientSecret && { client_secret: clientSecret }),
	});

	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: params.toString(),
	});

	if (!response.ok) {
		throw new Error(await response.text());
	}

	const data = await response.json() as any;
	return data.access_token;
}

async function main() {
	const args = process.argv.slice(2);
	let dataFile = "./data.json";
	let tokenFile = ".test-oauth-token";

	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--data" && args[i + 1]) dataFile = args[i + 1];
		if (args[i] === "--token" && args[i + 1]) tokenFile = args[i + 1];
	}

	if (!fs.existsSync(dataFile)) {
		console.error(`Data file ${dataFile} not found. Create it or pass --data.`);
		process.exit(1);
	}

	const settings = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
	
	if (fs.existsSync(tokenFile)) {
		const tokenContent = fs.readFileSync(tokenFile, "utf-8").trim();
		if (tokenContent) {
			try {
				const tokenJson = JSON.parse(tokenContent);
				if (tokenJson.refreshToken) {
					settings.refreshToken = tokenJson.refreshToken;
				}
				if (tokenJson.clientId) {
					settings.clientId = tokenJson.clientId;
				}
				if (tokenJson.clientSecret) {
					settings.clientSecret = tokenJson.clientSecret;
				}
				console.log(`Using credentials from ${tokenFile}`);
			} catch {
				// Legacy format - just the refresh token string
				settings.refreshToken = tokenContent;
				console.log(`Using refresh token from ${tokenFile} (legacy format)`);
			}
		}
	}

	let accessToken: string | undefined;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "--access-token" && args[i + 1]) accessToken = args[i + 1];
	}

	if (!accessToken && settings.refreshToken) {
		try {
			console.log("Attempting to refresh access token automatically...");
			
			if (settings.clientId) {
				console.log("  → Using PKCE flow (clientId found in settings)");
				accessToken = await refreshAccessTokenViaPkce(
					settings.refreshToken,
					settings.clientId,
					settings.clientSecret
				);
			} else {
				console.log("  → Using legacy flow (ogd.richardxiong.com)");
				accessToken = await refreshAccessTokenViaLegacy(settings.refreshToken);
			}
			
			console.log("✓ Access token refreshed successfully\n");
		} catch (e: any) {
			console.error(`✗ Failed to refresh token: ${e.message}\n`);
		}
	}

	if (!accessToken) {
		console.error("ERROR: No access token available.\n");
		console.log("To provide a token, use one of these options:");
		console.log("  1. Pass --access-token flag:");
		console.log("     ./node_modules/.bin/tsx test-pull.ts --access-token YOUR_ACCESS_TOKEN\n");
		console.log("  2. Set up PKCE flow credentials in data.json:");
		console.log('     Add "clientId" and optionally "clientSecret" to your data.json\n');
		console.log("  3. Ensure your refresh token is valid:");
		console.log("     The .test-oauth-token file contains your refresh token");
		process.exit(1);
	}

	const plugin = new MockPlugin(settings);
	plugin.accessToken = {
		token: accessToken,
		expiresAt: Date.now() + 3600 * 1000
	};

	console.log("Starting REAL pull logic...");
	// @ts-ignore
	await pull(plugin);
	console.log("Pull test complete.");
}

main().catch(console.error);
