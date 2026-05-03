## Why

The "You're up to date!" notice in the pull sync operation has a race condition. When no files need syncing, the `endSync()` async function is called without awaiting it, causing the UI notice to display immediately while sync state cleanup runs asynchronously. This creates inconsistent behavior where the sync notice may still be visible or the spinner still active when the completion message is shown. The fix ensures sync state is fully cleaned up before showing the completion notice, matching the behavior of push and reset operations.

## What Changes

- **Fixed sync completion flow in pull.ts**: Add `await` to `endSync()` call before showing "You're up to date!" notice to ensure proper state cleanup
- **Consistency across sync operations**: Pull operation now follows the same `await t.endSync()` pattern as push and reset operations
- **UI behavior improvement**: Sync notice properly hides and ribbon icon stops spinning before "You're up to date!" message appears

## Capabilities

### New Capabilities

- `await-sync-completion`: Ensure all sync operations properly await state cleanup before displaying completion notices, preventing race conditions

### Modified Capabilities

- `pull-sync`: Modify pull sync completion flow to await endSync() and maintain consistent behavior with other sync operations

## Impact

- **Affected files**: `helpers/pull.ts` (line 72)
- **Affected code paths**: Pull sync operation when no remote changes detected
- **Related files for consistency check**: `helpers/push.ts` (line 486), `helpers/reset.ts` (line 170)
- **No breaking changes**: This is a bug fix that corrects async behavior, not an API change
- **No new dependencies**: Uses existing endSync() method properly
