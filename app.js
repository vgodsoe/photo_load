// Set this to the deployed Azure Function URL before publishing.
const UPLOAD_ENDPOINT = "https://YOUR-FUNCTION.azurewebsites.net/api/upload";
const MAX_FILE_SIZE = 100 * 1024 * 1024;

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

mediaInput.addEventListener("change", () => {
  const file = mediaInput.files[0];
  if (!file) return;
  if (file.size > MAX_FILE_SIZE) {
    setStatus("That file is larger than 100 MB. Please choose a smaller one.", true);
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
  if (UPLOAD_ENDPOINT.includes("YOUR-FUNCTION")) {
    setStatus("The upload service has not been connected yet.", true);
    return;
  }

  submitButton.disabled = true;
  submitLabel.textContent = "Sending...";
  setStatus("Uploading your memory...");

  const payload = new FormData();
  payload.append("media", file, file.name);
  payload.append("guestName", guestName.value.trim());

  try {
    const response = await fetch(UPLOAD_ENDPOINT, { method: "POST", body: payload });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Upload failed");
    form.hidden = true;
    success.hidden = false;
  } catch (error) {
    setStatus(error.message || "Something went wrong. Please try again.", true);
    submitButton.disabled = false;
  } finally {
    submitLabel.textContent = "Send to the album";
  }
});