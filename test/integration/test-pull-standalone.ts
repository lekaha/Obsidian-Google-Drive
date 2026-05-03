import ky from "ky";
import * as fs from "fs";

interface FileMetadata {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  properties?: Record<string, string>;
  modifiedTime: string;
}

interface FolderInfo {
  name: string;
  parents: string[];
}

const folderMimeType = "application/vnd.google-apps.folder";

async function searchFilesRecursive(
  folderId: string,
  folderIdToInfo: Map<string, FolderInfo>,
  drive: any,
  filesAccumulator: FileMetadata[] = [],
  depth = 0
): Promise<FileMetadata[]> {
  const children = await drive.get(
    `drive/v3/files?fields=nextPageToken,files(id,name,mimeType,parents,properties,modifiedTime)&pageSize=1000&q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&orderBy=name desc&includeItemsFromAllDrives=true&supportsAllDrives=true`
  ).json<any>();

  const indent = "  ".repeat(depth);
  if (!children) {
    console.log(`[Drive API] ${indent}Searched folder ${folderId}, found 0 items`);
    return filesAccumulator;
  }
  console.log(`[Drive API] ${indent}Searched folder ${folderId}, found ${children.files?.length || 0} items`);

  let allChildren = children.files as FileMetadata[];
  let nextPageToken = children.nextPageToken;

  while (nextPageToken) {
    const nextPage = await drive.get(
      `drive/v3/files?fields=nextPageToken,files(id,name,mimeType,parents,properties,modifiedTime)&pageSize=1000&q=${encodeURIComponent(`'${folderId}' in parents and trashed=false`)}&orderBy=name desc&pageToken=${nextPageToken}&includeItemsFromAllDrives=true&supportsAllDrives=true`
    ).json<any>();
    if (!nextPage) break;
    allChildren.push(...nextPage.files);
    nextPageToken = nextPage.nextPageToken;
  }

  filesAccumulator.push(...allChildren);

  for (const f of allChildren) {
    if (f.mimeType === folderMimeType && f.parents) {
      folderIdToInfo.set(f.id, {
        name: f.name,
        parents: f.parents
      });
    }
  }

  const subfolders = allChildren.filter((f: any) => f.mimeType === folderMimeType);
  for (const subfolder of subfolders) {
    if (!folderIdToInfo.has(subfolder.id)) {
      folderIdToInfo.set(subfolder.id, {
        name: subfolder.name,
        parents: subfolder.parents || []
      });
    }
    await searchFilesRecursive(subfolder.id, folderIdToInfo, drive, filesAccumulator, depth + 1);
  }

  return filesAccumulator;
}

async function refreshAccessTokenViaPkce(
  refreshToken: string,
  clientId: string,
  clientSecret?: string
): Promise<string> {
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    grant_type: "refresh_token",
    ...(clientSecret && { client_secret: clientSecret }),
  });

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const data = await response.json() as any;
  return data.access_token;
}

function resolvePathFromParents(
  file: FileMetadata,
  rootFolderId: string,
  folderIdToInfo: Map<string, FolderInfo>
): string | null {
  if (file.properties?.path) {
    return file.properties.path;
  }

  if (!file.parents || file.parents.length === 0) {
    return null;
  }

  const pathSegments: string[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = file.parents[0];
  let hops = 0;
  const maxHops = 50;

  pathSegments.unshift(file.name);

  while (currentId && hops < maxHops) {
    console.log(`[DEBUG PATH] currentId: ${currentId}, segments: ${pathSegments.join('/')}`);
    if (currentId === rootFolderId) {
      return pathSegments.join("/");
    }

    if (visited.has(currentId)) {
      return null;
    }
    visited.add(currentId);

    const folderInfo = folderIdToInfo.get(currentId);
    if (!folderInfo) {
      console.log(`[DEBUG PATH] No info for ${currentId}`);
      return null;
    }

    pathSegments.unshift(folderInfo.name);

    if (!folderInfo.parents || folderInfo.parents.length === 0) {
      console.log(`[DEBUG PATH] No parents for ${currentId}`);
      break;
    }
    currentId = folderInfo.parents[0];
    hops++;
  }

  return pathSegments.join("/");
}

function foldersToBatches(paths: string[]): string[][] {
  if (paths.length === 0) return [];
  
  const maxDepth = Math.max(...paths.map(p => p.split("/").length));
  const batches: string[][] = [];
  for (let i = 0; i < maxDepth; i++) {
    batches.push([]);
  }

  paths.forEach(p => {
    const depth = p.split("/").length;
    batches[depth - 1].push(p);
  });

  return batches;
}

function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

async function getRootFolderId(drive: any): Promise<string | undefined> {
  const files = await drive.get(
    `drive/v3/files?fields=files(id)&pageSize=1&q=properties has { key='obsidian' and value='vault' } and properties has { key='vault' and value='lekaha' }&includeItemsFromAllDrives=true&supportsAllDrives=true`
  ).json<any>();
  
  if (!files) return;
  if (!files.files?.length) {
    console.log("No root folder found, creating one...");
  }
  return files.files[0]?.id;
}

async function main() {
  const dataFile = "./data.json";
  const tokenFile = ".test-oauth-token";

  if (!fs.existsSync(dataFile)) {
    console.error(`Data file ${dataFile} not found.`);
    process.exit(1);
  }

  const settings = JSON.parse(fs.readFileSync(dataFile, "utf-8"));
  
  if (fs.existsSync(tokenFile)) {
    const tokenContent = fs.readFileSync(tokenFile, "utf-8").trim();
    if (tokenContent) {
      try {
        const tokenJson = JSON.parse(tokenContent);
        if (tokenJson.refreshToken) settings.refreshToken = tokenJson.refreshToken;
        if (tokenJson.clientId) settings.clientId = tokenJson.clientId;
        if (tokenJson.clientSecret) settings.clientSecret = tokenJson.clientSecret;
        console.log(`Using credentials from ${tokenFile}`);
      } catch {
        settings.refreshToken = tokenContent;
      }
    }
  }

  let accessToken: string | undefined;
  if (settings.refreshToken && settings.clientId) {
    try {
      console.log("Refreshing access token via PKCE...");
      accessToken = await refreshAccessTokenViaPkce(
        settings.refreshToken,
        settings.clientId,
        settings.clientSecret
      );
      console.log("✓ Access token obtained\n");
    } catch (e: any) {
      console.error(`✗ Failed: ${e.message}`);
      process.exit(1);
    }
  }

  if (!accessToken) {
    console.error("No access token available.");
    process.exit(1);
  }

  const drive = ky.extend({
    prefixUrl: "https://www.googleapis.com",
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 120_000,
    hooks: {
      afterResponse: [
        async (_request: any, _options: any, response: Response) => {
          if (!response.ok) {
            console.error(`[HTTP Error] ${response.status}: ${await response.text()}`);
            return new Response();
          }
          return response;
        },
      ],
    },
  });

  console.log("Starting pull simulation...\n");

  const rootFolderId = await getRootFolderId(drive);
  if (!rootFolderId) {
    console.error("Could not find root folder");
    process.exit(1);
  }
  console.log(`Root folder ID: ${rootFolderId}\n`);

  const folderIdToInfo = new Map<string, FolderInfo>();
  const allDriveFiles = await searchFilesRecursive(rootFolderId, folderIdToInfo, drive);

  console.log(`\nTotal files/folders found: ${allDriveFiles.length}`);
  console.log(`Folder ID to Info map size: ${folderIdToInfo.size}\n`);

  // Check for career and market-research
  const career = allDriveFiles.find(f => f.name === "career");
  const marketResearch = allDriveFiles.find(f => f.name === "market-research");
  
  console.log("=== career folder ===");
  if (career) {
    console.log(`  Found! ID: ${career.id}`);
    console.log(`  mimeType: ${career.mimeType}`);
    console.log(`  parents: ${JSON.stringify(career.parents)}`);
    console.log(`  properties: ${JSON.stringify(career.properties)}`);
    console.log(`  modifiedTime: ${career.modifiedTime}`);
    
    // Try to resolve path
    const resolvedPath = resolvePathFromParents(career, rootFolderId, folderIdToInfo);
    console.log(`  RESOLVED PATH: ${resolvedPath || 'NULL'}`);
  } else {
    console.log("  NOT FOUND in allDriveFiles!");
  }
  
  console.log("\n=== market-research folder ===");
  if (marketResearch) {
    console.log(`  Found! ID: ${marketResearch.id}`);
    console.log(`  mimeType: ${marketResearch.mimeType}`);
    console.log(`  parents: ${JSON.stringify(marketResearch.parents)}`);
    console.log(`  properties: ${JSON.stringify(marketResearch.properties)}`);
    console.log(`  modifiedTime: ${marketResearch.modifiedTime}`);
    
    const resolvedPath = resolvePathFromParents(marketResearch, rootFolderId, folderIdToInfo);
    console.log(`  RESOLVED PATH: ${resolvedPath || 'NULL'}`);
  } else {
    console.log("  NOT FOUND in allDriveFiles!");
  }

  // Simulate the pull filter logic
  const recentlyModified = allDriveFiles.filter((f) => {
    const notInMapping = !(f.id in settings.driveIdToPath);
    const modifiedAfterSync = new Date(f.modifiedTime).getTime() > settings.lastSyncedAt;
    
    if (notInMapping || modifiedAfterSync) {
      return true;
    }
    
    return false; // vault doesn't exist so this is always true
  });

  console.log(`\n=== recentlyModified ===`);
  console.log(`Total: ${recentlyModified.length} / ${allDriveFiles.length}`);
  
  // Check if career and market-research are in recentlyModified
  const careerInRecent = recentlyModified.find(f => f.name === "career");
  const marketInRecent = recentlyModified.find(f => f.name === "market-research");
  console.log(`career in recentlyModified: ${!!careerInRecent}`);
  console.log(`market-research in recentlyModified: ${!!marketInRecent}`);

  // Filter for folders only
  const newFolders = recentlyModified.filter(({ mimeType }) => mimeType === folderMimeType);
  console.log(`\nNew folders (mimeType === folder): ${newFolders.length}`);

  // Resolve paths and create batches
  const resolvedPaths = newFolders
    .map((f) => resolvePathFromParents(f, rootFolderId, folderIdToInfo))
    .filter((p): p is string => p !== null);

  console.log(`Resolved folder paths: ${resolvedPaths.length}`);
  
  // Check specifically for career and market-research paths
  const careerPath = resolvePathFromParents(career!, rootFolderId, folderIdToInfo);
  const marketPath = resolvePathFromParents(marketResearch!, rootFolderId, folderIdToInfo);
  console.log(`career path in resolvedPaths: ${resolvedPaths.includes(careerPath!)}`);
  console.log(`market-research path in resolvedPaths: ${resolvedPaths.includes(marketPath!)}`);

  const batches = foldersToBatches(resolvedPaths);
  console.log(`\n=== Batches (${batches.length} total) ===`);
  batches.forEach((batch, i) => {
    console.log(`  Batch ${i} (depth ${i + 1}): ${batch.join(", ")}`);
  });

  // Check if career and market-research would be created
  const careerInBatches = batches.flat().includes(careerPath!);
  const marketInBatches = batches.flat().includes(marketPath!);
  console.log(`\n=== Final Results ===`);
  console.log(`career would be created: ${careerInBatches} (${careerPath || 'path=null'})`);
  console.log(`market-research would be created: ${marketInBatches} (${marketPath || 'path=null'})`);
}

main().catch(console.error);
