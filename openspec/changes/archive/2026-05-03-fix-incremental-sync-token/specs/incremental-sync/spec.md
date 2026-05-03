# incremental-sync Specification

## Purpose
Define how the plugin initializes and maintains incremental sync tokens across sessions to efficiently fetch only delta changes from Google Drive, reducing bandwidth and API quota consumption.

## Requirements

### Requirement: Initial token acquisition on plugin startup
When the plugin initializes for the first time, it SHALL fetch and persist the starting token from the Google Drive changes API before performing any sync operations.

#### Scenario: First plugin startup
- **WHEN** plugin loads and `settings.changesToken` is empty
- **THEN** `getChangesStartToken()` is called to fetch the current page token
- **AND** the result is stored in `settings.changesToken`
- **AND** settings are saved to persist the token

#### Scenario: Token persists across app restarts
- **WHEN** app is closed and reopened after initial token acquisition
- **THEN** `settings.changesToken` contains the previously saved token
- **AND** sync operations use this cached token

### Requirement: Incremental sync with cached token
Subsequent syncs SHALL use the cached token to retrieve only changes since the last sync, not the entire change history.

#### Scenario: Second sync uses cached token
- **WHEN** pull sync executes after initial token is cached
- **THEN** `getChanges(settings.changesToken)` is called with the cached token
- **AND** only changes since that token are returned
- **AND** not the full history of all changes

#### Scenario: Empty changes still updates token
- **WHEN** `pull()` completes even with no changes to process
- **THEN** `newStartPageToken` from the response is saved to `settings.changesToken`
- **AND** token is ready for next sync cycle

### Requirement: Token refresh on subsequent syncs
The `newStartPageToken` from each sync response SHALL be captured and persisted for the next sync.

#### Scenario: Token advances after each sync
- **WHEN** sync completes and returns `newStartPageToken`
- **THEN** this new token is saved to `settings.changesToken` before processing changes
- **AND** ensures subsequent syncs fetch from the correct point

### Requirement: Graceful fallback for missing token
If no token is available, the sync logic SHALL gracefully handle the missing token without errors.

#### Scenario: Sync with no token defaults to initial fetch
- **WHEN** `getChanges()` is called with an empty or missing token
- **THEN** it returns `{changes: [], newStartPageToken: ""}`
- **AND** next sync will acquire a fresh token or re-initialize
