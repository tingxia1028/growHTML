// gen-icon.mjs — regenerate the Growte app/taskbar icon from the source SVG.
//
// Source of truth: electron/assets/growte-anchor.svg
//   The glyph is the lucide-react `Anchor` (v1.21.0), the SAME geometry rendered
//   as the in-app top-left brand logo (src/client/workspace/TopBar.tsx → <Anchor/>),
//   stroked in the Growte accent #3b6fe0.
//
// Pipeline: SVG --(sharp)--> PNG @ several sizes --(png-to-ico)--> multi-size ICO.
// Outputs:
//   electron/assets/growte-anchor.png  (256x256, used by nativeImage fallback)
//   electron/assets/growte-anchor.ico  (16/24/32/48/64/128/256, Windows taskbar/build)
//   public/growte-anchor.png           (256x256, browser/dev-tab favicon via Vite)
//
// Run: node scripts/gen-icon.mjs
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import pngToIco from "png-to-ico";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(here, "..", "electron", "assets");
const publicDir = path.join(here, "..", "public");
const svgPath = path.join(assetsDir, "growte-anchor.svg");
const pngPath = path.join(assetsDir, "growte-anchor.png");
const icoPath = path.join(assetsDir, "growte-anchor.ico");
const faviconPath = path.join(publicDir, "growte-anchor.png");

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

async function renderPng(svg, size) {
  return sharp(svg, { density: 384 }).resize(size, size, { fit: "contain" }).png().toBuffer();
}

async function main() {
  const svg = await readFile(svgPath);

  // Primary 256x256 PNG (nativeImage fallback) + the same as the web favicon.
  const png256 = await renderPng(svg, 256);
  await mkdir(publicDir, { recursive: true });
  await writeFile(pngPath, png256);
  await writeFile(faviconPath, png256);

  // Multi-resolution ICO for crisp taskbar rendering at every size.
  const pngs = await Promise.all(ICO_SIZES.map((s) => renderPng(svg, s)));
  const ico = await pngToIco(pngs);
  await writeFile(icoPath, ico);

  console.log(`Wrote ${pngPath}`);
  console.log(`Wrote ${faviconPath}`);
  console.log(`Wrote ${icoPath} (${ICO_SIZES.join("/")})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
