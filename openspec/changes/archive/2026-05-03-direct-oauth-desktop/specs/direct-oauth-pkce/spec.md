## ADDED Requirements

### Requirement: PKCE code verifier and challenge generation

The plugin SHALL generate a cryptographically random `code_verifier` string (128 bytes, base64url encoded) and derive a `code_challenge` by computing the SHA-256 hash of the verifier and encoding the result as base64url (without padding), per RFC 7636 S256 method.

#### Scenario: Generate PKCE parameters on auth initiation
- **WHEN** the user clicks "Authenticate with Google"
- **THEN** a random `code_verifier` is generated using `crypto.getRandomValues()`
- **AND** `code_challenge` is derived via SHA-256 hash of the verifier, base64url encoded
- **AND** both values are stored temporarily in the plugin instance for the duration of the auth flow

### Requirement: Google authorization URL construction

The plugin SHALL construct a Google OAuth 2.0 authorization URL containing the required PKCE parameters and open it in the user's default browser.

#### Scenario: Authorization URL contains all required parameters
- **WHEN** the authorization URL is constructed
- **THEN** it includes: `client_id` (user-configured), `redirect_uri` (`obsidian://google-drive-sync`), `response_type=code`, `scope=https://www.googleapis.com/auth/drive.file`, `code_challenge`, `code_challenge_method=S256`, and `access_type=offline`, `prompt=consent`

#### Scenario: URL opens in default browser
- **WHEN** the user initiates authentication
- **THEN** `electron.shell.openExternal()` is called with the authorization URL
- **AND** the URL opens in the user's default system browser

### Requirement: Custom protocol handler for OAuth redirect

The plugin SHALL register a handler for the `obsidian://google-drive-sync` protocol to intercept the OAuth redirect and extract the authorization code from the URL query parameters.

#### Scenario: Extract authorization code from redirect
- **WHEN** Google redirects to `obsidian://google-drive-sync?code=AUTH_CODE`
- **THEN** the protocol handler captures the full URL
- **AND** the `code` query parameter is extracted
- **AND** the in-memory `code_verifier` is retrieved for token exchange

#### Scenario: Handle error in redirect
- **WHEN** Google redirects with `obsidian://google-drive-sync?error=ACCESS_DENIED`
- **THEN** the error is displayed to the user
- **AND** the auth flow is terminated gracefully

### Requirement: Direct token exchange with Google OAuth2 endpoint

The plugin SHALL exchange the authorization code for access and refresh tokens by making a POST request directly to `https://oauth2.googleapis.com/token`, including the `code`, `client_id`, `redirect_uri`, `code_verifier`, and `grant_type=authorization_code`.

#### Scenario: Successful token exchange
- **WHEN** the POST request to `oauth2.googleapis.com/token` succeeds
- **THEN** the response contains `access_token`, `refresh_token`, `token_type`, `expires_in`, and `scope`
- **AND** the `refresh_token` is persisted via `saveData()` into `settings.refreshToken`
- **AND** the `access_token` is stored in-memory with its calculated `expiresAt` timestamp
- **AND** the temporary `code_verifier` is cleared from memory

#### Scenario: Token exchange failure
- **WHEN** the POST request fails (network error, invalid code, etc.)
- **THEN** an error notice is shown to the user with the failure reason
- **AND** no tokens are stored
- **AND** the temporary `code_verifier` is cleared

### Requirement: Direct token refresh with Google OAuth2 endpoint

The plugin SHALL refresh expired access tokens by making a POST request directly to `https://oauth2.googleapis.com/token` with the stored `refresh_token`, `client_id`, and `grant_type=refresh_token`.

#### Scenario: Automatic token refresh on expiry
- **WHEN** the in-memory access token expires (within 60 seconds of `expiresAt`)
- **AND** a Google Drive API request is about to be made
- **THEN** a POST request is sent to `oauth2.googleapis.com/token` with `grant_type=refresh_token`
- **AND** the new access token replaces the expired one in memory
- **AND** `expiresAt` is recalculated

#### Scenario: Refresh token revoked or invalid
- **WHEN** the refresh request returns an error (e.g., `invalid_grant`)
- **THEN** the stored `refresh_token` is cleared from settings
- **AND** the user is prompted to re-authenticate
- **AND** the error is logged for debugging

### Requirement: Settings UI for BYOK OAuth2 configuration

The plugin settings tab SHALL provide inputs for Google OAuth credentials and initiate the PKCE authentication flow.

#### Scenario: Configure Google Client ID
- **WHEN** the user opens the plugin settings
- **THEN** a text input field labeled "Google Client ID" is displayed
- **AND** the value is saved to `settings.clientId` on change
- **AND** a text input field labeled "Google Client Secret" (optional) is displayed

#### Scenario: Initiate PKCE authentication
- **WHEN** the user has entered a Client ID and clicks "Authenticate with Google"
- **THEN** the PKCE flow begins (code verifier generation, browser redirect, protocol handler registration)
- **AND** a status indicator shows "Awaiting authorization..."

#### Scenario: Authentication success
- **WHEN** the token exchange completes successfully
- **THEN** the status indicator shows "Authenticated"
- **AND** the initial Drive changes token is fetched
- **AND** the user is prompted to reload Obsidian

#### Scenario: Missing Client ID validation
- **WHEN** the user clicks "Authenticate with Google" without entering a Client ID
- **THEN** a validation error is shown: "Please enter your Google Client ID first"
- **AND** the auth flow does not start

### Requirement: Platform registration of custom protocol handler

On desktop platforms, the plugin SHALL ensure the `obsidian://google-drive-sync` protocol handler is registered. Since Obsidian already registers `obsidian://`, the plugin SHALL use Obsidian's `registerObsidianURLHandler()` API to handle sub-URLs.

#### Scenario: Handler registered on plugin load
- **WHEN** the plugin's `onload()` executes
- **THEN** `registerObsidianURLHandler()` is called with the handler callback
- **AND** the handler routes `google-drive-sync` sub-URLs to the OAuth callback

#### Scenario: Handler unregistered on plugin unload
- **WHEN** the plugin's `onunload()` executes
- **THEN** the custom URL handler is deregistered
- **AND** no stale handlers remain registered

## MODIFIED Requirements

### Requirement: Token refresh in HTTP client hooks

The `getDriveKy()` HTTP client hook SHALL continue to auto-refresh expired access tokens, but now calls the direct Google OAuth2 endpoint instead of the external token exchange server.

#### Scenario: Before-request hook triggers token refresh
- **WHEN** a request is about to be sent and the access token is expired
- **THEN** `refreshAccessToken()` calls `oauth2.googleapis.com/token` with the refresh token and client ID
- **AND** the `Authorization: Bearer` header is set with the new access token

#### Scenario: Network error during refresh
- **WHEN** the token refresh request fails due to network issues
- **THEN** `checkConnection()` is called to determine offline status
- **AND** appropriate user notice is shown (offline vs. auth error)

## DELETED Requirements

### Requirement: External token exchange server dependency

The plugin SHALL NOT make any requests to `https://example-oauth.com/api/access` for token exchange or refresh operations in the new PKCE flow.

#### Scenario: No external server calls during auth
- **WHEN** the PKCE authentication flow executes
- **THEN** no requests are made to `example-oauth.com/api/access`
- **AND** all token operations use `oauth2.googleapis.com/token` directly
