const { app } = require("@azure/functions");
const {
  BlobServiceClient,
  BlobSASPermissions,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
} = require("@azure/storage-blob");
const { QueueClient } = require("@azure/storage-queue");

const MAX_FILE_SIZE = 250 * 1024 * 1024;
const INCOMING_CONTAINER = "incoming";
const UPLOAD_QUEUE = "onedrive-uploads";
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/mov",
]);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Event-Token",
  };
}

function authorize(request) {
  const expected = process.env.EVENT_TOKEN;
  const supplied = request.headers.get("x-event-token");
  return expected && supplied && supplied === expected;
}

function cleanPart(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^a-z0-9 _-]/gi, "")
    .replace(/\s+/g, "-");
  return cleaned.slice(0, 40) || fallback;
}

function parseStorageConnection() {
  const values = Object.fromEntries(
    (process.env.AzureWebJobsStorage || "")
      .split(";")
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        return [part.slice(0, separator), part.slice(separator + 1)];
      }),
  );
  if (!values.AccountName || !values.AccountKey)
    throw new Error(
      "AzureWebJobsStorage must use an account key connection string",
    );
  return values;
}

function blobService() {
  return BlobServiceClient.fromConnectionString(
    process.env.AzureWebJobsStorage,
  );
}

function queueClient() {
  return new QueueClient(process.env.AzureWebJobsStorage, UPLOAD_QUEUE);
}

async function prepareStorage() {
  await blobService()
    .getContainerClient(INCOMING_CONTAINER)
    .createIfNotExists();
  await queueClient().createIfNotExists();
}

app.http("createUpload", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "uploads",
  handler: async (request, context) => {
    const headers = corsHeaders();
    if (request.method === "OPTIONS") return { status: 204, headers };
    if (!authorize(request))
      return {
        status: 403,
        headers,
        jsonBody: { error: "This upload link is not valid." },
      };

    try {
      const body = await request.json();
      if (!ALLOWED_TYPES.has(body.contentType))
        return {
          status: 415,
          headers,
          jsonBody: { error: "That file type is not supported." },
        };
      if (
        !Number.isSafeInteger(body.size) ||
        body.size <= 0 ||
        body.size > MAX_FILE_SIZE
      ) {
        return {
          status: 413,
          headers,
          jsonBody: { error: "Files must be 250 MB or smaller." },
        };
      }

      await prepareStorage();
      const extension = cleanPart(
        String(body.filename || "")
          .split(".")
          .pop(),
        "bin",
      ).toLowerCase();
      const guest = cleanPart(body.guestName, "guest");
      const blobName = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${guest}-${crypto.randomUUID()}.${extension}`;
      const storage = parseStorageConnection();
      const credential = new StorageSharedKeyCredential(
        storage.AccountName,
        storage.AccountKey,
      );
      const expiresOn = new Date(Date.now() + 60 * 60 * 1000);
      const sas = generateBlobSASQueryParameters(
        {
          containerName: INCOMING_CONTAINER,
          blobName,
          permissions: BlobSASPermissions.parse("cw"),
          startsOn: new Date(Date.now() - 5 * 60 * 1000),
          expiresOn,
          contentType: body.contentType,
        },
        credential,
      ).toString();
      const blobUrl = blobService()
        .getContainerClient(INCOMING_CONTAINER)
        .getBlockBlobClient(blobName).url;
      return {
        status: 200,
        headers,
        jsonBody: { blobName, uploadUrl: `${blobUrl}?${sas}`, expiresOn },
      };
    } catch (error) {
      context.error(error);
      return {
        status: 500,
        headers,
        jsonBody: { error: "Could not prepare the upload. Please try again." },
      };
    }
  },
});

module.exports = { authorize };
app.http("completeUpload", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "uploads/complete",
  handler: async (request, context) => {
    const headers = corsHeaders();
    if (request.method === "OPTIONS") return { status: 204, headers };
    if (!authorize(request))
      return {
        status: 403,
        headers,
        jsonBody: { error: "This upload link is not valid." },
      };

    try {
      const { blobName } = await request.json();
      if (!blobName || blobName.includes(".."))
        return { status: 400, headers, jsonBody: { error: "Invalid upload." } };
      const blob = blobService()
        .getContainerClient(INCOMING_CONTAINER)
        .getBlobClient(blobName);
      if (!(await blob.exists()))
        return {
          status: 404,
          headers,
          jsonBody: { error: "The uploaded file could not be found." },
        };
      await prepareStorage();
      await queueClient().sendMessage(
        Buffer.from(JSON.stringify({ blobName })).toString("base64"),
      );
      return { status: 202, headers, jsonBody: { ok: true } };
    } catch (error) {
      context.error(error);
      return {
        status: 500,
        headers,
        jsonBody: {
          error:
            "The upload was saved but could not be queued. Please try again.",
        },
      };
    }
  },
});
