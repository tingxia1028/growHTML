import { zipSync, strToU8 } from "fflate";

// Builds a real .xmind archive (a ZIP) carrying a modern `content.json` map — the
// fixture for the .xmind → markmap import e2e. Pure, deps-free (fflate, already a
// dependency). The map is a small nested tree so the imported markmap outline has
// ≥2 heading levels (root + branches) plus a nested bullet (a grandchild).
export function makeXmindBytes(): Uint8Array {
  const content = JSON.stringify([
    {
      title: "Sheet 1",
      rootTopic: {
        title: "Water Cycle",
        children: {
          attached: [
            { title: "Evaporation", children: { attached: [{ title: "Sun heats water" }] } },
            { title: "Condensation" },
            { title: "Precipitation" }
          ]
        }
      }
    }
  ]);
  return zipSync({
    "content.json": strToU8(content),
    "metadata.json": strToU8("{}")
  });
}
