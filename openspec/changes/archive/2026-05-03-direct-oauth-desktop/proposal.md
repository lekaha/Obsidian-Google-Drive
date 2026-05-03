# Change: Direct OAuth Desktop (PKCE BYOK)

## Why

The current plugin relies on an external token exchange server (`https://example-oauth.com/api/access`) to convert Google refresh tokens into access tokens. This introduces several problems:

1. **Reliability**: The external server is currently experiencing 500 errors, blocking all new authentications and token refreshes for users.
2. **Privacy**: Users must trust a third-party server with their refresh tokens. Some users prefer full control over their authentication flow.
3. **Single point of failure**: The entire plugin ecosystem depends on this external server remaining operational.

Eliminating this dependency gives users direct control over their OAuth2 flow while removing the reliability risk.

## What Changes

- **OAuth2 PKCE Flow**: Implement a Proof Key for Code Exchange (PKCE) flow for desktop Obsidian. This allows the plugin to obtain access tokens directly from `oauth2.googleapis.com/token` without any intermediary server.
- **Bring Your Own Key (BYOK)**: Add settings for users to input their own Google Cloud Console OAuth Client ID (and optionally Client Secret). Users must create their own Google Cloud project with the Drive API enabled.
- **PKCE Code Generation**: Generate a cryptographically secure `code_verifier` and derive the `code_challenge` (SHA-256, base64url encoded) at authentication time.
- **Desktop Browser Authorization**: Open the Google authorization URL in the user's default desktop browser. The authorization URL includes the `code_challenge`, `client_id`, `redirect_uri`, and required scopes.
- **Custom Protocol Handler**: Register a custom protocol handler `obsidian://google-drive-sync` to catch the OAuth redirect. When Google redirects to this URI with the authorization code, the plugin extracts it from the URL parameters.
- **Direct Token Exchange**: Exchange the authorization code along with the `code_verifier` and `client_id` directly with `oauth2.googleapis.com/token` to obtain refresh and access tokens. Store the refresh token locally for future use.
- **Settings UI Updates**: Replace the current "refresh token from website" field with a new settings panel containing:
  - Google Client ID input field
  - Google Client Secret input field (optional, for non-PKCE fallback or confidential client flows)
  - "Authenticate with Google" button that initiates the PKCE flow
  - Status indicator showing authentication state
- **Token Refresh Logic**: Update the token refresh logic to use the direct OAuth2 token endpoint (`oauth2.googleapis.com/token`) with the stored refresh token and client credentials, instead of calling the external server.
- **Standalone Test Plan**: Build a Node.js CLI script (`test-oauth.ts`) to independently verify the PKCE flow and token exchange without requiring Obsidian. This allows developers to test the full OAuth flow in isolation, ensuring the PKCE challenge generation, Google authorization, code exchange, and token storage work correctly before integrating into the plugin.

## Impact

- **Desktop Only**: This change applies only to desktop Obsidian (Windows, macOS, Linux). Mobile (iOS) authentication continues to use the existing flow or a separate solution.
- **User Setup Required**: Users must create their own Google Cloud Console project, enable the Google Drive API, configure an OAuth consent screen, create OAuth 2.0 credentials (Client ID), and add `obsidian://google-drive-sync` as an authorized redirect URI.
- **External Server Deprecated**: The external token exchange server (`example-oauth.com`) is no longer used for token refresh or authentication on desktop. Existing refresh tokens obtained through the old flow may still work if users provide their own client credentials, or they will need to re-authenticate.
- **Backward Compatibility**: Existing users with valid refresh tokens should have a migration path or clear instructions on how to transition to the new BYOK flow.
