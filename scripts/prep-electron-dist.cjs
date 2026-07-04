// X1 packaging prep. electron-builder is configured (electron-builder.yml
// `electronDist`) to package from a LOCAL electron dist instead of downloading
// and extracting a zip: the extract→rename step EPERMs on this machine
// (something persistently holds a handle on the freshly extracted directory —
// see docs/design/packaging.md), while a plain copy from a stable dir is
// reliable and also skips the download.
//
// We do NOT point electronDist straight at node_modules/electron/dist:
//   - the dev launcher (scripts/launch-electron.cjs) brands a Growte.exe INTO
//     that dir as a cache, which must not ship (the builder itself renames
//     electron.exe → Growte.exe in the output), and
//   - a running dev client (Growte.exe) locks that file, so deleting it here
//     would force killing the live session.
// Instead, stage a CLEAN copy (minus the branded exe) under node_modules/.cache
// and let electron-builder package from the stage. Re-staged only when the
// installed electron dist changes (version/exe signature stamp).
const fs = require("node:fs");
const path = require("node:path");

const sourceDir = path.dirname(require("electron"));
const cacheDir = path.join(__dirname, "..", "node_modules", ".cache", "growte-electron");
const stageDir = path.join(cacheDir, "dist-stage");
const stampPath = path.join(cacheDir, "dist-stage.stamp");
const EXCLUDE = new Set(["growte.exe"]);

function signature(dir) {
  const exe = path.join(dir, "electron.exe");
  const versionFile = path.join(dir, "version");
  if (!fs.existsSync(exe) || !fs.existsSync(versionFile)) return null;
  const stat = fs.statSync(exe);
  return `${fs.readFileSync(versionFile, "utf8").trim()}|${stat.size}|${Math.round(stat.mtimeMs)}`;
}

const want = signature(sourceDir);
if (!want) {
  console.error(`[prep-electron-dist] no electron dist at ${sourceDir} — run npm install`);
  process.exit(1);
}

const have = fs.existsSync(stampPath) ? fs.readFileSync(stampPath, "utf8") : null;
if (have === want && fs.existsSync(path.join(stageDir, "electron.exe"))) {
  console.log("[prep-electron-dist] stage is up to date");
  process.exit(0);
}

fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });
fs.cpSync(sourceDir, stageDir, {
  recursive: true,
  filter: (src) => !EXCLUDE.has(path.basename(src).toLowerCase())
});
fs.writeFileSync(stampPath, want);
console.log(`[prep-electron-dist] staged clean electron dist -> ${stageDir}`);
