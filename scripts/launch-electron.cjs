const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const sourceExe = require("electron");
const brandedDir = path.dirname(sourceExe);
const brandedExe = path.join(brandedDir, "Growte.exe");
const stampDir = path.join(root, "node_modules", ".cache", "growte-electron");
const stampPath = path.join(stampDir, "brand.json");
const iconPath = path.join(root, "electron", "assets", "growte-anchor.ico");
const appEntry = path.join(root, "dist-electron", "main.cjs");

function fileSignature(filePath) {
  const stat = fs.statSync(filePath);
  return {
    size: stat.size,
    mtimeMs: Math.round(stat.mtimeMs)
  };
}

function needsBranding() {
  if (!fs.existsSync(brandedExe) || !fs.existsSync(stampPath)) return true;
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, "utf8"));
    return (
      stamp.sourceExe !== sourceExe ||
      stamp.iconPath !== iconPath ||
      JSON.stringify(stamp.source) !== JSON.stringify(fileSignature(sourceExe)) ||
      JSON.stringify(stamp.icon) !== JSON.stringify(fileSignature(iconPath))
    );
  } catch {
    return true;
  }
}

async function ensureBrandedExe() {
  if (!needsBranding()) return;

  fs.mkdirSync(brandedDir, { recursive: true });
  fs.mkdirSync(stampDir, { recursive: true });
  fs.copyFileSync(sourceExe, brandedExe);

  const { rcedit } = await import("rcedit");
  await rcedit(brandedExe, {
    icon: iconPath,
    "version-string": {
      CompanyName: "Growte",
      FileDescription: "Growte",
      InternalName: "Growte",
      OriginalFilename: "Growte.exe",
      ProductName: "Growte"
    }
  });

  fs.writeFileSync(
    stampPath,
    JSON.stringify(
      {
        sourceExe,
        iconPath,
        source: fileSignature(sourceExe),
        icon: fileSignature(iconPath)
      },
      null,
      2
    )
  );
}

async function main() {
  await ensureBrandedExe();
  if (process.argv.includes("--brand-only")) {
    console.log(brandedExe);
    return;
  }
  const args = [appEntry, ...process.argv.slice(2)];
  const child = spawn(brandedExe, args, { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  child.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
