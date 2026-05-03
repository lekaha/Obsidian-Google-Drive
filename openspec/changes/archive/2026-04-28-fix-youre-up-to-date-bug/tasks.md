## 1. Fix Pull Sync Completion Race Condition

- [x] 1.1 Open helpers/pull.ts and locate line 72 where endSync(syncNotice) is called
- [x] 1.2 Add `await` keyword before `t.endSync(syncNotice)` to match push and reset patterns
- [x] 1.3 Verify TypeScript compilation with `npm run build`

## 2. Verify Consistency Across Sync Operations

- [x] 2.1 Check helpers/push.ts line 486 confirms `await t.endSync(syncNotice, false)`
- [x] 2.2 Check helpers/reset.ts line 170 confirms `await t.endSync(syncNotice)`
- [x] 2.3 Confirm all three operations follow identical async pattern

## 3. Test the Fix

- [x] 3.1 Start dev mode with `npm run dev`
- [x] 3.2 Manually trigger pull sync when no remote changes exist
- [x] 3.3 Verify sync notice hides before "You're up to date!" message appears
- [x] 3.4 Verify ribbon sync icon stops spinning before completion message shows

## 4. Final Verification

- [x] 4.1 Run full build: `npm run build`
- [x] 4.2 Verify no TypeScript errors or warnings
- [x] 4.3 Verify no ESLint issues
