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
- **Vault Identity:** The vault name is used as a tag/identity in Google Drive (`{vault: vaultName}`). Multiple devices with the same vault name sync to the same folder.
- **Token Exchange Server:** The plugin uses `ky.ts` to communicate with `https://ogd.richardxiong.com/api/access` to convert Google refresh tokens into access tokens, keeping the OAuth client secret hidden from the client.
- **Conflict Resolution (`pull.ts`):** Local modifications or creations take priority over cloud modifications. Cloud deletions will override local modifications unless the file was locally created/modified in the current session.
- **Configuration Syncing:** Specific configuration files are whitelisted (e.g., `manifest.json`, `data.json`) or blacklisted (e.g., `workspace.json`, `graph.json`).

## 🚨 Linting & Code Style

- **TypeScript:** Strict type checking is enabled (`noImplicitAny: true`, `strictNullChecks: true`).
- **Formatting:** Use Tabs (size 4), LF line endings, UTF-8.
- **Linting Rules:** ESLint is permissive. It allows `@ts-ignore` comments, empty functions, and disables prototype builtin checks. Unused variables are caught by TypeScript, not ESLint.

## 💡 Important Constraints

- Do not attempt to run tests; there is no test suite configured in this repository.
- When modifying sync logic, be extremely careful about the order of operations and state preservation to avoid infinite sync loops or data loss.
