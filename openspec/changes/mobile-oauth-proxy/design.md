## Context

The plugin currently authenticates via a loopback HTTP server (`http://127.0.0.1:18412`) that opens the Google OAuth 2.0 authorization URL and waits for a callback. This works on desktop Electron but fails on mobile Obsidian because:

1. Google rejects `obsidian://` as a redirect URI (custom URI schemes without a period are blocked).
2. Mobile browsers cannot route `127.0.0.1` callbacks back to the Obsidian app.
3. The existing codebase already has PKCE (`helpers/pkce.ts`) and a token exchange function in `helpers/oauth.ts`.

The plugin is an Obsidian community plugin written in TypeScript, targeting both desktop (Electron) and mobile (Capacitor/Cordova webview) environments.

## Goals / Non-Goals

**Goals:**
- Enable mobile users to authenticate with their own Google Cloud credentials (BYOK) without copy-pasting authorization codes.
- Provide a seamless browser-to-app deep link bridge via a static HTTPS page.
- Keep desktop loopback OAuth flow completely untouched.
- Maintain PKCE security throughout the flow.

**Non-Goals:**
- Building or maintaining a backend server for the proxy page — it must be fully static (GitHub Pages, user-hosted, etc.).
- Changing the token exchange endpoint or Google Drive API interactions.
- Deprecating the desktop loopback flow.
- Supporting third-party OAuth relay servers (pure client-side + PKCE only).

## Decisions

### Decision 1: Static HTML proxy page instead of a server-side redirect

**Decision**: The proxy page is a single static HTML file with inline JavaScript. It runs entirely client-side.

**Rationale**: The proxy page only needs to read the `code` query parameter from Google's redirect and call `window.location.href = 'obsidian://google-drive-sync?code=...'`. No server logic, no secrets, no backend. This allows hosting on GitHub Pages, any static file host, or even pasted into a user's own web server.

**Alternatives considered**:
- Server-side redirect (e.g., Express endpoint): Adds infrastructure cost, requires maintenance, introduces a middleman for auth data. Rejected.
- Universal Links / App Links: Require domain ownership registration with Google/Apple. Obsidian doesn't own a domain that can register `obsidian://`. Not feasible.

### Decision 2: Dedicated proxy URL in the authorization request

**Decision**: On mobile, the authorization URL's `redirect_uri` parameter points to the HTTPS proxy page URL (e.g., `https://example.com/oauth-redirect.html`), not the loopback IP.

**Rationale**: Google only accepts HTTPS redirect URIs for web application OAuth client types. The proxy page is a valid HTTPS endpoint that then bridges to the deep link.

**Alternatives considered**:
- Using `urn:ietf:wg:oauth:2.0:oob` (Out of Band): Requires manual copy-paste of the authorization code. Defeats the UX goal. Rejected.

### Decision 3: Protocol handler registration via `window.addEventListener('message')` or deep link interception

**Decision**: On mobile, after the browser redirects to `obsidian://`, Obsidian must intercept it. On mobile Obsidian (Capacitor/Cordova), deep link handling is provided by the underlying mobile framework. The plugin registers a handler for the `obsidian://google-drive-sync` URL scheme that extracts the `code` query parameter.

**Rationale**: Obsidian mobile already handles `obsidian://` links for plugin commands. We use a dedicated path (`/google-drive-sync`) to avoid collisions with other plugins or core Obsidian commands.

### Decision 4: Proxy URL configurable in plugin settings

**Decision**: The HTTPS proxy URL is stored in plugin settings with a sensible default (pointing to a community-maintained GitHub Pages site), but users can override it to their own hosted copy.

**Rationale**: Users should not be forced to trust a single community URL. They can audit the static HTML and host their own copy if desired.

## Risks / Trade-offs

- **[Risk] Proxy page goes offline** → The proxy URL is customizable; users can host their own copy. The static HTML file is trivial and unlikely to break.
- **[Risk] Google blocks the proxy redirect URI** → Google allows HTTPS redirect URIs for web OAuth clients. The user registers the proxy URL in their Google Cloud Console as an authorized redirect URI alongside (or instead of) the loopback IP.
- **[Risk] Deep link interception fails on some mobile configurations** → Fallback: display the authorization code on-screen with a copy button. The proxy page can show a "If redirect didn't work, copy this code" fallback.
- **[Trade-off] Adds one more redirect hop** → Google → proxy page → obsidian deep link. This adds ~200-500ms latency to the auth flow but is imperceptible to users compared to the alternative of manual code copy-paste.
- **[Trade-off] Trust in community proxy page** → Mitigated by: (1) the HTML is auditable and static, (2) users can self-host, (3) no tokens pass through the proxy page — only the authorization code, which is PKCE-protected anyway.

## Migration Plan

1. Add the `redirect.html` file to the project repository for GitHub Pages hosting.
2. Add the `mobile-oauth-proxy` feature toggle to plugin settings.
3. Modify `helpers/oauth.ts` to detect mobile platform and conditionally use the proxy flow.
4. Register the `obsidian://google-drive-sync` deep link handler in `main.ts`.
5. Add settings UI for proxy URL configuration.
6. **Rollback**: Remove the settings toggle; desktop loopback flow remains fully functional.

## Open Questions

- Should the default proxy URL point to a community-maintained GitHub Pages URL, or should each user be required to host their own copy? (Recommendation: provide a default community URL but allow override.)
- What is the exact deep link format Obsidian mobile expects? (Investigate if `obsidian://google-drive-sync?code=...` is correctly intercepted, or if a different path/scheme is needed.)
