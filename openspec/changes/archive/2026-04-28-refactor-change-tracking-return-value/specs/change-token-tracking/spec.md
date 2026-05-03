## ADDED Requirements

### Requirement: getChanges returns token with changes
The `getChanges()` function SHALL return an object containing both the changes array and the `newStartPageToken` from the Google Drive API response.

#### Scenario: Normal changes fetch
- **WHEN** `getChanges()` is called with a valid start token
- **THEN** it returns `{changes: [...], newStartPageToken: "..."}`

#### Scenario: Initial sync with no token
- **WHEN** `getChanges()` is called with no start token
- **THEN** it returns `{changes: [], newStartPageToken: ""}`

### Requirement: Token persistence after pull
After pulling changes from Google Drive, the `newStartPageToken` SHALL be immediately saved to plugin settings before processing changes.

#### Scenario: Successful token save
- **WHEN** `pull()` completes a successful `getChanges()` call
- **THEN** the returned `newStartPageToken` is saved to `settings.changesToken`

#### Scenario: Token saved even on empty changes
- **WHEN** `pull()` fetches changes but the changes array is empty
- **THEN** the `newStartPageToken` is still saved to settings

### Requirement: Proper pagination token tracking
When paginating through multiple pages of changes, the `newStartPageToken` from the final page SHALL be returned and used for the next sync cycle.

#### Scenario: Multi-page changes
- **WHEN** `getChanges()` processes multiple pages with `nextPageToken`
- **THEN** the `newStartPageToken` from the final page response is returned
