## 1. Update Drive Query Mechanism

- [x] 1.1 Modify `getQuery` in `drive.ts` to remove the global `properties has { key='vault' and value=... }` filter from the outer query, replacing it with a parent-folder-based filter that uses the root folder ID obtained via `getRootFolderId()`
- [x] 1.2 Update all `searchFiles` calls in pull flows to include `parents` in the `include`/`fields` parameter so parent folder information is returned
- [x] 1.3 Add TypeScript type for folder map entry: `{ name: string; parents: string[] }`

## 2. Implement Parent Chain Path Resolution

- [x] 2.1 Create `resolvePathFromParents(file: FileMetadata, rootFolderId: string, folderIdToInfo: Map<string, { name: string; parents: string[] }>): string | null` function in `drive.ts` that walks the parents chain from a file to the root folder and builds the relative path
- [x] 2.2 Handle the fast path: if `file.properties.path` exists, return it directly
- [x] 2.3 Handle the slow path: walk parents using the in-memory folder map, building path segments from folder names
- [x] 2.4 Add safety guard: abort with `null` after 50 parent hops (orphaned file detection)
- [x] 2.5 Return `null` if parent chain doesn't lead to `rootFolderId` (file outside vault)

## 3. Build Folder ID Map Utility

- [x] 3.1 Create `buildFolderIdToInfo(folderFiles: FileMetadata[]): Map<string, { name: string; parents: string[] }>` helper that extracts folder metadata from listing results
- [x] 3.2 Ensure the folder map is built from the same file listing response (no extra API calls)

## 4. Update Pull Flow

- [x] 4.1 In `pull.ts` `upsertFiles`, before processing each file, resolve its path: try `file.properties.path` first, then fall back to `resolvePathFromParents()`
- [x] 4.2 Update the path-to-ID mapping (`driveIdToPath`) to store resolved paths for manually uploaded files after first pull
- [x] 4.3 Update deletion handling in `pull.ts` to correctly identify deleted manual files using the resolved path from `driveIdToPath`
- [x] 4.4 Add console logging for files skipped due to missing parent chain to root folder

## 5. Update `idFromPath` and `idsFromPaths` in Drive Client

- [x] 5.1 Update `idFromPath` to handle lookups where the file may have been resolved via parent chain (use `driveIdToPath` reverse lookup as fallback)
- [x] 5.2 Update `idsFromPaths` similarly for batch path-to-ID lookups used in push flow

## 6. Update Specs

- [x] 6.1 Ensure spec files at `specs/manual-drive-uploads/spec.md` and `specs/google-drive-sync/spec.md` cover all scenarios listed in the specs artifact
- [x] 6.2 Verify all specs use correct format (`### Requirement:`, `#### Scenario:`, `WHEN`/`THEN`)

## 7. Manual Testing and Verification

- [x] 7.1 Build the plugin with `npm run build` and verify no TypeScript errors
- [x] 7.2 Test pull of a manually uploaded file placed at root of Drive vault folder
- [x] 7.3 Test pull of a manually uploaded file in nested folders within Drive vault folder
- [x] 7.4 Test that plugin-uploaded files continue to sync correctly (backward compatibility)
- [x] 7.5 Test that a file moved outside the vault folder in Drive is skipped during pull
- [x] 7.6 Verify `driveIdToPath` mapping is populated after first pull of manual files
