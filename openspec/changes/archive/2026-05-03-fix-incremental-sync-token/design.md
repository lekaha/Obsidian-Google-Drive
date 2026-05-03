## Context

The plugin uses Google Drive's change tracking API with pagination tokens to enable incremental syncing. On first initialization, `getChangesStartToken()` retrieves a starting token. Subsequent syncs call `getChanges(startToken)` which internally handles paginated results and returns both the changes array AND the `newStartPageToken`.

**Current state:**
- `getChanges()` correctly computes `newStartPageToken` from paginated responses (line 407 and 413 in drive.ts)
- `pull.ts` correctly receives and persists `newStartPageToken` (lines 47-52 in pull.ts)
- However, on the initial sync in main.ts, `getChangesStartToken()` is called but the token is never stored in `settings.changesToken`, leaving it empty

**Root cause:** On application startup (main.ts ~line 293), the initial sync token is fetched but not persisted to settings, causing subsequent syncs to get an empty `changesToken` and fall back to fetching the full change history.

## Goals / Non-Goals

**Goals:**
- Persist the initial sync token from `getChangesStartToken()` to `settings.changesToken` on first startup
- Ensure subsequent syncs use the cached token to retrieve only delta changes
- Avoid re-fetching entire change history on every app restart

**Non-Goals:**
- Changing the Google Drive API integration
- Modifying the paginated changes fetching logic
- Adding manual token reset/refresh UI (only automatic token persistence)

## Decisions

**Decision 1: Store initial token in settings during first onload**
- After calling `getChangesStartToken()` in main.ts, immediately save the result to `t.settings.changesToken` and call `t.saveSettings()`
- Rationale: The token only needs to be set once on initialization; subsequent syncs will update it via pull.ts

**Decision 2: Initialize changesToken with empty string fallback**
- In `getChanges()`, handle empty string gracefully by returning early with empty changes (already implemented, line 391 in drive.ts)
- Rationale: Prevents errors if token is missing; allows first sync to be treated as full fetch

**Decision 3: Retrieve and use startPageToken immediately after setup**
- On plugin initialization (onload), fetch the current page token and store it before any sync operations
- Rationale: Ensures the token is available for the first pull, making subsequent syncs incremental

## Risks / Trade-offs

**Risk:** Token invalidation over long inactivity
→ Mitigation: If API returns error for old token, fall back to `getChangesStartToken()` to get a fresh token

**Risk:** Multiple devices with same vault name
→ Mitigation: Not affected; each device maintains its own token in settings (tracked independently)

**Risk:** Settings corruption or loss
→ Mitigation: If token is missing, gracefully falls back to full sync (no data loss, just inefficient)

## Migration Plan

1. Update main.ts to store the initial token:
   - After calling `getChangesStartToken()`, assign result to `t.settings.changesToken`
   - Call `t.saveSettings()` to persist
   
2. Verify pull.ts already updates the token (it does at lines 49-52)

3. Test: 
   - First app launch should store a token
   - Restarting app should reuse that token
   - Changes API should return only delta changes after token 1 (not full history)

4. Rollout: No migration needed for existing installations; they'll fetch full history once, then use incremental thereafter
