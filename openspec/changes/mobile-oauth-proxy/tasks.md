## 1. Static HTML Proxy Redirect Page

- [ ] 1.1 Create `static/redirect.html` with inline JavaScript that parses `code`, `state`, and `error` query parameters from the URL
- [ ] 1.2 Implement client-side redirect to `obsidian://google-drive-sync?code=<CODE>` with a 500ms timeout
- [ ] 1.3 Add fallback UI: if deep link doesn't activate within 3 seconds, display the auth code and a "Copy Code" button
- [ ] 1.4 Add error page rendering: when `error` param is present (e.g., `access_denied`), show user-friendly error message instead of redirecting
- [ ] 1.5 Verify the static HTML is self-contained (no external dependencies) and can be deployed to GitHub Pages or any static host

## 2. Plugin Settings — Proxy URL Configuration

- [ ] 2.1 Add `proxyRedirectUrl` field to `PluginSettings` interface in `main.ts`
- [ ] 2.2 Add default proxy URL constant (e.g., `https://obsidian-google-drive.github.io/oauth-redirect.html`) in a constants file or `oauth.ts`
- [ ] 2.3 Add a Settings UI field in `SettingsTab` for displaying and editing the proxy redirect URL
- [ ] 2.4 Add validation: if the proxy URL field is empty, revert to default on save

## 3. Mobile Platform Detection and Flow Selection

- [ ] 3.1 Implement `isMobile()` detection function (check for `capacitor` or `cordova` environment indicators, or absence of Electron `shell`)
- [ ] 3.2 Add `useMobileOAuthProxy` boolean to `PluginSettings` interface to allow manual override
- [ ] 3.3 Add a toggle in `SettingsTab` to enable/disable `useMobileOAuthProxy` mode
- [ ] 3.4 Modify `startAuthFlow()` in `helpers/oauth.ts` to accept the detection result and choose redirect URI accordingly

## 4. Proxy Redirect Auth Flow Implementation

- [ ] 4.1 In `helpers/oauth.ts`, create a new `startMobileAuthFlow()` function that:
  - Generates PKCE code verifier and challenge (reuse existing `pkce.ts`)
  - Builds the Google OAuth authorization URL with `redirect_uri` set to the user-configured proxy URL
  - Opens the URL via `shell.openExternal()` (desktop) or `window.open()` (mobile webview)
- [ ] 4.2 Ensure `startAuthFlow()` delegates to `startMobileAuthFlow()` when mobile detection returns true or the settings toggle is enabled
- [ ] 4.3 Update the token exchange in `doExchangeCodeForTokens()` to use the proxy redirect URI when exchanging tokens on mobile

## 5. Deep Link Protocol Handler Registration

- [ ] 5.1 Register a URL handler for `obsidian://google-drive-sync` deep links using Obsidian mobile's deep link API (e.g., `window.addEventListener('url', ...)` for Capacitor)
- [ ] 5.2 Implement the handler: parse incoming URL, extract `code` query parameter, validate PKCE state
- [ ] 5.3 On valid deep link receipt, call `doExchangeCodeForTokens()` with the extracted code
- [ ] 5.4 Handle edge cases: no code parameter, PKCE state mismatch, expired PKCE state (15-minute timeout)
- [ ] 5.5 Add error notices for all failure modes (missing code, state mismatch, expired verifier)

## 6. PKCE State Persistence and Lifecycle

- [ ] 6.1 Add timestamp tracking to `PkceState` interface to support 15-minute expiry
- [ ] 6.2 Ensure PKCE state is persisted to plugin data so it survives app backgrounding on mobile
- [ ] 6.3 Clear PKCE state on successful token exchange, on auth error, or after 15-minute timeout
- [ ] 6.4 Write a unit-testable helper function `isPkceStateExpired(state): boolean` that checks the 15-minute window

## 7. Testing and Validation

- [ ] 7.1 Create `test-redirect.html` (or equivalent) — a standalone test file that:
  - Loads `static/redirect.html` in isolation
  - Appends `?code=test123&state=abc` to the URL
  - Verifies (via console or DOM inspection) that the redirect attempt targets `obsidian://google-drive-sync?code=test123`
  - Confirms the fallback copy button appears after 3 seconds
- [ ] 7.2 Create a standalone test script `test-mobile-oauth.ts` that:
  - Mocks the deep link handler input with `obsidian://google-drive-sync?code=mock_code`
  - Verifies the code is correctly extracted and passed to the token exchange function
  - Tests error cases: missing code, expired PKCE state, state mismatch
- [ ] 7.3 Write an end-to-end test checklist (in `TESTING.md` or a comment block) documenting the manual steps for testing on mobile:
  - Open mobile Obsidian → enter Client ID → click Authenticate
  - Verify Google consent page opens in browser
  - Grant consent and confirm redirect to Obsidian app
  - Verify refresh token and access token are stored in plugin settings
- [ ] 7.4 Verify `npm run build` passes with no TypeScript errors after all changes

## 8. Documentation Updates

- [ ] 8.1 Update `README.md` Setup section: add instructions for mobile BYOK authentication, including registering the proxy redirect URL as an authorized redirect URI in Google Cloud Console
- [ ] 8.2 Document the `redirect.html` file's purpose, how to self-host it, and the deep link format
- [ ] 8.3 Add a troubleshooting section for common mobile OAuth issues (deep link not intercepted, port conflicts, state mismatch)
