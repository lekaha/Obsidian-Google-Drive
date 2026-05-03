import https from "https";
import url from "url";

const ATOM_FOLDER_ID = "1kqoFaEPNhUd-on1UeVjcd_hP-EcpypHA"; // From data.json
const PRIVATE_FOLDER_ID = "1kTmtAgpBsSkVN09qw2EnOe1PJw_LsuYS"; // From data.json

function makeRequest(urlStr: string, options: https.RequestOptions = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const req = https.request({
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "GET",
      headers: options.headers || {},
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function getAccessToken(clientId: string, refreshToken: string): Promise<string> {
  console.log("\n=== Step 1: Getting Access Token (Direct from Google) ===\n");
  
  const response = await makeRequest("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  }) as any;
  
  if (response.error) {
    throw new Error(`Token refresh failed: ${JSON.stringify(response)}`);
  }
  
  console.log("Access token obtained (first 20 chars):", response.access_token?.substring(0, 20) + "...");
  return response.access_token;
}

async function searchForSpecificFolders(token: string) {
  console.log("\n=== Step 2: Searching for 'career', 'market-research', 'atom' (Personal Drive) ===\n");
  const q = "name = 'career' or name = 'market-research' or name = 'atom'";
  const fields = "files(id,name,mimeType,parents,trashed,shared,ownedByMe,capabilities)";
  
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=100`;
  
  const response = await makeRequest(searchUrl, {
    headers: { "Authorization": `Bearer ${token}` },
  }) as any;
  
  console.log("Query:", q);
  console.log("Response:", JSON.stringify(response, null, 2));
  return response;
}

async function searchForSpecificFoldersWithSharedDrives(token: string) {
  console.log("\n=== Step 3: Searching with includeItemsFromAllDrives=true ===\n");
  const q = "name = 'career' or name = 'market-research' or name = 'atom'";
  const fields = "files(id,name,mimeType,parents,trashed,shared,ownedByMe,capabilities)";
  
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=user,drive`;
  
  const response = await makeRequest(searchUrl, {
    headers: { "Authorization": `Bearer ${token}` },
  }) as any;
  
  console.log("Query:", q);
  console.log("Additional params: includeItemsFromAllDrives=true, supportsAllDrives=true, corpora=user,drive");
  console.log("Response:", JSON.stringify(response, null, 2));
  return response;
}

async function getAtomFolderChildren(token: string) {
  console.log("\n=== Step 4: Getting children of 'atom' folder ===\n");
  const atomFolderId = ATOM_FOLDER_ID;
  const q = `'${atomFolderId}' in parents`;
  const fields = "files(id,name,mimeType,parents,trashed,shared,ownedByMe,capabilities)";
  
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=100`;
  
  const response = await makeRequest(searchUrl, {
    headers: { "Authorization": `Bearer ${token}` },
  }) as any;
  
  console.log("Query:", q);
  console.log("Response:", JSON.stringify(response, null, 2));
  return response;
}

async function getAtomFolderChildrenWithSharedDrives(token: string) {
  console.log("\n=== Step 5: Getting children of 'atom' folder with Shared Drive support ===\n");
  const atomFolderId = ATOM_FOLDER_ID;
  const q = `'${atomFolderId}' in parents`;
  const fields = "files(id,name,mimeType,parents,trashed,shared,ownedByMe,capabilities)";
  
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(fields)}&pageSize=100&includeItemsFromAllDrives=true&supportsAllDrives=true&corpora=user,drive`;
  
  const response = await makeRequest(searchUrl, {
    headers: { "Authorization": `Bearer ${token}` },
  }) as any;
  
  console.log("Query:", q);
  console.log("Additional params: includeItemsFromAllDrives=true, supportsAllDrives=true, corpora=user,drive");
  console.log("Response:", JSON.stringify(response, null, 2));
  return response;
}

async function analyzeRootFolder(token: string) {
  console.log("\n=== Step 6: Getting 'private' folder details ===\n");
  const privateFolderId = PRIVATE_FOLDER_ID;
  
  const searchUrl = `https://www.googleapis.com/drive/v3/files/${privateFolderId}?fields=id,name,mimeType,parents,trashed,shared,ownedByMe,capabilities`;
  
  const response = await makeRequest(searchUrl, {
    headers: { "Authorization": `Bearer ${token}` },
  }) as any;
  
  console.log(`Query: GET /drive/v3/files/${privateFolderId}`);
  console.log("Response:", JSON.stringify(response, null, 2));
  return response;
}

async function main() {
  const args = process.argv.slice(2);
  const clientIdArg = args.find(a => a.startsWith("--client-id="))?.split("=")[1];
  const refreshTokenArg = args.find(a => a.startsWith("--refresh-token="))?.split("=")[1];

  if (!clientIdArg || !refreshTokenArg) {
      console.error("Usage: node debug-missing-files.ts --client-id=YOUR_CLIENT_ID --refresh-token=YOUR_REFRESH_TOKEN");
      process.exit(1);
  }

  try {
    const token = await getAccessToken(clientIdArg, refreshTokenArg);
    
    console.log("\n========================================");
    console.log("Starting Google Drive Debug Investigation");
    console.log("========================================\n");
    
    await searchForSpecificFolders(token);
    await searchForSpecificFoldersWithSharedDrives(token);
    await getAtomFolderChildren(token);
    await getAtomFolderChildrenWithSharedDrives(token);
    await analyzeRootFolder(token);
    
    console.log("\n========================================");
    console.log("Investigation Complete");
    console.log("========================================\n");
    
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
