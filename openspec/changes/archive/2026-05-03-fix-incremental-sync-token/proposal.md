## Why

The `getChanges` method is discarding the `newStartPageToken` returned by the Google Drive API, so the incremental sync token is never persisted. Every sync after the first one re-uses the exact same initial token. Since Google Drive already returned all changes for that token during the first sync, it returns an empty list for all subsequent syncs, causing the plugin to show "0% → You're up to date!" while actually missing files that were changed or uploaded to Google Drive.

A new refresh token temporarily "fixes" it because it clears the sync state and forces a full time-based sync (`lastSyncedAt = 0`), which rescans all files—but the root cause remains unfixed, and the problem repeats once that sync completes.

## What Changes

- **Fix `getChanges()` to return the `newStartPageToken`** so that it's not discarded
- **Persist the token** in settings so it survives across Obsidian restarts and syncs
- **Use the persisted token on subsequent syncs** to fetch only new/changed files since the last sync, preventing empty results
- **Ensure proper token rotation** so each sync updates the token for the next one

## Capabilities

### New Capabilities

### Modified Capabilities
- `incremental-sync`: Fixes the token persistence bug so that sync tokens are properly cached and reused across sessions, enabling true incremental syncs instead of full refetches

## Impact

- **User Experience**: Users will no longer see "0% → You're up to date!" while missing files. Syncs will properly detect and pull new/changed files from Google Drive on every sync.
- **Workaround No Longer Needed**: Users won't need to generate new refresh tokens to reset the sync state. A single token can reliably sync indefinitely.
- **Performance**: Incremental syncs become true deltas instead of empty operations, reducing unnecessary API calls and improving sync responsiveness.
- **Code**: `src/sync/pull.ts` (`getChanges` method), settings storage for the incremental sync token
- **Behavior**: Subsequent syncs only fetch changes since the last stored token (not re-scanning the entire vault every time)
