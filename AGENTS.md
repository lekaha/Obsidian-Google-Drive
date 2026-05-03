# OpenCode / AI Agent Instructions for Obsidian Google Drive Plugin

This file contains high-signal, repository-specific context to help agents work effectively in this codebase.

## 🛠️ Build & Development Workflow

- **Dev mode (Watch):** `npm run dev` (Runs `node esbuild.config.mjs` directly).
- **Production Build:** `npm run build` (Runs `tsc -noEmit -skipLibCheck` followed by `esbuild.config.mjs production`).
- **Releasing/Versioning:** `npm run version`. This script (`version-bump.mjs`) reads the `version` from `package.json` (via `npm_package_version`), updates `manifest.json`, adds a mapping to `versions.json`, and stages them via git. 

## 📐 Architecture & Sync Logic

The core philosophy is **Local Priority with Change Tracking**.

- **Operation Tracking (`main.ts`):** Local file state is tracked in `settings.operations` as `{path: "create" | "delete" | "modify"}`. 
- **State Preservation:** When the plugin programmatic modifies the vault (e.g., during a sync pull), it explicitly saves and restores the old operation state to prevent the vault's event handlers from incorrectly flagging the sync changes as new local user changes.
- **Vault Identity:** The vault name is used as a tag/identity in Google Drive (`{obsidian: "vault"}` and `{vault: vaultName}`). Multiple devices with the same vault name sync to the same folder.
- **Authentication (BYOK/PKCE):** New users authenticate directly with Google's OAuth 2.0 servers using PKCE (`helpers/oauth.ts`). A local loopback server on port 18412 receives the authorization code, which is exchanged for tokens at `https://oauth2.googleapis.com/token`. No third-party server is involved.
- **Authentication (Legacy):** The legacy method via `https://example-oauth.com/api/access` is still supported for existing users but is deprecated. New users should use BYOK.
- **Hybrid Path Resolution:** File paths are resolved via `helpers/drive.ts` using a hybrid approach: files with a `properties.path` field use that directly; otherwise, paths are reconstructed by traversing parent folder IDs back to the root (`resolvePathFromParents`). This supports files created outside the plugin (e.g., iOS app, manual Drive edits) that lack stored path properties.
- **Conflict Resolution (`pull.ts`):** Local modifications or creations take priority over cloud modifications. Cloud deletions will override local modifications unless the file was locally created/modified in the current session.
- **Configuration Syncing:** Specific configuration files are whitelisted (e.g., `manifest.json`, `data.json`) or blacklisted (e.g., `workspace.json`, `graph.json`).

## 🚨 Linting & Code Style

- **TypeScript:** Strict type checking is enabled (`noImplicitAny: true`, `strictNullChecks: true`).
- **Formatting:** Use Tabs (size 4), LF line endings, UTF-8.
- **Linting Rules:** ESLint is permissive. It allows `@ts-ignore` comments, empty functions, and disables prototype builtin checks. Unused variables are caught by TypeScript, not ESLint.

## 💡 Important Constraints

- **Testing Infrastructure:** The `test/` directory contains standalone testing and diagnostics tools that can be run independently of Obsidian via `npx tsx`.
  - `test/integration/test-oauth.ts` - Tests the new PKCE authentication flow directly against Google's OAuth 2.0 servers (also runnable via `npm run test-oauth`)
  - `test/integration/test-pull-standalone.ts` - Standalone testing of the pull/sync logic
  - `test/diagnostics/` - Debugging scripts for diagnosing drive sync issues (e.g., missing files, query validation)
  - These tools use `getDriveKy(t)` from `helpers/ky.ts` to interact with the Drive API independently.
- **Sync Logic Safety:** When modifying sync logic, be extremely careful about the order of operations and state preservation to avoid infinite sync loops or data loss.
