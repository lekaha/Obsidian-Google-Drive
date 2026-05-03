# Change: Support Manual Drive Uploads

## Why

The current plugin restricts synced files to only those uploaded by the plugin itself, identified by a custom Google Drive property `{ key='vault', value='<vault_name>' }`. This is documented in the README warning: "Do NOT manually upload files into the generated Obsidian Google Drive folder."

Users want the ability to manually upload files to Google Drive (e.g., from mobile, web, or other devices) and have them automatically sync down to Obsidian. The current restriction prevents this workflow entirely.

## What Changes

- **File discovery mechanism**: Modify the Google Drive query to look at parent folder structure instead of relying on custom file properties. The plugin should scan the vault's root folder in Google Drive and pull all files within it recursively.
- **Path resolution**: When pulling files from Google Drive, resolve file paths by walking up the `parents` chain from each file to the vault's root folder, building the relative path dynamically instead of reading `file.properties.path`.
- **Removal of property requirement**: Files without the `vault` property tag should still be synced if they are within the correct folder hierarchy.
- **Plugin-uploaded files**: Files uploaded by the plugin can continue using the property-based approach for push operations, but pull operations should rely on folder structure.
- **README updates**: Update documentation to reflect that manual uploads to the Google Drive vault folder are now supported.
