## 1. Refactor getChanges Return Type

- [x] 1.1 Update `getChanges()` function signature to return `{changes: Change[], newStartPageToken: string}` instead of bare array
- [x] 1.2 Fix early return case where no start token exists - return `{changes: [], newStartPageToken: ""}` 
- [x] 1.3 Update pagination loop to capture `newStartPageToken` from final page response
- [x] 1.4 Update TypeScript types to reflect new return structure
- [x] 1.5 Verify all internal calls within `getChanges()` work with new structure

## 2. Update Pull Logic

- [x] 2.1 Update `pull()` function to destructure `{changes, newStartPageToken}` from `getChanges()` result
- [x] 2.2 Add code to immediately save `newStartPageToken` to `settings.changesToken` after `getChanges()` returns
- [x] 2.3 Ensure token is saved before change processing begins
- [x] 2.4 Add `await` keyword to `t.endSync()` call for proper async handling

## 3. Testing & Verification

- [x] 3.1 Verify TypeScript compilation passes with no errors
- [x] 3.2 Check that all call sites of `getChanges()` are updated
- [x] 3.3 Verify build produces no new type errors
- [x] 3.4 Test sync flow manually to ensure token is being persisted
