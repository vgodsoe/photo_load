const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");

const projectRoot = path.join(__dirname, "..", "..");
const settingsPath = path.join(__dirname, "..", "local.settings.json");
const outputDirectory = path.join(projectRoot, "private");
const outputPath = path.join(outputDirectory, "wedding-upload-qr.png");

async function main() {
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")).Values;
  if (!settings.EVENT_TOKEN) throw new Error("EVENT_TOKEN is missing from api/local.settings.json");
  const url = `https://vgodsoe.github.io/photo_load/?event=${encodeURIComponent(settings.EVENT_TOKEN)}`;
  fs.mkdirSync(outputDirectory, { recursive: true });
  await QRCode.toFile(outputPath, url, {
    errorCorrectionLevel: "H",
    margin: 4,
    width: 1400,
    color: { dark: "#24322fff", light: "#fffdf9ff" }
  });
  console.log("Private QR code created at private/wedding-upload-qr.png");
}

main().catch((error) => {
  console.error(`QR generation failed: ${error.message}`);
  process.exitCode = 1;
});