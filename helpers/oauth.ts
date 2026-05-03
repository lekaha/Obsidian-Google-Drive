import type ObsidianGoogleDrive from "main";
import { Notice } from "obsidian";
import { generateCodeVerifier, generateCodeChallenge } from "./pkce";
import { createServer, type IncomingMessage, type ServerResponse } from "http";

export type PkceState = {
	codeVerifier: string;
	state: string;
};

const OAUTH_PORT = 18412;
const REDIRECT_URI = `http://127.0.0.1:${OAUTH_PORT}`;

function waitForCallback(): Promise<{ code: string; state: string; error?: string }> {
	return new Promise((resolve, reject) => {
		const server = createServer((req: IncomingMessage, res: ServerResponse) => {
			if (req.url) {
				const parsedUrl = new URL(req.url, REDIRECT_URI);
				const code = parsedUrl.searchParams.get("code") || "";
				const state = parsedUrl.searchParams.get("state") || "";
				const error = parsedUrl.searchParams.get("error") || undefined;

				server.close();

				if (error) {
					res.writeHead(400, { "Content-Type": "text/html" });
					res.end(`<h1>OAuth Error</h1><p>${error}</p><p>You may close this window.</p>`);
					reject(new Error(`OAuth error: ${error}`));
					return;
				}

				res.writeHead(200, { "Content-Type": "text/html" });
				res.end(
					`<h1>Authentication Successful!</h1><p>You may close this window.</p>`
				);

				if (!code) {
					reject(new Error("No authorization code found in redirect URL."));
					return;
				}

				resolve({ code, state, error });
			}
		});

		server.listen(OAUTH_PORT, "127.0.0.1", () => {
			console.log(`[OAuth] Loopback server listening on ${REDIRECT_URI}`);
		});

		server.on("error", (err) => {
			reject(new Error(`Failed to start loopback server: ${err.message}`));
		});
	});
}

async function exchangeTokenRequest(url: string, json: Record<string, unknown>) {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(json)) {
		if (value !== undefined && value !== null) {
			search.append(key, String(value));
		}
	}
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: search,
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(text);
	}

	return response.json();
}

async function doExchangeCodeForTokens(
	code: string,
	plugin: ObsidianGoogleDrive
): Promise<void> {
	const pkceState = plugin.pkceState;

	const response: any = await exchangeTokenRequest("https://oauth2.googleapis.com/token", {
		code,
		client_id: plugin.settings.clientId,
		redirect_uri: REDIRECT_URI,
		code_verifier: pkceState?.codeVerifier || "",
		grant_type: "authorization_code",
		...(plugin.settings.clientSecret && { client_secret: plugin.settings.clientSecret }),
	});

	plugin.settings.refreshToken = response.refresh_token || "";
	plugin.accessToken = {
		token: response.access_token,
		expiresAt: Date.now() + response.expires_in * 1000,
	};

	plugin.pkceState = undefined;
	await plugin.saveSettings();

	new Notice("Authentication successful! Reload Obsidian to activate sync.", 0);
}

export async function startAuthFlow(plugin: ObsidianGoogleDrive): Promise<void> {
	const { shell } = require("electron") as typeof import("electron");

	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = generateCodeVerifier();

	plugin.pkceState = { codeVerifier, state };

	const params = new URLSearchParams({
		client_id: plugin.settings.clientId,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		scope: "https://www.googleapis.com/auth/drive",
		state,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
		access_type: "offline",
		prompt: "consent",
	});

	const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

	try {
		const callbackPromise = waitForCallback();
		await shell.openExternal(authUrl);

		const result = await callbackPromise;

		if (result.state && result.state !== state) {
			new Notice("OAuth state mismatch - possible CSRF attack.");
			plugin.pkceState = undefined;
			return;
		}

		await doExchangeCodeForTokens(result.code, plugin);
	} catch (e: any) {
		plugin.pkceState = undefined;

		if (e.message?.includes("Failed to start loopback server")) {
			new Notice(
				`Could not start authentication server on port ${OAUTH_PORT}. Another process may be using this port.`,
				0
			);
		} else {
			new Notice(`Authentication error: ${e.message || e}`);
		}
	}
}

export async function refreshAccessTokenDirect(
	plugin: ObsidianGoogleDrive
): Promise<{ token: string; expiresAt: number } | undefined> {
	try {
		const response: any = await exchangeTokenRequest("https://oauth2.googleapis.com/token", {
			refresh_token: plugin.settings.refreshToken,
			client_id: plugin.settings.clientId,
			grant_type: "refresh_token",
			...(plugin.settings.clientSecret && { client_secret: plugin.settings.clientSecret }),
		});

		plugin.accessToken = {
			token: response.access_token,
			expiresAt: Date.now() + response.expires_in * 1000,
		};

		return plugin.accessToken;
	} catch (e: any) {
		const errorText = e.message || String(e);
		if (errorText.includes("invalid_grant")) {
			plugin.settings.refreshToken = "";
			await plugin.saveSettings();
			new Notice(
				"Your refresh token is invalid. Please re-authenticate in settings.",
				0
			);
		}

		plugin.accessToken = {
			token: "",
			expiresAt: 0,
		};

		return undefined;
	}
}
