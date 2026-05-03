import * as fs from 'fs';
import ky from 'ky';

const data = JSON.parse(fs.readFileSync('./data.json', 'utf-8'));
const tokenData = fs.readFileSync('.test-oauth-token', 'utf-8').trim();

let rfToken: string, cId: string, cSecret: string;
try {
  const parsed = JSON.parse(tokenData);
  rfToken = parsed.refreshToken;
  cId = parsed.clientId;
  cSecret = parsed.clientSecret;
} catch {
  rfToken = tokenData;
  cId = data.clientId;
  cSecret = data.clientSecret;
}

async function getAccessToken() {
  const params = new URLSearchParams({
    refresh_token: rfToken,
    client_id: cId,
    grant_type: 'refresh_token',
    ...(cSecret && { client_secret: cSecret }),
  });
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!resp.ok) throw new Error(await resp.text());
  return (await resp.json()).access_token;
}

async function listChildren(drive: any, folderId: string, label: string) {
  console.log(`\n=== Children of ${label} (${folderId}) ===`);
  const children = await drive.get(
    `drive/v3/files?fields=files(id,name,mimeType,parents,properties,modifiedTime)&pageSize=100&q=%27${folderId}%27%20in%20parents%20and%20trashed%3Dfalse&orderBy=name%20desc`
  ).json<any>();
  console.log('Total:', children.files?.length || 0);
  const names = (children.files || []).map((f: any) => `${f.name} (${f.mimeType})`);
  console.log(JSON.stringify(names, null, 2));
  return children.files || [];
}

async function listRecursive(drive: any, folderId: string, depth = 0, allFiles: any[] = []) {
  const prefix = '  '.repeat(depth);
  const children = await drive.get(
    `drive/v3/files?fields=files(id,name,mimeType,parents,properties,modifiedTime)&pageSize=100&q=%27${folderId}%27%20in%20parents%20and%20trashed%3Dfalse&orderBy=name%20desc`
  ).json<any>();
  if (!children.files) return allFiles;
  
  console.log(`${prefix}Folder ${folderId}: ${children.files.length} items`);
  
  for (const file of children.files) {
    allFiles.push(file);
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      await listRecursive(drive, file.id, depth + 1, allFiles);
    }
  }
  return allFiles;
}

async function main() {
  const accessToken = await getAccessToken();
  const drive = ky.extend({
    prefixUrl: 'https://www.googleapis.com/',
    headers: { Authorization: 'Bearer ' + accessToken },
  });

  // Check all root folders
  const rootSearch = await drive.get(
    'drive/v3/files?fields=files(id,name,description,properties,parents)&pageSize=10&q=properties has { key="obsidian" and value="vault" }&trashed=false'
  ).json<any>();

  // Check the lekaha vault (likely has the actual data)
  const lekahaVault = rootSearch.files?.find((f: any) => f.name === 'lekaha');
  if (lekahaVault) {
    console.log('\n=== Scanning lekaha vault recursively ===');
    const allFiles = await listRecursive(drive, lekahaVault.id);
    console.log(`\nTotal files found: ${allFiles.length}`);
    
    const careerFiles = allFiles.filter((f: any) => f.name.toLowerCase().includes('career') || f.name.toLowerCase().includes('market'));
    console.log('\n=== Career/market-research items ===');
    console.log(JSON.stringify(careerFiles.map((f: any) => ({ name: f.name, id: f.id, parents: f.parents, mimeType: f.mimeType })), null, 2));
  }

  // Also check the "Obsidian" vault (might be the old one)
  const obsidianVault = rootSearch.files?.find((f: any) => f.name === 'Obsidian');
  if (obsidianVault) {
    await listChildren(drive, obsidianVault.id, 'Obsidian');
  }
}

main().catch(console.error);
