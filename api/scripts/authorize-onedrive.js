const fs = require("node:fs");
const path = require("node:path");
const readline = require("node:readline/promises");

const SETTINGS_PATH = path.join(__dirname, "..", "local.settings.json");
const EXAMPLE_PATH = path.join(__dirname, "..", "local.settings.json.example");
const AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPES = "https://graph.microsoft.com/Files.ReadWrite offline_access";

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function postForm(url, values) {
  const response = await fetch(url, { method: "POST", body: new URLSearchParams(values) });
  const result = await response.json();
  return { response, result };
}

async function waitForToken(clientId, deviceCode, interval, expiresIn) {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;

  while (Date.now() < deadline) {
    await delay(pollInterval);
    const { response, result } = await postForm(`${AUTHORITY}/token`, {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      client_id: clientId,
      device_code: deviceCode
    });
    if (response.ok) return result;
    if (result.error === "authorization_pending") continue;
    if (result.error === "slow_down") {
      pollInterval += 5000;
      continue;
    }
    throw new Error(result.error_description || result.error || "Microsoft sign-in failed");
  }
  throw new Error("The sign-in code expired. Run the command again.");
}

async function ensureWeddingFolder(accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const lookup = await fetch("https://graph.microsoft.com/v1.0/me/drive/root:/Wedding%20Uploads", { headers });
  if (lookup.ok) return;
  if (lookup.status !== 404) throw new Error("OneDrive was authorized, but the destination folder could not be checked.");

  const create = await fetch("https://graph.microsoft.com/v1.0/me/drive/root/children", {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "Wedding Uploads", folder: {}, "@microsoft.graph.conflictBehavior": "fail" })
  });
  if (!create.ok && create.status !== 409) throw new Error("OneDrive was authorized, but the Wedding Uploads folder could not be created.");
}

function saveSettings(clientId, refreshToken) {
  const source = fs.existsSync(SETTINGS_PATH) ? SETTINGS_PATH : EXAMPLE_PATH;
  const settings = JSON.parse(fs.readFileSync(source, "utf8"));
  settings.Values.MICROSOFT_CLIENT_ID = clientId;
  settings.Values.MICROSOFT_REFRESH_TOKEN = refreshToken;
  fs.writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

async function main() {
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  const clientId = (await prompt.question("Paste the Application (client) ID from Entra: ")).trim();
  prompt.close();
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error("That does not look like an Application (client) ID.");

  const { response, result } = await postForm(`${AUTHORITY}/devicecode`, { client_id: clientId, scope: SCOPES });
  if (!response.ok) throw new Error(result.error_description || result.error || "Could not start Microsoft sign-in");
  console.log(`\n${result.message}\n`);

  const tokens = await waitForToken(clientId, result.device_code, result.interval, result.expires_in);
  if (!tokens.refresh_token) throw new Error("Microsoft did not return a refresh token. Check that offline_access is allowed.");
  await ensureWeddingFolder(tokens.access_token);
  saveSettings(clientId, tokens.refresh_token);
  console.log("OneDrive authorized. Credentials were saved to api/local.settings.json (ignored by Git).\n");
}

main().catch((error) => {
  console.error(`\nAuthorization failed: ${error.message}`);
  process.exitCode = 1;
});