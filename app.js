// Set this to the deployed Azure Function origin before publishing.
const API_BASE_URL = "https://wedding-photo-upload-ghgjhthrduhnasck.northeurope-01.azurewebsites.net";
const MAX_FILE_SIZE = 250 * 1024 * 1024;
const BLOCK_SIZE = 5 * 1024 * 1024;
const EVENT_TOKEN = new URLSearchParams(location.search).get("event") || "";

const form = document.querySelector("#upload-form");
const mediaInput = document.querySelector("#media-input");
const guestName = document.querySelector("#guest-name");
const selection = document.querySelector("#selection");
const selectionName = document.querySelector("#selection-name");
const clearSelection = document.querySelector("#clear-selection");
const submitButton = document.querySelector("#submit-button");
const submitLabel = document.querySelector("#submit-label");
const status = document.querySelector("#status");
const success = document.querySelector("#success");
const anotherButton = document.querySelector("#another-button");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#b44f42" : "";
}

function resetForm() {
  form.reset();
  selection.hidden = true;
  submitButton.disabled = true;
  setStatus("");
  success.hidden = true;
  form.hidden = false;
  mediaInput.focus();
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Upload failed");
  return result;
}

async function retry(operation, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 700 * (2 ** attempt)));
    }
  }
  throw lastError;
}

async function uploadBlocks(file, uploadUrl) {
  const blockIds = [];
  const totalBlocks = Math.ceil(file.size / BLOCK_SIZE);
  for (let index = 0; index < totalBlocks; index += 1) {
    const blockId = btoa(String(index).padStart(8, "0"));
    blockIds.push(blockId);
    const separator = uploadUrl.includes("?") ? "&" : "?";
    const blockUrl = `${uploadUrl}${separator}comp=block&blockid=${encodeURIComponent(blockId)}`;
    const chunk = file.slice(index * BLOCK_SIZE, Math.min((index + 1) * BLOCK_SIZE, file.size));
    await retry(async () => {
      const response = await fetch(blockUrl, {
        method: "PUT",
        headers: { "x-ms-version": "2023-11-03", "Content-Type": "application/octet-stream" },
        body: chunk
      });
      if (!response.ok) throw new Error(`A file block failed (${response.status})`);
    });
    const percent = Math.round(((index + 1) / totalBlocks) * 95);
    setStatus(`Uploading your memory... ${percent}%`);
  }

  const blockList = `<?xml version="1.0" encoding="utf-8"?><BlockList>${blockIds.map((id) => `<Latest>${id}</Latest>`).join("")}</BlockList>`;
  const separator = uploadUrl.includes("?") ? "&" : "?";
  await retry(async () => {
    const response = await fetch(`${uploadUrl}${separator}comp=blocklist`, {
      method: "PUT",
      headers: {
        "x-ms-version": "2023-11-03",
        "x-ms-blob-content-type": file.type,
        "Content-Type": "application/xml"
      },
      body: blockList
    });
    if (!response.ok) throw new Error(`The file could not be finalized (${response.status})`);
  });
}

mediaInput.addEventListener("change", () => {
  const file = mediaInput.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_SIZE) {
    setStatus("That file is larger than 250 MB. Please choose a smaller one.", true);
    mediaInput.value = "";
    return;
  }
  selectionName.textContent = file.name;
  selection.hidden = false;
  submitButton.disabled = false;
  setStatus("");
});

clearSelection.addEventListener("click", () => {
  mediaInput.value = "";
  selection.hidden = true;
  submitButton.disabled = true;
  mediaInput.focus();
});

anotherButton.addEventListener("click", resetForm);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = mediaInput.files[0];
  if (!file) return;
  if (API_BASE_URL.includes("YOUR-FUNCTION")) {
    setStatus("The upload service has not been connected yet.", true);
    return;
  }
  if (!EVENT_TOKEN) {
    setStatus("Please open the complete link from the wedding QR code.", true);
    return;
  }

  submitButton.disabled = true;
  submitLabel.textContent = "Sending...";
  setStatus("Uploading your memory...");

  try {
    const headers = { "Content-Type": "application/json", "X-Event-Token": EVENT_TOKEN };
    const prepared = await requestJson(`${API_BASE_URL}/api/uploads`, {
      method: "POST",
      headers,
      body: JSON.stringify({ filename: file.name, contentType: file.type, size: file.size, guestName: guestName.value.trim() })
    });
    await uploadBlocks(file, prepared.uploadUrl);
    setStatus("Safely stored. Adding it to the album...");
    await retry(() => requestJson(`${API_BASE_URL}/api/uploads/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ blobName: prepared.blobName })
    }));
    form.hidden = true;
    success.hidden = false;
  } catch (error) {
    setStatus(error.message || "Something went wrong. Please try again.", true);
    submitButton.disabled = false;
  } finally {
    submitLabel.textContent = "Send to the album";
  }
});