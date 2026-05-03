## ADDED Requirements

### Requirement: getChanges function signature
The `getChanges()` function in `helpers/drive.ts` SHALL have the following signature and behavior:
- **Input**: Optional start token string (from `settings.changesToken`)
- **Output**: Object with `{changes: Change[], newStartPageToken: string}` structure
- **Type**: All fields SHALL be properly typed in TypeScript

#### Scenario: Standard getChanges call
- **WHEN** pull logic calls `getChanges(token)`
- **THEN** it returns typed object: `{changes: Array<{kind, removed, file, fileId, time}>, newStartPageToken: string}`

#### Scenario: getChanges with async/await
- **WHEN** async code awaits the `getChanges()` result
- **THEN** it returns a resolved Promise with the object structure

### Requirement: Pull integrates token tracking
The `pull()` function in `helpers/pull.ts` SHALL:
1. Destructure the changes and token from `getChanges()` result
2. Immediately save the token to settings
3. Process changes only after token is persisted

#### Scenario: Pull saves token before processing
- **WHEN** `pull()` calls `getChanges()` and receives result
- **THEN** it destructures `{changes, newStartPageToken}` and saves token before filtering/processing changes

#### Scenario: Proper await on async operations
- **WHEN** `pull()` calls async functions like `t.endSync()`
- **THEN** it properly awaits completion before continuing
