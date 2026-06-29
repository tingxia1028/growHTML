// Throwaway screenshot harness for the pixel-alignment loop. Connects to the running
// dev client (5173), opens the first existing source (no seeding -> no vault pollution),
// and captures the full window so the orchestrator can diff it against the reference.
import { chromium } from "@playwright/test";

const url = process.env.SHOT_URL || "http://127.0.0.1:5173";
const out = process.env.SHOT_OUT || "docs/design/shots/current-full.png";
const theme = process.env.SHOT_THEME || ""; // "dark" to switch first

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2
});
await page.goto(url, { waitUntil: "networkidle" });

// Open the first source the way a user would (skip in lens mode so the default-open
// Layer Lens popover isn't dismissed by the source click).
if (process.env.SHOT_LENS) {
  await page.waitForTimeout(800);
} else {
  try {
    await page.locator(".source-item-open").first().click({ timeout: 8000 });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.log("could not open a source:", e.message);
  }
}

if (theme === "dark") {
  try {
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("select.theme-select").selectOption("dark");
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  } catch (e) {
    console.log("theme switch failed:", e.message);
  }
}

await page.screenshot({ path: out, fullPage: false });
console.log("shot ->", out);
await browser.close();
