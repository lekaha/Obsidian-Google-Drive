## Context

The pull sync operation handles the case where no files have been modified or deleted remotely. Currently, it calls `t.endSync(syncNotice)` without awaiting, immediately displaying "You're up to date!" while sync state cleanup runs asynchronously. Other sync operations (push, reset) correctly use `await t.endSync()` ensuring state is fully cleaned before showing completion messages. This creates inconsistent behavior and potential race conditions.

## Goals / Non-Goals

**Goals:**
- Fix the missing `await` on `t.endSync()` call in pull.ts line 72
- Ensure sync state cleanup completes before showing "You're up to date!" notice
- Maintain consistency with push and reset operations
- Prevent UI race conditions where notices/spinners remain visible briefly after sync completion

**Non-Goals:**
- Change the "You're up to date!" message text or timing
- Modify endSync() function behavior
- Alter sync operation flow beyond the completion sequence
- Add new user-facing features

## Decisions

**Decision 1: Add await to endSync() call**
- **Choice**: Add `await` before `t.endSync(syncNotice)` on line 72 of pull.ts
- **Rationale**: endSync() is async and handles critical state cleanup including saving settings, updating lastSyncedAt, and hiding the sync notice. Not awaiting creates a race condition. This matches the pattern used in push.ts (line 486) and reset.ts (line 170).
- **Alternatives considered**: 
  - Fire-and-forget endSync() - REJECTED: Causes race conditions and inconsistent UI state
  - Refactor endSync() to sync - REJECTED: Too invasive, other code correctly awaits it

**Decision 2: No additional error handling needed**
- **Choice**: Apply same error handling as existing push/reset operations
- **Rationale**: pull.ts already has try-catch wrapping the entire sync flow; endSync() errors will be caught by existing handlers
- **Alternatives considered**: 
  - Add separate error handler - REJECTED: Unnecessary; existing flow handles it

## Risks / Trade-offs

**Risk: None identified**
- This is a straightforward bug fix with no trade-offs
- Change is minimal (1 line) and follows established patterns
- No behavioral change except fixing the race condition
- Fully backward compatible

## Migration Plan

1. Apply the one-line fix to pull.ts
2. Run npm build to verify no TypeScript errors
3. Test pull sync with no remote changes to verify "You're up to date!" appears after sync notice disappears
4. No user migration needed - fix is transparent
