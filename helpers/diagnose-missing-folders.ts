/**
 * Diagnostic script for investigating missing folders in Google Drive.
 *
 * Usage:
 *   npx tsx helpers/diagnose-missing-folders.ts --access-token=YOUR_TOKEN
 *
 * Or with refresh token (BYOK):
 *   npx tsx helpers/diagnose-missing-folders.ts \
 *     --client-id=YOUR_CLIENT_ID \
 *     --refresh-token=YOUR_REFRESH_TOKEN
 *
 * This script will:
 *   1. Query the `atom` folder directly to see what children the API reports
 *   2. Query the `career` and `market-research` folder IDs directly for their metadata
 *   3. Check trashed status, mimeType, parents, and ownership
 *   4. Try a full-text search for the folder names
 *   5. Check if they might be shortcuts
 */

export {}; // Make this a module

const ATOM_FOLDER_ID = "1kqoFaEPNhUd-on1UeVjcd_hP-EcpypHA";
const CAREER_FOLDER_ID = "1rJ7jLN9R1PmgqSSOtIBGb4-06TA3ryDk";
const MARKET_RESEARCH_FOLDER_ID = "1FTHZXk0ogm_ureV1SIzPHcTee700wRLo";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut";

interface ParsedArgs {
  accessToken?: string;
  clientId?: string;
  refreshToken?: string;
  clientSecret?: string;
}

function parseArgs(): ParsedArgs {
  const args: ParsedArgs = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--access-token=")) {
      args.accessToken = arg.split("=")[1];
    } else if (arg.startsWith("--client-id=")) {
      args.clientId = arg.split("=")[1];
    } else if (arg.startsWith("--refresh-token=")) {
      args.refreshToken = arg.split("=")[1];
    } else if (arg.startsWith("--client-secret=")) {
      args.clientSecret = arg.split("=")[1];
    }
  }
  return args;
}

async function refreshAccessToken(
  clientId: string,
  refreshToken: string,
  clientSecret?: string
): Promise<string> {
  const params = new URLSearchParams({
    client_id: clientId,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    ...(clientSecret ? { client_secret: clientSecret } : {}),
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed (${response.status}): ${error}`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function driveGet(accessToken: string, path: string): Promise<any> {
  const url = `https://www.googleapis.com/${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Drive API error (${response.status}): ${errorBody}`);
  }

  return response.json();
}

function section(title: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"=".repeat(60)}`);
}

function printFile(name: string, value: any) {
  const valueStr = typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
  console.log(`  ${name}: ${valueStr}`);
}

async function main() {
  const args = parseArgs();

  let accessToken: string;
  if (args.accessToken) {
    accessToken = args.accessToken;
    console.log("Using provided access token...");
  } else if (args.refreshToken && args.clientId) {
    console.log("Refreshing access token from refresh token...");
    accessToken = await refreshAccessToken(
      args.clientId,
      args.refreshToken,
      args.clientSecret
    );
    console.log("Access token refreshed successfully.");
  } else {
    console.error(
      "Error: Either --access-token= or --client-id= and --refresh-token= are required."
    );
    process.exit(1);
  }

  // ============================================================
  // 1. Query atom folder children directly
  // ============================================================
  section("1. Querying atom folder children");
  console.log(`  Folder ID: ${ATOM_FOLDER_ID}`);

  const atomChildren = await driveGet(
    accessToken,
    `drive/v3/files?fields=nextPageToken,files(id,name,mimeType,parents,trashed,ownedByMe,shortcutDetails)&pageSize=1000&q=${encodeURIComponent(
      `'${ATOM_FOLDER_ID}' in parents and trashed=false`
    )}&includeItemsFromAllDrives=true&supportsAllDrives=true`
  );

  const atomChildrenFiles = atomChildren.files || [];
  console.log(`  Found ${atomChildrenFiles.length} children:`);
  for (const f of atomChildrenFiles) {
    console.log(
      `    - ${f.name} (ID: ${f.id}, MIME: ${f.mimeType}, ownedByMe: ${f.ownedByMe})`
    );
    if (f.shortcutDetails) {
      console.log(
        `      shortcutDetails: ${JSON.stringify(f.shortcutDetails)}`
      );
    }
  }

  // Also query INCLUDING trashed items
  const atomChildrenWithTrashed = await driveGet(
    accessToken,
    `drive/v3/files?fields=files(id,name,mimeType,parents,trashed,ownedByMe,shortcutDetails)&pageSize=1000&q=${encodeURIComponent(
      `'${ATOM_FOLDER_ID}' in parents`
    )}&includeItemsFromAllDrives=true&supportsAllDrives=true`
  );

  const trashedChildren = (atomChildrenWithTrashed.files || []).filter(
    (f: any) => f.trashed === true
  );
  if (trashedChildren.length > 0) {
    console.log(`\n  ⚠️ FOUND ${trashedChildren.length} TRASHED children:`);
    for (const f of trashedChildren) {
      console.log(
        `    - ${f.name} (ID: ${f.id}, MIME: ${f.mimeType}, ownedByMe: ${f.ownedByMe})`
      );
    }
  }

  // ============================================================
  // 2. Query career folder directly by ID
  // ============================================================
  section("2. Querying career folder directly by ID");
  console.log(`  Folder ID: ${CAREER_FOLDER_ID}`);

  try {
    const careerMeta = await driveGet(
      accessToken,
      `drive/v3/files/${CAREER_FOLDER_ID}?fields=id,name,mimeType,parents,trashed,ownedByMe,shortcutDetails,createdTime,modifiedTime&supportsAllDrives=true`
    );

    console.log("  Career folder metadata:");
    printFile("ID", careerMeta.id);
    printFile("Name", careerMeta.name);
    printFile("MimeType", careerMeta.mimeType);
    printFile("Trashed", careerMeta.trashed);
    printFile("OwnedByMe", careerMeta.ownedByMe);
    printFile("Parents", careerMeta.parents);
    printFile("CreatedTime", careerMeta.createdTime);
    printFile("ModifiedTime", careerMeta.modifiedTime);
    printFile("ShortcutDetails", careerMeta.shortcutDetails);

    // Critical analysis
    if (careerMeta.mimeType !== FOLDER_MIME_TYPE) {
      console.log(`\n  🚨 CRITICAL: mimeType is "${careerMeta.mimeType}" not "${FOLDER_MIME_TYPE}"!`);
      if (careerMeta.mimeType === SHORTCUT_MIME_TYPE) {
        console.log("  This is a SHORTCUT, not a real folder!");
        console.log("  searchFilesRecursive filters by mimeType and would NOT treat this as a subfolder.");
        console.log("  But it SHOULD still appear in the parent's children list...");
      }
    }

    if (careerMeta.parents && !careerMeta.parents.includes(ATOM_FOLDER_ID)) {
      console.log(`\n  🚨 CRITICAL: career folder's parents do NOT include the atom folder ID!`);
      console.log(`  Parents: ${JSON.stringify(careerMeta.parents)}`);
      console.log(`  Expected: ["${ATOM_FOLDER_ID}"]`);
      console.log(`  This explains why querying atom's children doesn't return career!`);
    } else if (careerMeta.parents && careerMeta.parents.includes(ATOM_FOLDER_ID)) {
      console.log(`\n  ✅ career folder DOES list atom as a parent.`);
      console.log(`  This is a Google Drive API BUG or caching issue!`);
    }

    if (careerMeta.trashed === true) {
      console.log(`\n  ⚠️ career folder is TRASHED!`);
    }
  } catch (e: any) {
    console.log(`  ❌ Error querying career folder: ${e.message}`);
    if (e.message?.includes("404") || e.message?.includes("notFound")) {
      console.log("  The folder does not exist or you don't have permission to access it.");
      console.log("  Possible causes:");
      console.log("    - The folder was permanently deleted");
      console.log("    - The folder is owned by a different Google account and sharing was revoked");
      console.log("    - The folder ID is incorrect");
    }
  }

  // ============================================================
  // 3. Query market-research folder if ID is known
  // ============================================================
  if (MARKET_RESEARCH_FOLDER_ID) {
    section("3. Querying market-research folder directly by ID");
    console.log(`  Folder ID: ${MARKET_RESEARCH_FOLDER_ID}`);

    try {
      const mrMeta = await driveGet(
        accessToken,
        `drive/v3/files/${MARKET_RESEARCH_FOLDER_ID}?fields=id,name,mimeType,parents,trashed,ownedByMe,shortcutDetails,createdTime,modifiedTime&supportsAllDrives=true`
      );

      console.log("  Market-research folder metadata:");
      printFile("ID", mrMeta.id);
      printFile("Name", mrMeta.name);
    printFile("MimeType", mrMeta.mimeType);
    printFile("Trashed", mrMeta.trashed);
    printFile("OwnedByMe", mrMeta.ownedByMe);
    printFile("Parents", mrMeta.parents);
      printFile("CreatedTime", mrMeta.createdTime);
      printFile("ModifiedTime", mrMeta.modifiedTime);
    } catch (e: any) {
      console.log(`  ❌ Error querying market-research folder: ${e.message}`);
    }
  }

  // ============================================================
  // 4. Full-text search for "career" and "market-research" folders
  // ============================================================
  section("4. Full-text search for 'career' folder (name search)");

  const careerSearch = await driveGet(
    accessToken,
    `drive/v3/files?fields=files(id,name,mimeType,parents,trashed,ownedByMe,shortcutDetails)&pageSize=10&q=${encodeURIComponent(
      `name='career' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`
    )}&includeItemsFromAllDrives=true&supportsAllDrives=true`
  );

  const careerResults = careerSearch.files || [];
  console.log(`  Found ${careerResults.length} folders named 'career':`);
  for (const f of careerResults) {
    console.log(`    - ID: ${f.id}, Parents: ${JSON.stringify(f.parents)}, ownedByMe: ${f.ownedByMe}`);
  }

  if (MARKET_RESEARCH_FOLDER_ID) {
    section("5. Full-text search for 'market-research' folder");

    const mrSearch = await driveGet(
      accessToken,
    `drive/v3/files?fields=files(id,name,mimeType,parents,trashed,ownedByMe,shortcutDetails)&pageSize=10&q=${encodeURIComponent(
      `name='market-research' and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`
    )}&includeItemsFromAllDrives=true&supportsAllDrives=true`
    );

    const mrResults = mrSearch.files || [];
    console.log(`  Found ${mrResults.length} folders named 'market-research':`);
    for (const f of mrResults) {
      console.log(`    - ID: ${f.id}, Parents: ${JSON.stringify(f.parents)}, ownedByMe: ${f.ownedByMe}`);
    }
  }

  // ============================================================
  // 6. Check for shortcuts with the target names
  // ============================================================
  section("6. Searching for shortcuts named 'career' or 'market-research'");

  const shortcutSearch = await driveGet(
    accessToken,
    `drive/v3/files?fields=files(id,name,mimeType,parents,trashed,ownedByMe,shortcutDetails)&pageSize=10&q=${encodeURIComponent(
      `(name='career' or name='market-research') and mimeType='${SHORTCUT_MIME_TYPE}'`
    )}&includeItemsFromAllDrives=true&supportsAllDrives=true`
  );

  const shortcutResults = shortcutSearch.files || [];
  console.log(`  Found ${shortcutResults.length} shortcuts:`);
  for (const f of shortcutResults) {
    console.log(
      `    - ${f.name} (ID: ${f.id}, Parents: ${JSON.stringify(f.parents)}, shortcutDetails: ${JSON.stringify(f.shortcutDetails)})`
    );
  }

  // ============================================================
  // 7. Summary and Diagnosis
  // ============================================================
  section("DIAGNOSIS SUMMARY");
  console.log("");
  console.log("If career's parents DON'T include atom:");
  console.log("  → The folder was moved/reparented on Drive. The web UI trick may not have");
  console.log("    persisted, OR the folder has multiple parents and one changed.");
  console.log("");
  console.log("If career's parents DO include atom but atom's children don't include career:");
  console.log("  → This is a Google Drive API caching bug. Drive eventually propagates.");
  console.log("    Workaround: Use name-based search instead of parent-based search.");
  console.log("");
  console.log("If career mimeType is 'application/vnd.google-apps.shortcut':");
  console.log("  → It's a shortcut. searchFilesRecursive filters by folderMimeType and");
  console.log("    skips it. But it SHOULD still appear in children (just not recursed).");
  console.log("");
  console.log("If career returns 404:");
  console.log("  → The folder doesn't exist or you lack permission.");
  console.log("    Check: Is it owned by a different Google account?");
  console.log("    Check: Was it permanently deleted?");
  console.log("");
  console.log("If career is trashed:");
  console.log("  → The trashed=false filter excludes it from parent queries.");
  console.log("    Check: Did some process auto-trash these folders?");
}

main().catch((err) => {
  console.error(`\n❌ Fatal error: ${err.message || err}`);
  process.exit(1);
});
