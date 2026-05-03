## 1. Standalone Test Script (`test-oauth.ts`)

- [x] 1.1 Create `src/test-oauth.ts` CLI script that:
  - Accepts `--client-id` and optional `--client-secret` arguments
  - Generates a PKCE `code_verifier` and `code_challenge`
  - Constructs the Google authorization URL with all required parameters
  - Opens the URL in the user's default browser using the `open` command (macOS), `xdg-open` (Linux), or `start` (Windows)
  - Prompts the user to paste the full redirect URL from the browser address bar (e.g., `obsidian://google-drive-sync?code=...`)
  - Parses the URL to extract the authorization `code` and `state` parameters
- [x] 1.2 Implement `exchangeCodeForTokens(code, clientId, codeVerifier)` that:
  - POSTs to `https://oauth2.googleapis.com/token` with authorization code, client ID, redirect URI, code verifier, and grant type
  - Returns `{ access_token, refresh_token, expires_in }`
  - Shows error messages if the request fails
- [x] 1.3 Implement token verification that:
  - Uses the access token to call `GET https://www.googleapis.com/drive/v3/about?fields=user` to verify it's valid
  - Displays the authenticated user's email and name
  - Prints "✓ OAuth flow successful!" on completion
- [x] 1.4 Add error handling for:
  - Missing or invalid authorization code
  - Token exchange errors (invalid client, expired code, network errors)
  - API request failures
- [x] 1.5 Store the refresh token to `.test-oauth-token` file for inspection (add to `.gitignore`)
- [x] 1.6 Update `package.json` to support running the script via `npx ts-node src/test-oauth.ts`

## 3. Add PKCE Utility Functions

- [x] 2.1 Create `helpers/pkce.ts` with `generateCodeVerifier(): string` using `crypto.getRandomValues(128 bytes)` and base64url encoding
- [x] 2.2 Add `async generateCodeChallenge(verifier: string): Promise<string>` using `crypto.subtle.digest('SHA-256', ...)` and base64url encoding (no padding)
- [x] 2.3 Add base64url encoding helper: `base64urlEncode(buffer: ArrayBuffer): string` that replaces `+` → `-`, `/` → `_`, and strips `=` padding

## 4. Update PluginSettings Interface

- [x] 3.1 Add `clientId: string` to `PluginSettings` interface in `main.ts` (default: "")
- [x] 3.2 Add `clientSecret: string` to `PluginSettings` interface in `main.ts` (default: "")
- [x] 3.3 Update `DEFAULT_SETTINGS` to include the new fields with empty string defaults

## 5. Implement Direct OAuth2 PKCE Flow

- [x] 4.1 Create `helpers/oauth.ts` with the new OAuth2 PKCE authentication logic
- [x] 4.2 Implement `startAuthFlow(plugin: ObsidianGoogleDrivePlugin): Promise<void>` that:
  - Generates `code_verifier` and `code_challenge`
  - Stores them temporarily on the plugin instance (in-memory)
  - Constructs the Google authorization URL with all required parameters
  - Opens the URL via `electron.shell.openExternal()` (accessed through Obsidian's `require('electron')`)
- [x] 4.3 Implement `handleOAuthRedirect(url: string, plugin: ObsidianGoogleDrivePlugin): Promise<void>` that:
  - Parses the redirect URL to extract `code` or `error` query parameters
  - On error: displays error notice and clears PKCE state
  - On success: calls `exchangeCodeForTokens(code, plugin)`
- [x] 4.4 Implement `exchangeCodeForTokens(code: string, plugin: ObsidianGoogleDrivePlugin): Promise<void>` that:
  - POSTs to `https://oauth2.googleapis.com/token` with `code`, `client_id`, `redirect_uri` (`obsidian://google-drive-sync`), `code_verifier`, `grant_type=authorization_code`
  - On success: stores `refresh_token` in `settings.refreshToken`, stores `access_token` in-memory with `expiresAt`, clears PKCE state, saves settings
  - On failure: shows error notice, clears PKCE state
- [x] 4.5 Implement `refreshAccessTokenDirect(plugin: ObsidianGoogleDrivePlugin): Promise<void>` that:
  - POSTs to `https://oauth2.googleapis.com/token` with `refresh_token`, `client_id`, `grant_type=refresh_token`
  - On success: updates in-memory access token with new `token` and `expiresAt`
  - On `invalid_grant` error: clears `settings.refreshToken`, prompts user to re-authenticate

## 6. Update ky.ts HTTP Client

- [x] 5.1 Modify `refreshAccessToken()` in `ky.ts` to check whether the current auth method is PKCE (has `settings.clientId`) or legacy (no `clientId`)
- [x] 5.2 For PKCE auth: call `refreshAccessTokenDirect()` from `helpers/oauth.ts` instead of the external server
- [x] 5.3 For legacy auth: keep the existing call to `https://ogd.richardxiong.com/api/access` for backward compatibility
- [x] 5.4 Update `checkConnection()` to use a reliable endpoint (e.g., `https://www.google.com` or keep existing ping)

## 7. Register Custom Protocol Handler

- [x] 6.1 In `main.ts` `onload()`, call `this.registerObsidianURLHandler()` with a callback that handles URLs starting with `google-drive-sync`
- [x] 6.2 The handler routes to `handleOAuthRedirect()` from `helpers/oauth.ts`
- [ ] 6.3 Verify that the handler works: when Obsidian receives `obsidian://google-drive-sync?code=...`, the callback fires and processes the code
- [x] 6.4 In `main.ts` `onunload()`, ensure the handler is properly cleaned up (Obsidian handles this via `registerObsidianURLHandler` lifecycle)

## 8. Update Settings UI

- [x] 7.1 Replace the current "Refresh Token" text input in `SettingsTab.display()` with:
  - "Google Client ID" text input (required) - saves to `settings.clientId`
  - "Google Client Secret" text input (optional) - saves to `settings.clientSecret`
  - "Authenticate with Google" button that triggers `startAuthFlow()`
  - Status indicator text showing authentication state
- [x] 7.2 Add setup instructions link/text explaining how to create a Google Cloud project, enable Drive API, configure OAuth consent screen, and create credentials
- [x] 7.3 Keep the old "Refresh Token" field visible but with a deprecation notice for backward compatibility (users who already have a refresh token can continue using it until they migrate)
- [x] 7.4 Add validation: clicking "Authenticate" without a Client ID shows an error
- [x] 7.5 On successful auth via PKCE flow, show "Reload Obsidian" notice (same as current behavior after token setup)

## 9. Update main.ts Plugin Initialization

- [x] 8.1 In `onload()`, check if the plugin has a valid refresh token (from either PKCE or legacy flow)
- [x] 8.2 If no token and no clientId configured, show the "unconfigured" warning notice (existing behavior)
- [x] 8.3 If clientId is configured but no refresh token, show a "Click Authenticate to sign in" notice instead of the current "get token from website" notice
- [x] 8.4 On successful initial auth (PKCE flow), fetch the initial Drive changes token via `getChangesStartToken()` and save settings (existing behavior)

## 10. Documentation Updates

- [x] 9.1 Update `README.md` Setup section with new PKCE/BYOK instructions:
  - Step-by-step guide to creating a Google Cloud project
  - Enabling the Google Drive API
  - Configuring OAuth consent screen (external vs. internal)
  - Creating OAuth 2.0 credentials (Client ID for Desktop app type)
  - Adding `obsidian://google-drive-sync` as an authorized redirect URI
  - Copying Client ID into the plugin settings
- [x] 9.2 Update the disclaimer section to note that the plugin no longer requires `ogd.richardxiong.com` for desktop authentication (when using the BYOK flow)
- [x] 9.3 Keep a note about the legacy auth method for existing users

## 11. Manual Testing and Verification

- [x] 10.1 Build the plugin with `npm run build` and verify no TypeScript errors (`tsc -noEmit -skipLibCheck`)
- [x] 10.2 Test the full PKCE auth flow: enter Client ID → click Authenticate → browser opens → grant consent → redirect back to Obsidian → tokens saved
- [x] 10.3 Verify that Google Drive API requests succeed with the new access token
- [x] 10.4 Test token refresh: wait for token expiry (or manually expire it) and verify automatic refresh via `oauth2.googleapis.com/token`
- [x] 10.5 Test error handling: invalid Client ID, denied consent, network failures during token exchange
- [x] 10.6 Test backward compatibility: verify existing users with a refresh token (no clientId) still work via the legacy auth path
- [x] 10.7 Test the standalone `test-oauth.ts` script: run it with a test client ID, complete the auth flow in browser, paste redirect URL, verify token exchange succeeds
- [x] 10.8 Verify `npm run build` produces a clean production build
