## Context

The plugin currently uses Google Drive custom file properties (`properties has { key='vault' and value='<vault_name>' }`) as the sole criterion for identifying which files belong to the vault. File paths are stored in `properties.path` and resolved directly. This approach requires every file to have been uploaded by the plugin itself.

The vault root folder is identified by `properties.obsidian === 'vault'`. All sync operations (pull, push, reset) depend on the property-based filtering and the `driveIdToPath` mapping in plugin settings.

## Goals / Non-Goals

**Goals:**
- Allow files manually uploaded to the Google Drive vault folder to be pulled into Obsidian
- Resolve file paths using a **Hybrid Approach**:
  1. **Fast-path**: Use `properties.path` if it exists (for files uploaded by the plugin).
  2. **Fallback**: If `properties.path` is missing (manual uploads), resolve the path by traversing the `parents` chain up to the vault root folder.
  3. **Auto-Repair**: On subsequent push operations, the plugin will set `properties.path` on these files, upgrading them to fast-syncing files.
- Support the changes API for deletion tracking across both property-tagged and parent-matched files
- Maintain backward compatibility with existing plugin-uploaded files

**Non-Goals:**
- Do NOT change how push works — plugin will continue using property-based approach for uploads
- Do NOT support files outside the vault root folder hierarchy
- Do NOT add interactive conflict resolution for manually uploaded files

## Decisions

### 1. Use parent-based filtering instead of property-based filtering for queries

**Decision:** Replace the mandatory `properties has { key='vault' ... }` query clause with a `'${rootFolderId}' in parents` clause for file discovery during pull operations. The folder will support recursive descent by querying children of each subfolder.

**Rationale:** Parent-based queries don't require custom properties. Any file inside the vault folder hierarchy qualifies. The changes API also operates at the file level regardless of properties.

**Alternative considered:** Keep the property filter but add manual uploads with default properties. Rejected because we cannot retroactively add properties to files users upload manually from the Drive web UI.

### 2. Hybrid Path Resolution

**Decision:** Implement a two-tier path resolution strategy:
- **Priority**: Use `properties.path` if present. This avoids expensive API calls for files the plugin already knows about.
- **Fallback**: For files without `properties.path`, resolve the local path by walking up the `parents` chain until reaching the vault root folder ID.
- **Upgrade**: When these "untracked" files are later pushed, the plugin will write the missing `properties.path`, effectively "repairing" them for future fast-path resolution.

**Rationale:** This approach balances performance for existing files with support for manual uploads. The auto-repair mechanism ensures that the performance cost of parent-chain traversal is only paid once per manually added file.

**Implementation approach:**
- Add a new helper `resolvePathFromParents(fileId, rootFolderId)` that:
  1. Fetches file metadata (name, parents)
  2. Walks up the parent chain, collecting folder names
  3. Stops when reaching `rootFolderId`
  4. Reverses and joins to produce the relative path

### 3. Two-tier file discovery for pull

**Decision:** Use a combination of:
- **Recursive parent-based search**: Query children of root folder, then children of each subfolder to build the full file list with paths
- **Changes API**: Use existing changes API for deletion detection, but build path mapping from resolved paths instead of `properties.path`

**Rationale:** The parent query approach is efficient (one query per folder level). The changes API continues to work since it tracks file IDs regardless of how they were created.

### 4. Maintain `driveIdToPath` as the canonical mapping

**Decision:** The `driveIdToPath` map in settings continues as the ID-to-path lookup, but gets populated from resolved parent-chain paths rather than `properties.path` values.

**Rationale:** The mapping is used throughout pull/push/reset for deletion tracking and file lookups. Changing this would be a much larger refactor.

### 5. Push operations remain unchanged

**Decision:** Push continues to use `properties.path` for file discovery and property-based uploads. Newly pulled files will get properties when pushed.

**Rationale:** The plugin controls all push operations, so properties can be set. There's no need to change push behavior.

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Nested folder queries may hit API rate limits** | Query files with `include: ["id", "name", "parents", "mimeType", "modifiedTime"]` and batch requests. Use `parents` in query to get direct children only. |
| **Orphaned files (moved outside vault folder)** | Files whose parent chain doesn't reach the vault root are silently ignored during pull |
| **Performance impact on large vaults** | The Hybrid Approach limits traversal to manually uploaded files only. Once pushed, these files are upgraded to the fast-path using `properties.path`. |
| **Circular parent references** | Add cycle detection in path resolution (track visited parent IDs) |
| **Drive API changes response includes non-vault files** | Filter changes by verifying each file's parent chain reaches the vault root before processing deletions |
