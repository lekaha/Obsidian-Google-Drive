## ADDED Requirements

### Requirement: Static HTTPS proxy redirect page
The system SHALL provide a static HTML page that serves as an intermediary redirect endpoint for Google OAuth callbacks on mobile devices. This page MUST read the `code` and `state` query parameters from the URL and redirect the browser to the `obsidian://google-drive-sync` deep link scheme, passing the authorization code as a query parameter. On redirect failure or when the deep link is not intercepted, the page SHALL display the authorization code on-screen with a copy button as a fallback.

#### Scenario: Successful redirect via deep link
- **WHEN** Google redirects the browser to the proxy page with a valid `code` query parameter
- **THEN** the page executes JavaScript to navigate to `obsidian://google-drive-sync?code=<CODE_VALUE>` within 500ms of page load

#### Scenario: Fallback with copy button when deep link fails
- **WHEN** the deep link redirect does not trigger the Obsidian app within 3 seconds
- **THEN** the page displays the authorization code and a "Copy Code" button for manual copy-paste

#### Scenario: Error state handling
- **WHEN** Google redirects to the proxy page with an `error` query parameter (e.g., `access_denied`)
- **THEN** the page displays the error message to the user instead of attempting a deep link redirect

### Requirement: Mobile-detectable auth flow selection
The plugin SHALL detect whether it is running on a mobile platform and select the appropriate OAuth flow: the existing loopback HTTP server flow for desktop, and the HTTPS proxy redirect flow for mobile. This detection SHALL be automatic but MAY be overridden by a user setting.

#### Scenario: Desktop uses loopback flow
- **WHEN** the plugin is running on desktop Obsidian (Electron)
- **THEN** the authentication flow opens the Google OAuth URL with `redirect_uri=http://127.0.0.1:18412` and waits for the loopback callback

#### Scenario: Mobile uses proxy redirect flow
- **WHEN** the plugin is running on mobile Obsidian (Capacitor/Cordova)
- **THEN** the authentication flow opens the Google OAuth URL with `redirect_uri` set to the configured HTTPS proxy URL

#### Scenario: User overrides flow selection
- **WHEN** the user has explicitly configured `mobile-oauth-proxy` mode in plugin settings
- **THEN** the plugin uses the proxy redirect flow regardless of platform detection

### Requirement: Protocol handler for deep link callback
The plugin SHALL register a handler for the `obsidian://google-drive-sync` URL scheme on mobile platforms. When the app receives this deep link, the plugin MUST extract the `code` query parameter, validate it against the stored Proof Key for Code Exchange (PKCE) state, and initiate the token exchange with Google's token endpoint.

#### Scenario: Deep link received with valid code
- **WHEN** the plugin receives `obsidian://google-drive-sync?code=<CODE>`
- **THEN** the plugin extracts the code, exchanges it for tokens using the stored PKCE code verifier, and saves the refresh token to settings

#### Scenario: Deep link received without code
- **WHEN** the plugin receives `obsidian://google-drive-sync` without a `code` parameter
- **THEN** the plugin displays an error notice and clears any pending PKCE state

#### Scenario: Deep link received with invalid PKCE state
- **WHEN** the plugin receives a deep link but no valid PKCE state exists (e.g., code verifier expired or missing)
- **THEN** the plugin rejects the exchange and displays an error notice to the user

### Requirement: Configurable proxy URL in plugin settings
The plugin SHALL provide a settings field for the HTTPS proxy redirect URL with a default value pointing to a community-maintained static page. Users MUST be able to override this URL to host their own copy of the proxy page.

#### Scenario: Default proxy URL is used
- **WHEN** the user has not customized the proxy URL setting
- **THEN** the plugin uses the default community-provided HTTPS proxy URL

#### Scenario: User provides custom proxy URL
- **WHEN** the user enters a custom URL in the proxy URL settings field
- **THEN** the plugin uses the custom URL as the `redirect_uri` parameter in the OAuth authorization request

#### Scenario: User clears proxy URL
- **WHEN** the user clears the proxy URL field
- **THEN** the plugin reverts to the default community-provided proxy URL

### Requirement: PKCE code verifier persistence across app lifecycle
The plugin SHALL persist the PKCE code verifier and state across the OAuth flow transition, including the period when the browser is open for user consent and redirects back via the deep link. The code verifier MUST be cleared after successful token exchange or after a timeout period of 15 minutes.

#### Scenario: Code verifier available after browser redirect
- **WHEN** the user completes Google consent and the browser redirects back to the app
- **THEN** the plugin retrieves the stored PKCE code verifier and uses it in the token exchange request

#### Scenario: Code verifier expires after timeout
- **WHEN** 15 minutes have elapsed since the auth flow was initiated
- **THEN** the plugin clears the stored PKCE state and requires the user to restart authentication

### Requirement: Test plan for standalone validation
The project SHALL include a standalone test plan that validates: (1) the static HTML proxy page correctly parses query parameters and triggers redirect, (2) the deep link handler correctly extracts and processes authorization codes, and (3) the end-to-end OAuth flow on mobile produces valid tokens.

#### Scenario: Static HTML page tested in isolation
- **WHEN** the `redirect.html` file is opened in a browser with `?code=test123&state=abc` appended
- **THEN** the page attempts to redirect to `obsidian://google-drive-sync?code=test123` and displays a fallback copy option if the redirect does not succeed

#### Scenario: Deep link handler tested via simulated URL
- **WHEN** the plugin's deep link handler is invoked with a simulated `obsidian://google-drive-sync?code=mock_code` URL
- **THEN** the handler extracts `mock_code` and initiates the token exchange process

#### Scenario: End-to-end mobile OAuth flow produces valid tokens
- **WHEN** the mobile OAuth flow is initiated, the user grants Google consent, and the browser redirects back to Obsidian
- **THEN** the plugin stores a valid refresh token and a non-expired access token in its settings
