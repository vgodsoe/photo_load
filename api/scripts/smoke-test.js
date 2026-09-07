const fs = require("node:fs");
const path = require("node:path");

const settings = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "local.settings.json"), "utf8")).Values;
const apiBaseUrl = process.env.API_BASE_URL || "https://wedding-photo-upload-ghgjhthrduhnasck.northeurope-01.azurewebsites.net";
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const headers = { "Content-Type": "application/json", "X-Event-Token": settings.EVENT_TOKEN, Origin: "https://vgodsoe.github.io" };

async function jsonRequest(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${url} returned ${response.status}`);
  return body;
}

async function graphToken() {
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: settings.MICROSOFT_CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: settings.MICROSOFT_REFRESH_TOKEN,
      scope: "https://graph.microsoft.com/Files.ReadWrite offline_access"
    })
  });
  if (!response.ok) throw new Error(`Microsoft authorization returned ${response.status}`);
  return (await response.json()).access_token;
}

async function findOneDriveFile(filename, token) {
  const encoded = encodeURIComponent(filename);
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/Wedding%20Uploads/${encoded}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`OneDrive lookup returned ${response.status}`);
  return response.json();
}

async function main() {
  const prepared = await jsonRequest(`${apiBaseUrl}/api/uploads`, {
    method: "POST",
    headers,
    body: JSON.stringify({ filename: "smoke-test.jpg", contentType: "image/jpeg", size: bytes.length, guestName: "smoketest" })
  });
  const blockId = Buffer.from("00000000").toString("base64");
  const separator = prepared.uploadUrl.includes("?") ? "&" : "?";
  let response = await fetch(`${prepared.uploadUrl}${separator}comp=block&blockid=${encodeURIComponent(blockId)}`, {
    method: "PUT",
    headers: { "x-ms-version": "2023-11-03", "Content-Type": "application/octet-stream" },
    body: bytes
  });
  if (!response.ok) throw new Error(`Blob block upload returned ${response.status}`);

  const blockList = `<?xml version="1.0" encoding="utf-8"?><BlockList><Latest>${blockId}</Latest></BlockList>`;
  response = await fetch(`${prepared.uploadUrl}${separator}comp=blocklist`, {
    method: "PUT",
    headers: { "x-ms-version": "2023-11-03", "x-ms-blob-content-type": "image/jpeg", "Content-Type": "application/xml" },
    body: blockList
  });
  if (!response.ok) throw new Error(`Blob commit returned ${response.status}`);

  await jsonRequest(`${apiBaseUrl}/api/uploads/complete`, {
    method: "POST",
    headers,
    body: JSON.stringify({ blobName: prepared.blobName })
  });

  const filename = prepared.blobName.split("/").pop();
  const token = await graphToken();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const file = await findOneDriveFile(filename, token);
    if (file) {
      if (file.size !== bytes.length) throw new Error(`OneDrive file has ${file.size} bytes; expected ${bytes.length}`);
      console.log(`PASS: ${filename} reached OneDrive with ${file.size} bytes`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error("Timed out waiting for OneDrive delivery");
}

main().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});