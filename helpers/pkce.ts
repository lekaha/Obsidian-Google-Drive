/**
 * PKCE (Proof Key for Code Exchange) utility functions.
 *
 * These helpers work in both Obsidian's Electron environment (browser-like)
 * and Node.js (via the global crypto / webcrypto polyfill).
 */

// ---------------------------------------------------------------------------
// 2.3 - Base64url encoding helper
// ---------------------------------------------------------------------------

/**
 * Encodes an `ArrayBuffer` as a base64url string (RFC 7636).
 * Replaces `+` → `-`, `/` → `_`, and strips `=` padding.
 */
export function base64urlEncode(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let i = 0; i < bytes.byteLength; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// 2.1 - Generate code verifier
// ---------------------------------------------------------------------------

/**
 * Generates a random `code_verifier` per RFC 7636:
 * 128 bytes of randomness → base64url encoded (≈171 chars, within the
 * required 43-128 character range).
 *
 * Works in both browser and Node environments.
 */
export function generateCodeVerifier(): string {
	const array = new Uint8Array(128);

	// Browser / Electron
	if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
		crypto.getRandomValues(array);
	} else {
		// Node.js fallback (Obsidian desktop always has crypto, but keep for safety)
		const nodeCrypto = require("crypto") as typeof import("crypto");
		const buf = nodeCrypto.randomBytes(128);
		array.set(new Uint8Array(buf));
	}

	return base64urlEncode(array.buffer);
}

// ---------------------------------------------------------------------------
// 2.2 - Generate code challenge
// ---------------------------------------------------------------------------

/**
 * Computes the `code_challenge` from a `code_verifier` using SHA-256
 * and base64url encoding (no padding).
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(verifier);

	// Use crypto.subtle (available in Obsidian Electron and modern browsers)
	const digest = await crypto.subtle.digest("SHA-256", data);
	return base64urlEncode(digest);
}
