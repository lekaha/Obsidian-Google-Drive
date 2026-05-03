## Context

**Current State**: The plugin authenticates with Google Drive via a two-step process: (1) users obtain a refresh token from `https://example-oauth.com` through a web UI, (2) the plugin exchanges this refresh token for access tokens via the same server's `/api/access` endpoint. The OAuth client secret is kept server-side.

**Problem**: The external server currently returns 500 errors, blocking all new authentications. Additionally, users must trust a third-party server with their refresh tokens, raising privacy concerns.

**Constraints**:
- Must work within Obsidian's desktop plugin architecture (Electron/Node.js environment)
- Must maintain backward compatibility with existing sync logic (push/pull, conflict resolution)
- Mobile (iOS) uses a different auth mechanism (short-lived codes) - out of scope
- Google OAuth requires a verified consent screen for scopes like `drive.file`

**Stakeholders**: Desktop Obsidian users, plugin maintainers.

## Goals / Non-Goals

**Goals:**
- Eliminate dependency on `example-oauth.com` for desktop authentication
- Implement PKCE-based OAuth2 flow that communicates directly with Google's OAuth2 endpoints
- Provide a self-contained BYOK experience where users supply their own Google Cloud credentials
- Store refresh tokens locally within Obsidian's plugin data store (encrypted by Obsidian's own mechanisms)

**Non-Goals:**
- Mobile (iOS) authentication - separate concern, continues using existing flow
- Automatic Google Cloud project provisioning - users must create their own
- Migration of existing refresh tokens from the old server (users must re-authenticate with their own credentials)
- OAuth consent screen verification - users handle this in their own Google Cloud project

## Decisions

### Decision 1: Use PKCE (Code Challenge Method S256) for Desktop

**Decision**: Implement PKCE with `code_challenge_method=S256` even for desktop.

**Rationale**: PKCE was originally designed for public clients (mobile/SPA) where the client secret cannot be securely stored. Desktop Obsidian plugins run in an Electron environment where the client secret would be exposed in the bundled code. PKCE provides equivalent security without requiring a client secret.

**Alternatives Considered**:
- *Confidential Client Flow (Authorization Code + Client Secret)*: Would require bundling the client secret in the plugin, which is trivially extractable from the minified JS bundle. Rejected.
- *Implicit Grant Flow*: Deprecated by Google, doesn't provide refresh tokens. Rejected.

### Decision 2: Custom Protocol Handler (`obsidian://google-drive-sync`)

**Decision**: Use `obsidian://google-drive-sync` as the OAuth redirect URI.

**Rationale**: Obsidian already registers the `obsidian://` protocol. By using a sub-path, we can catch the OAuth redirect and extract the authorization code. This avoids needing a local HTTP server or polling mechanism.

**Alternatives Considered**:
- *Local HTTP Server (localhost:PORT)*: Would require opening a port, potential firewall issues, port conflicts. More complex to implement reliably.
- *File-based callback*: Write auth code to a temp file, poll for it. Slow and unreliable.
- *Copy-paste auth code*: User manually copies code from browser and pastes into Obsidian. Friction-heavy but could be a fallback.

### Decision 3: Use `electron.shell.openExternal()` for Browser Authorization

**Decision**: Open the Google authorization URL using Obsidian's Electron `shell.openExternal()` API.

**Rationale**: This is the standard way to open external URLs from Electron apps. It opens the user's default browser, ensuring the Google login page uses the user's existing browser session (cookies, saved passwords).

**Alternatives Considered**:
- *Embedded webview*: Would not share the user's browser session, requiring them to log in again. Worse UX.

### Decision 4: In-Memory Access Token with Local Refresh Token

**Decision**: Store the access token in-memory (current approach) and the refresh token in Obsidian's plugin data store via `saveData()` (current approach).

**Rationale**: Access tokens are short-lived (~1 hour) and should not be persisted to disk. Refresh tokens are long-lived and must persist across app restarts. Obsidian's `saveData()` persists to the `.obsidian/plugins/obsidian-google-drive/data.json` file, which is already used for settings storage.

### Decision 5: SHA-256 + Base64URL for PKCE Code Challenge

**Decision**: Generate a 128-byte random `code_verifier`, compute SHA-256 hash, encode as base64url (no padding).

**Rationale**: This is the RFC 7636 standard for PKCE S256. The Web Crypto API (`crypto.subtle.digest('SHA-256', ...)`) is available in Obsidian's Electron environment.

### Decision 6: Settings UI - Replace Refresh Token Field with OAuth Flow

**Decision**: The settings UI will have:
- **Google Client ID** (text input) - Required
- **Google Client Secret** (text input) - Optional (for confidential client fallback)
- **"Authenticate with Google"** button - Initiates PKCE flow
- **Status indicator** - Shows "Authenticated", "Not configured", or "Error"

**Rationale**: Clear, minimal UI that guides users through the BYOK setup. The client secret is optional since PKCE doesn't require it for public clients.

**Alternatives Considered**:
- *Keep existing refresh token field + add Client ID field*: Confusing UX with two auth methods. Better to have a single clear flow.

## Risks / Trade-offs

**[Risk] Users must create their own Google Cloud project**
→ **Mitigation**: Provide detailed, step-by-step documentation. Include screenshots. Consider a setup wizard in the settings UI.

**[Risk] Google OAuth consent screen verification delays**
→ **Mitigation**: Users can still use unverified consent screens (with a warning). The `drive.file` scope may not require full verification for personal use.

**[Risk] Custom protocol handler may not work on all platforms**
→ **Mitigation**: `obsidian://` is registered by Obsidian on all platforms. Test on Windows, macOS, Linux. Provide a manual copy-paste fallback.

**[Risk] Token revocation on client credential rotation**
→ **Mitigation**: If a user rotates their OAuth credentials (creates new client ID), old refresh tokens stop working. Clear documentation on how to re-authenticate.

**[Trade-off] No automatic migration of existing refresh tokens**
→ Users with old refresh tokens from `example-oauth.com` must re-authenticate. This is a breaking change but simplifies the implementation significantly.

**[Trade-off] Desktop-only scope**
→ iOS users continue using the existing token-from-website flow. This creates two authentication paths but allows us to ship desktop improvements quickly.

## Migration Plan

**Not applicable** - This is a breaking change for authentication. The migration plan is purely instructional:

1. **Step 1**: Release new version with both auth methods (old refresh token + new PKCE flow) side-by-side
2. **Step 2**: Show a deprecation notice for the old auth method in settings
3. **Step 3**: In a subsequent release, remove the old auth method entirely
4. **Rollback**: Users can downgrade to the previous plugin version if needed

**For this change**: We implement the new PKCE flow while keeping the old refresh token field. The old flow continues to work. Migration communication is handled via plugin release notes and a notice in the settings UI.

## Open Questions

1. **Should we support both auth methods simultaneously?** → Yes, for backward compatibility. Users can choose either flow.
2. **What scopes are needed?** → `https://www.googleapis.com/auth/drive.file` (per-file access). This is the minimum scope for sync functionality.
3. **Should we auto-generate the PKCE code verifier on page load or button click?** → On button click. This avoids storing the verifier until the user initiates auth.
4. **Do we need a local HTTP server as a fallback?** → Not for MVP. Custom protocol handler should suffice. Add as enhancement if needed.

## Test Plan (Standalone)

**Objective**: Verify the PKCE flow, code exchange, and token storage work correctly without running Obsidian.

**Approach**: A standalone Node.js CLI script (`test-oauth.ts`) will independently test the entire OAuth flow:

1. **Code Challenge Generation**: The script generates a random `code_verifier` (128 bytes) and derives the `code_challenge` (SHA-256, base64url encoded).

2. **Authorization URL**: The script constructs the Google authorization URL with:
   - `client_id` (from user input)
   - `scope: https://www.googleapis.com/auth/drive.file`
   - `redirect_uri: obsidian://google-drive-sync`
   - `code_challenge` and `code_challenge_method=S256`
   - `response_type=code`

3. **Browser Redirect**: The script prints the full authorization URL to the terminal and opens it in the user's default browser (via `open` command on macOS or `xdg-open` on Linux / `start` on Windows).

4. **User Authentication**: The user authenticates in their browser and grants consent. Google redirects to `obsidian://google-drive-sync?code=AUTH_CODE&state=STATE` (or error).

5. **Manual URL Capture**: Since this script runs outside Obsidian, the `obsidian://` protocol handler does not work. Instead, the user is instructed to:
   - Copy the full browser address bar URL after the redirect attempt (e.g., `obsidian://google-drive-sync?code=4/0AX4XfWhK...&state=...`)
   - Paste it into the terminal when the script prompts: "Paste the redirect URL here:"

6. **Code Extraction**: The script parses the pasted URL to extract the `code` parameter.

7. **Token Exchange**: The script POSTs to `https://oauth2.googleapis.com/token` with:
   - `code` (from URL)
   - `client_id`
   - `redirect_uri: obsidian://google-drive-sync`
   - `code_verifier`
   - `grant_type=authorization_code`

8. **Token Verification**: On success, the script:
   - Displays the refresh token
   - Stores it to a temporary file (e.g., `.test-oauth-token`)
   - Attempts a `GET https://www.googleapis.com/drive/v3/about?fields=user` with the access token to verify it works
   - Prints "✓ OAuth flow successful!"

9. **Error Handling**: The script gracefully handles:
   - Missing or invalid `code` parameter in the redirect URL
   - OAuth token exchange errors (invalid client, expired code, etc.)
   - API request failures (network, invalid token, etc.)

**Output Files**:
- `src/test-oauth.ts`: The standalone test script (source)
- `test-oauth.js`: Compiled version (added to `.gitignore`)
- `.test-oauth-token`: Temporary file containing the refresh token (added to `.gitignore`)

**Usage**:
```bash
npx ts-node src/test-oauth.ts --client-id YOUR_CLIENT_ID [--client-secret YOUR_CLIENT_SECRET]
```

**Success Criteria**:
- Script opens Google auth URL in browser
- User can authenticate and grant consent
- Script correctly parses the redirect URL
- Token exchange succeeds and returns valid refresh + access tokens
- API test call succeeds with the access token
- Script exits cleanly with "✓ OAuth flow successful!"
