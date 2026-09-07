// Set this to the deployed Azure Function origin before publishing.
const API_BASE_URL = "https://wedding-photo-upload-ghgjhthrduhnasck.northeurope-01.azurewebsites.net";
const MAX_FILE_SIZE = 250 * 1024 * 1024;
const BLOCK_SIZE = 5 * 1024 * 1024;
const EVENT_TOKEN = new URLSearchParams(location.search).get("event") || "";

const form = document.querySelector("#upload-form");
const cameraInput = document.querySelector("#camera-input");
const libraryInput = document.querySelector("#library-input");
const mediaInputs = [cameraInput, libraryInput];
const guestName = document.querySelector("#guest-name");
const selection = document.querySelector("#selection");
const selectionList = document.querySelector("#selection-list");
const clearSelection = document.querySelector("#clear-selection");
const submitButton = document.querySelector("#submit-button");
const submitLabel = document.querySelector("#submit-label");
const status = document.querySelector("#status");
const success = document.querySelector("#success");
const anotherButton = document.querySelector("#another-button");

function setStatus(message, isError = false) {
  status.textContent = message;
  status.style.color = isError ? "#e08a76" : "";
}

let selectedFiles = [];

function updateSelectionUI() {
  selectionList.innerHTML = "";
  selectedFiles.forEach((file, index) => {
    const item = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = file.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-file";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.textContent = "\u00d7";
    remove.addEventListener("click", () => {
      selectedFiles.splice(index, 1);
      updateSelectionUI();
    });
    item.append(name, remove);
    selectionList.append(item);
  });
  selection.hidden = selectedFiles.length === 0;
  submitButton.disabled = selectedFiles.length === 0;
  submitLabel.textContent = selectedFiles.length > 1 ? `Send ${selectedFiles.length} memories to the album` : "Send to the album";
}

function resetForm() {
  form.reset();
  selectedFiles = [];
  updateSelectionUI();
  setStatus("");
  success.hidden = true;
  form.hidden = false;
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

async function uploadBlocks(file, uploadUrl, onProgress) {
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
    onProgress(percent);
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

mediaInputs.forEach((input) => {
  input.addEventListener("change", () => {
    const files = Array.from(input.files);
    input.value = "";
    if (files.length === 0) return;
    const oversized = files.some((file) => file.size > MAX_FILE_SIZE);
    const valid = files.filter((file) => file.size <= MAX_FILE_SIZE);
    if (oversized) setStatus("Some files are larger than 250 MB and were skipped.", true);
    else setStatus("");
    selectedFiles = selectedFiles.concat(valid);
    updateSelectionUI();
  });
});

clearSelection.addEventListener("click", () => {
  selectedFiles = [];
  updateSelectionUI();
});

anotherButton.addEventListener("click", resetForm);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = selectedFiles;
  if (files.length === 0) return;
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

  const headers = { "Content-Type": "application/json", "X-Event-Token": EVENT_TOKEN };
  const total = files.length;

  try {
    for (let index = 0; index < total; index += 1) {
      const prefix = total > 1 ? `Uploading memory ${index + 1} of ${total}...` : "Uploading your memory...";
      setStatus(prefix);
      const prepared = await requestJson(`${API_BASE_URL}/api/uploads`, {
        method: "POST",
        headers,
        body: JSON.stringify({ filename: files[index].name, contentType: files[index].type, size: files[index].size, guestName: guestName.value.trim() })
      });
      await uploadBlocks(files[index], prepared.uploadUrl, (percent) => setStatus(`${prefix} ${percent}%`));
      await retry(() => requestJson(`${API_BASE_URL}/api/uploads/complete`, {
        method: "POST",
        headers,
        body: JSON.stringify({ blobName: prepared.blobName })
      }));
    }
    form.hidden = true;
    success.hidden = false;
  } catch (error) {
    setStatus(error.message || "Something went wrong. Please try again.", true);
    submitButton.disabled = false;
  } finally {
    updateSelectionUI();
  }
});