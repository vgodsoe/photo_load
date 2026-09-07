const { app } = require("@azure/functions");
const { BlobServiceClient } = require("@azure/storage-blob");

const INCOMING_CONTAINER = "incoming";
const ONEDRIVE_CHUNK_SIZE = 10 * 1024 * 1024;

function encodePath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: process.env.MICROSOFT_REFRESH_TOKEN,
    scope: "https://graph.microsoft.com/Files.ReadWrite offline_access"
  });
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", { method: "POST", body });
  if (!response.ok) throw new Error(`Could not authorize OneDrive (${response.status})`);
  return (await response.json()).access_token;
}

async function createOneDriveSession(filename, token) {
  const folder = (process.env.ONEDRIVE_FOLDER_PATH || "Wedding Uploads").replace(/^\/+|\/+$/g, "");
  const path = encodePath(`${folder}/${filename}`);
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${path}:/createUploadSession`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}"
  });
  if (!response.ok) throw new Error(`Could not create OneDrive upload session (${response.status})`);
  return (await response.json()).uploadUrl;
}

async function uploadBlob(blob, filename, size, token) {
  const uploadUrl = await createOneDriveSession(filename, token);
  for (let offset = 0; offset < size; offset += ONEDRIVE_CHUNK_SIZE) {
    const length = Math.min(ONEDRIVE_CHUNK_SIZE, size - offset);
    const download = await blob.download(offset, length);
    const bytes = await streamToBuffer(download.readableStreamBody);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Length": String(length), "Content-Range": `bytes ${offset}-${offset + length - 1}/${size}` },
      body: bytes
    });
    if (!response.ok && response.status !== 202) throw new Error(`OneDrive upload failed (${response.status})`);
  }
}

app.storageQueue("copyToOneDrive", {
  queueName: "onedrive-uploads",
  connection: "AzureWebJobsStorage",
  handler: async (message, context) => {
    const payload = typeof message === "string" ? JSON.parse(message) : message;
    const blob = BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage)
      .getContainerClient(INCOMING_CONTAINER)
      .getBlobClient(payload.blobName);
    if (!(await blob.exists())) {
      context.log(`Blob ${payload.blobName} was already processed`);
      return;
    }
    const properties = await blob.getProperties();
    const filename = payload.blobName.split("/").pop();
    const token = await getAccessToken();
    await uploadBlob(blob, filename, properties.contentLength, token);
    await blob.delete();
    context.log(`Copied ${payload.blobName} to OneDrive`);
  }
});