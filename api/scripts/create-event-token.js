const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const settingsPath = path.join(__dirname, "..", "local.settings.json");
if (!fs.existsSync(settingsPath)) {
  console.error("Run npm run authorize --prefix api first.");
  process.exit(1);
}

const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
settings.Values.EVENT_TOKEN = crypto.randomBytes(24).toString("base64url");
fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
console.log("A new event token was saved to api/local.settings.json. Keep it private until the QR code is distributed.");