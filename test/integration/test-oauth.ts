import { generateCodeVerifier, generateCodeChallenge } from "../../helpers/pkce";
import { createServer, IncomingMessage, ServerResponse } from "http";
import { exec } from "child_process";
import { writeFileSync } from "fs";

const OAUTH_PORT = 18412;
const REDIRECT_URI = `http://127.0.0.1:${OAUTH_PORT}`;

async function openUrl(url: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const platform = process.platform;
		const command =
			platform === "darwin"
				? `open "${url}"`
				: platform === "win32"
					? `start "" "${url}"`
					: `xdg-open "${url}"`;
		exec(command, (error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

async function exchangeCodeForTokens(
	code: string,
	clientId: string,
	codeVerifier: string,
	clientSecret?: string
) {
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: clientId,
			redirect_uri: REDIRECT_URI,
			code_verifier: codeVerifier,
			grant_type: "authorization_code",
			...(clientSecret && { client_secret: clientSecret }),
		}),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(`Token exchange failed (${response.status}): ${errorBody}`);
	}

	return response.json() as Promise<{
		access_token: string;
		refresh_token: string;
		expires_in: number;
	}>;
}

async function verifyToken(accessToken: string) {
	const response = await fetch(
		"https://www.googleapis.com/drive/v3/about?fields=user",
		{ headers: { Authorization: `Bearer ${accessToken}` } }
	);

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(
			`Token verification failed (${response.status}): ${errorBody}`
		);
	}

	return response.json() as Promise<{ user: { emailAddress?: string; displayName?: string } }>;
}

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
					`<h1>Authentication Successful!</h1><p>You may close this window and return to the terminal.</p>`
				);

				if (!code) {
					reject(new Error("No authorization code found in redirect URL."));
					return;
				}

				resolve({ code, state, error });
			}
		});

		server.listen(OAUTH_PORT, "127.0.0.1", () => {
			console.log(`Loopback server listening on ${REDIRECT_URI}`);
		});

		server.on("error", (err) => {
			reject(new Error(`Failed to start loopback server: ${err.message}`));
		});
	});
}

async function main() {
	const args = process.argv.slice(2);

	const clientIdArg = args.find((a) => a.startsWith("--client-id="))?.split("=")[1];
	if (!clientIdArg) {
		console.error("Error: Client ID is required. Pass --client-id=YOUR_ID");
		process.exit(1);
	}
	const clientId = clientIdArg;

	const clientSecretArg = args.find((a) => a.startsWith("--client-secret="))?.split("=")[1];
	const clientSecret = clientSecretArg || "";

	console.log("\nGenerating PKCE parameters...");
	const codeVerifier = generateCodeVerifier();
	const codeChallenge = await generateCodeChallenge(codeVerifier);
	const state = generateCodeVerifier();

	const params = new URLSearchParams({
		client_id: clientId,
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

	console.log("\nStarting loopback server and opening browser...");

	const callbackPromise = waitForCallback();
	await openUrl(authUrl);

	console.log("Waiting for authentication callback...");

	const result = await callbackPromise;

	if (result.state && result.state !== state) {
		console.error("\n✗ Error: State mismatch - possible CSRF attack.");
		process.exit(1);
	}

	console.log("\nExchanging authorization code for tokens...");
	const tokens = await exchangeCodeForTokens(result.code, clientId, codeVerifier, clientSecret);

	console.log("\nToken exchange successful!");
	console.log(`  Access token: ${tokens.access_token.slice(0, 20)}...`);
	console.log(`  Refresh token: ${tokens.refresh_token ? tokens.refresh_token.slice(0, 20) + "..." : "N/A"}`);
	console.log(`  Expires in: ${tokens.expires_in} seconds`);

	console.log("\nVerifying access token...");
	const user = await verifyToken(tokens.access_token);
	console.log(`  User: ${user.user.displayName || "Unknown"} (${user.user.emailAddress || "Unknown"})`);

	console.log("\n✓ OAuth flow successful!");

	if (tokens.refresh_token) {
		const tokenFile = ".test-oauth-token";
		const tokenData = {
			refreshToken: tokens.refresh_token,
			clientId,
			...(clientSecret && { clientSecret }),
		};
		writeFileSync(tokenFile, JSON.stringify(tokenData, null, 2), "utf8");
		console.log(`Refresh token and credentials saved to ${tokenFile}`);
	}
}

main().catch((err) => {
	console.error(`\n✗ ${err.message || err}`);
	process.exit(1);
});
