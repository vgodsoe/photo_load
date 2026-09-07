const { app } = require("@azure/functions");

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/heic", "image/heif", "image/webp",
  "video/mp4", "video/quicktime", "video/webm", "video/mov"
]);

function cleanPart(value, fallback) {
  const cleaned = String(value || "").trim().replace(/[^a-z0-9 _-]/gi, "").replace(/\s+/g, "-");
  return cleaned.slice(0, 40) || fallback;
}

function encodePath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function getAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    client_secret: process.env.MICROSOFT_CLIENT_SECRET,
    grant_type: "refresh_token",
    refresh_token: process.env.MICROSOFT_REFRESH_TOKEN,
    scope: "https://graph.microsoft.com/Files.ReadWrite offline_access"
  });
  const response = await fetch("https://login.microsoftonline.com/consumers/oauth2/v2.0/token", { method: "POST", body });
  if (!response.ok) throw new Error("Could not authorize OneDrive");
  return (await response.json()).access_token;
}

async function uploadToOneDrive(file, filename, token) {
  const folder = (process.env.ONEDRIVE_FOLDER_PATH || "Wedding Uploads").replace(/^\/+|\/+$/g, "");
  const path = encodePath(`${folder}/${filename}`);
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${path}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": file.type || "application/octet-stream" },
    body: file.data
  });
  if (!response.ok) throw new Error("OneDrive rejected the upload");
}

app.http("upload", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const headers = {
      "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return { status: 204, headers };

    try {
      const form = await request.formData();
      const media = form.get("media");
      if (!media || typeof media.arrayBuffer !== "function") return { status: 400, headers, jsonBody: { error: "Please choose a photo or video." } };
      if (!ALLOWED_TYPES.has(media.type)) return { status: 415, headers, jsonBody: { error: "That file type is not supported." } };
      if (media.size > MAX_FILE_SIZE) return { status: 413, headers, jsonBody: { error: "Files must be 100 MB or smaller." } };

      const extension = (media.name.split(".").pop() || "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8);
      const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
      const filename = `${timestamp}-${cleanPart(form.get("guestName"), "guest")}.${extension}`;
      const token = await getAccessToken();
      await uploadToOneDrive({ data: Buffer.from(await media.arrayBuffer()), type: media.type }, filename, token);
      return { status: 200, headers, jsonBody: { ok: true } };
    } catch (error) {
      context.error(error);
      return { status: 500, headers, jsonBody: { error: "Upload failed. Please try again." } };
    }
  }
});