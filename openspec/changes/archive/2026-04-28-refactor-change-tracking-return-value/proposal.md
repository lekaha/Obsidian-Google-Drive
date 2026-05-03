## Why

The current `getChanges()` function returns only the changes array, losing the `newStartPageToken` that should be saved for the next sync cycle. This causes the sync token to not be updated properly, leading to potential duplicate syncs or missed changes. Refactoring the return value to include both the changes and the token ensures proper state management across sync operations.

## What Changes

- `helpers/drive.ts`: Modify `getChanges()` to return an object `{changes, newStartPageToken}` instead of just the changes array
- `helpers/pull.ts`: Update the pull logic to destructure and save the `newStartPageToken` after fetching changes
- Fix edge case where `getChanges()` early returns with incorrect structure
- Add missing `await` on `t.endSync()` call for proper async handling

## Capabilities

### New Capabilities
- `change-token-tracking`: Properly track and persist the Google Drive changes page token to avoid duplicate syncs

### Modified Capabilities
- `google-drive-sync`: Changed the return signature of `getChanges()` to include token information alongside changes

## Impact

- **Modified Files**: `helpers/drive.ts`, `helpers/pull.ts`
- **APIs Changed**: `getChanges()` return type
- **Affected Systems**: Google Drive synchronization and change tracking
- **Sync Behavior**: Ensures proper token persistence across sync cycles
