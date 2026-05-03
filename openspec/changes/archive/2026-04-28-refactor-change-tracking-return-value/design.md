## Context

The plugin synchronizes Obsidian vaults with Google Drive by tracking file changes through the Drive API's `changes.list()` endpoint. This endpoint returns a `newStartPageToken` that must be saved to the plugin settings for the next sync cycle. Currently, the `getChanges()` function in `helpers/drive.ts` only returns the changes array, discarding the token. This causes the sync state to not advance properly, potentially leading to duplicate syncs or missed changes.

The affected code exists in:
- `helpers/drive.ts`: Contains the `getChanges()` function that fetches changes from Google Drive
- `helpers/pull.ts`: Contains the pull logic that calls `getChanges()` and manages the sync state
- Settings storage: The plugin saves the `changesToken` in `settings.changesToken`

## Goals / Non-Goals

**Goals:**
- Refactor `getChanges()` to return both the changes array and the `newStartPageToken` in a structured object
- Update `pull.ts` to properly extract and persist the `newStartPageToken` after each fetch
- Fix the early-return edge case where no token exists (should return proper structure)
- Ensure the sync token is saved to settings after each successful pull
- Add missing `await` on async `t.endSync()` call

**Non-Goals:**
- Changing the sync algorithm or conflict resolution logic
- Modifying the token validation or error handling strategy
- Refactoring other sync helper functions
- Altering the overall sync flow or UI

## Decisions

**Decision 1: Return structure for `getChanges()`**
- **Choice**: Return `{changes: [...], newStartPageToken: string}` object instead of bare array
- **Rationale**: This makes the token explicitly available to callers and prevents it from being lost. The object structure is clear and extensible if needed in future.
- **Alternative Considered**: Pass token as a separate return value or callback (more complex, less maintainable)

**Decision 2: When to save the token**
- **Choice**: Save `newStartPageToken` to settings immediately after `getChanges()` returns, before processing changes
- **Rationale**: This ensures the token is persisted even if change processing fails. Follows the principle of advancing the pointer first, then processing.
- **Alternative Considered**: Save after all changes are processed (risk of losing token if processing fails)

**Decision 3: Handling early returns**
- **Choice**: When no start token exists, return `{changes: [], newStartPageToken: ""}` to maintain consistent structure
- **Rationale**: Callers don't need to check for null; the structure is always consistent
- **Alternative Considered**: Return null or undefined (adds null-checking burden to callers)

## Risks / Trade-offs

**[Risk]** Type safety: Changing the return type from `Array` to `Object` could break existing callers
→ **Mitigation**: Update all call sites in `pull.ts` to use the new structure; TypeScript will catch any missed sites

**[Risk]** Edge cases: Early returns with empty token string
→ **Mitigation**: Add comments explaining the intentional empty string and test early-return scenarios

**[Trade-off]** Structure verbosity vs. clarity: The object structure is slightly more verbose than a simple array
→ **Justification**: The explicit structure makes intent clear and prevents future bugs where the token is accidentally lost
