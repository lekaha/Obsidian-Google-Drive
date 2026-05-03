## ADDED Requirements

### Requirement: Discover files by parent folder instead of custom vault property

The Google Drive file discovery query SHALL find files within the vault's root folder by using the parent folder ID (`'<rootFolderId>' in parents`) rather than requiring `properties has { key='vault' and value='<vault_name>' }` on each individual file. The root vault folder itself continues to be identified by `properties.obsidian === "vault"`.

#### Scenario: Pull finds plugin-uploaded files by parent folder
- **WHEN** the pull flow executes a Google Drive search query
- **THEN** files inside the vault's root folder are returned regardless of whether they have the `vault` custom property

#### Scenario: Pull does not find files outside the vault's root folder
- **WHEN** the pull flow executes a Google Drive search query
- **THEN** files outside the vault's root folder hierarchy are excluded from results

### Requirement: Resolve file path by walking parent chain

When pulling a file from Google Drive, if the file does not have `properties.path` set (manually uploaded file), the plugin SHALL resolve its local vault path by walking up the `parents` chain from the file to the vault's root folder ID, building the relative path from folder names encountered along the way.

#### Scenario: Manually uploaded file at root level
- **WHEN** a file is directly inside the root vault folder with no intermediate folders AND has no `properties.path`
- **THEN** its local vault path is resolved as `<file_name>`

#### Scenario: Manually uploaded file in nested folders
- **WHEN** a file is inside `Folder1/Folder2/` under the root vault folder AND has no `properties.path`
- **THEN** its local vault path is resolved as `Folder1/Folder2/<file_name>`

#### Scenario: Plugin-uploaded file uses fast path
- **WHEN** a file has `properties.path` set by the plugin
- **THEN** its local vault path is read directly from `properties.path` without parent chain walking

### Requirement: Build folder ID-to-name map for parent chain resolution

The plugin SHALL build an in-memory map of Drive folder IDs to `{name, parents[]}` by extracting folder metadata from the file listing results (which include `parents` in the response), enabling parent chain resolution without additional API calls.

#### Scenario: Folder map built from single listing call
- **WHEN** searchFiles returns files and folders with `parents` field included
- **THEN** a map is built from ID to `{name, parents[]}` for all folders, used for path resolution

#### Scenario: Orphaned file skipped gracefully
- **WHEN** a file's parent chain does not reach the root vault folder within 50 ancestor hops
- **THEN** the file is silently skipped and a warning is logged to the console

### Requirement: Cache resolved paths in driveIdToPath mapping

After resolving a file's path via parent chain walking, the plugin SHALL store the ID-to-path mapping in the `driveIdToPath` settings so that subsequent syncs use the cached path (or `properties.path` if the plugin subsequently updates the file).

#### Scenario: First sync resolves and caches manual file path
- **WHEN** a manually uploaded file is pulled for the first time
- **THEN** its Drive ID and resolved path are saved in `settings.driveIdToPath`

#### Scenario: Subsequent syncs use cached mapping
- **WHEN** a previously-resolved file is encountered on a subsequent sync
- **THEN** its path is read from `settings.driveIdToPath` without needing parent chain re-walking

### Requirement: Include parents field in Drive API listing calls

All `searchFiles` calls used in pull flows SHALL include `parents` in the `fields` parameter of the Drive API request, so that parent folder information is available for path resolution without additional per-file metadata calls.

#### Scenario: File listing includes parents for manual upload resolution
- **WHEN** `searchFiles` is called during pull
- **THEN** the response includes the `parents` field for each returned file/folder

#### Scenario: File listing includes parents for changelog processing
- **WHEN** `searchFiles` is called to fetch recently modified files
- **THEN** the response includes the `parents` field for path resolution of modified manual files
