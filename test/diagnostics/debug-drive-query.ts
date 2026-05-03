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

async function main() {
  const accessToken = await getAccessToken();
  const drive = ky.extend({
    prefixUrl: 'https://www.googleapis.com/',
    headers: { Authorization: 'Bearer ' + accessToken },
  });

  // Step 1: Find root folder
  console.log('=== Root folder search ===');
  const rootSearch = await drive.get(
    'drive/v3/files?fields=files(id,name,description,properties,parents)&pageSize=10&q=properties has { key="obsidian" and value="vault" }&trashed=false'
  ).json<any>();
  console.log(JSON.stringify(rootSearch, null, 2));

  if (rootSearch.files?.length > 0) {
    const rootId = rootSearch.files[0].id;
    console.log('\n=== Direct children of root folder ===');
    const children = await drive.get(
      `drive/v3/files?fields=files(id,name,mimeType,parents,properties,modifiedTime)&pageSize=100&q=%27${rootId}%27%20in%20parents%20and%20trashed%3Dfalse&orderBy=name%20desc`
    ).json<any>();
    console.log(JSON.stringify(children, null, 2));
    console.log('\nTotal children:', children.files?.length || 0);
    
    // Check for career or market-research specifically
    if (children.files) {
      const found = children.files.filter(f => f.name === 'career' || f.name === 'market-research' || f.name.toLowerCase().includes('career') || f.name.toLowerCase().includes('market'));
      console.log('\n=== Career/market-research items ===');
      console.log(JSON.stringify(found, null, 2));
    }
    
    // Check nested folders - check atom specifically
    const atomFolder = children.files?.find(f => f.name === 'atom' && f.mimeType === 'application/vnd.google-apps.folder');
    if (atomFolder) {
      console.log('\n=== Children of atom folder ===');
      const atomChildren = await drive.get(
        `drive/v3/files?fields=files(id,name,mimeType,parents,properties,modifiedTime)&pageSize=100&q=%27${atomFolder.id}%27%20in%20parents%20and%20trashed%3Dfalse&orderBy=name%20desc`
      ).json<any>();
      console.log(JSON.stringify(atomChildren, null, 2));
      
      // Check for career inside atom
      const careerInsideAtom = atomChildren.files?.find(f => f.name === 'career');
      if (careerInsideAtom) {
        console.log('\n=== Career folder inside atom ===');
        console.log(JSON.stringify(careerInsideAtom, null, 2));
      }
    }
  }
}

main().catch(console.error);
