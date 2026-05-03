## Why

Bring Your Own Key (BYOK) OAuth on mobile Obsidian fails because:

1. **Google blocks custom URI schemes lacking a period**: Redirect URIs like `obsidian://callback` are rejected by Google's OAuth 2.0 server because they don't contain a dot in the scheme, which Google requires for security.
2. **Mobile browsers cannot route loopback IPs**: The current desktop approach opens `http://127.0.0.1:18412` as the redirect URI, but mobile browsers don't route loopback addresses to the Obsidian app.

Users are left with no viable path to authenticate on mobile with their own Google Cloud credentials.

## What Changes

- Introduce an **HTTPS Proxy Redirect** flow for mobile authentication, allowing Google to redirect to a valid HTTPS URL (e.g., a static GitHub Pages site or user-hosted page).
- The static HTTPS page catches Google's authorization code redirect and executes client-side JavaScript to redirect the browser to the `obsidian://google-drive-sync?code=...` deep link, bridging the browser-to-app gap.
- The Obsidian plugin registers a custom protocol handler to receive the `obsidian://` deep link, extract the authorization code, and complete the token exchange using Proof Key for Code Exchange (PKCE).
- Add a `mobile-oauth-proxy` capability flag to gate this feature, enabling it only on mobile-capable platforms or via user opt-in.
- **No Breaking Changes**: Desktop loopback OAuth flow remains unchanged. This adds an alternative mobile path.

## Capabilities

### New Capabilities

- `mobile-oauth-proxy`: HTTPS-based proxy redirect flow for mobile OAuth authentication, including the static HTML redirect page, deep link protocol handler registration, and PKCE code exchange from the deep link payload.

### Modified Capabilities

<!-- None — this is a purely additive feature -->

## Impact

- **New files**: A static `redirect.html` (or equivalent) to be hosted on GitHub Pages or a user-provided HTTPS server. This file contains client-side JavaScript to parse the `code` query parameter from Google's redirect and navigate to the `obsidian://` deep link.
- **Modified files**:
  - `helpers/oauth.ts`: Add a new auth flow branch that opens the HTTPS proxy URL instead of the loopback URL, and registers a listener for the `obsidian://` deep link callback.
  - `main.ts`: Add settings UI toggle for mobile proxy redirect, protocol handler registration, and capability detection for mobile vs desktop.
- **Dependencies**: None new — PKCE already exists in the codebase (`helpers/pkce.ts`).
- **Platform impact**: Desktop users are unaffected by default; mobile users gain a seamless authentication path without copy-pasting codes or relying on third-party backend servers.
