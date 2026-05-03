## MODIFIED Requirements

### Requirement: getChanges function signature

The `getChanges()` function in `helpers/drive.ts` SHALL have the following signature and behavior:
- **Input**: Optional start token string (from `settings.changesToken`)
- **Output**: Object with `{changes: Change[], newStartPageToken: string}` structure
- **Type**: All fields SHALL be properly typed in TypeScript
- **File metadata inclusion**: The change entries SHALL include `parents` field alongside existing `properties` to support manual file path resolution

#### Scenario: Standard getChanges call
- **WHEN** pull logic calls `getChanges(token)`
- **THEN** it returns typed object: `{changes: Array<{kind, removed, file, fileId, time}>, newStartPageToken: string}`

#### Scenario: getChanges with async/await
- **WHEN** async code awaits the `getChanges()` result
- **THEN** it returns a resolved Promise with the object structure

#### Scenario: Changes include parent information
- **WHEN** `getChanges()` returns changes with file metadata
- **THEN** the `file` object includes `parents` array for parent chain resolution of manually uploaded files

### Requirement: File discovery uses parent-based folder traversal
The pull operation SHALL discover files by recursively querying children of the vault root folder and its subfolders, using `'${rootFolderId}' in parents` queries instead of relying solely on `properties has { key='vault' }` filters.

#### Scenario: Files are discovered via parent traversal
- **WHEN** pull operation discovers files on Google Drive
- **THEN** it queries children of the vault root folder, then recursively queries children of each subfolder

#### Scenario: Manually uploaded files are included in discovery
- **WHEN** a user manually uploads a file to the vault folder in Google Drive (without plugin-generated properties)
- **THEN** the file is discovered during pull because it exists within the vault folder hierarchy

### Requirement: Path resolution from parent chain
When a file does not have a `properties.path` value, the system SHALL resolve its local path by walking up the Google Drive `parents` chain from the file to the vault root folder, building the relative path from folder names along the chain.

#### Scenario: Path resolved from parent chain for manual upload
- **WHEN** a manually uploaded file is discovered during pull
- **THEN** its path is resolved by walking up the `parents` array until reaching the vault root folder ID, and folder names are joined to form the relative path

#### Scenario: Path resolution with cycle detection
- **WHEN** walking up the parent chain
- **THEN** the system detects circular parent references and aborts path resolution for that file

#### Scenario: Existing plugin-uploaded files prefer properties.path
- **WHEN** a file has both `properties.path` and a valid parent chain
- **THEN** `properties.path` is used as the authoritative path to maintain consistency with existing behavior

### Requirement: Files outside vault folder hierarchy are excluded
The pull operation SHALL exclude any file whose parent chain does not trace back to the vault root folder, even if the file has the vault property tag.

#### Scenario: Orphaned file is ignored
- **WHEN** a file's parent chain does not reach the vault root folder ID
- **THEN** the file is silently excluded from pull operations

### Requirement: Changes API filters by vault root membership
The Google Drive changes API response SHALL be filtered to only include files whose current parent chain traces back to the vault root folder, preventing processing of changes from other Drive locations.

#### Scenario: Non-vault changes are filtered
- **WHEN** the changes API returns entries for files outside the vault folder
- **THEN** those entries are excluded from deletion and modification processing

### Requirement: Query construction in getQuery
The `getQuery` function in `helpers/drive.ts` SHALL NOT append the mandatory `properties has { key='vault' and value='...' }` clause to all queries. Instead, queries for file discovery SHALL use parent-based filtering, while push-related queries may continue using property-based filtering.

#### Scenario: Pull query uses parent filter
- **WHEN** pull operations construct a search query
- **THEN** the query uses `'${rootFolderId}' in parents` instead of the vault property filter

#### Scenario: Push query retains property filter
- **WHEN** push operations construct queries for config files
- **THEN** the query may still use property-based filtering as before
