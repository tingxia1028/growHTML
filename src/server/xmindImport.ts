import fs from "node:fs/promises";
import { unzipSync, strFromU8 } from "fflate";
import { xmindToMarkmap } from "../core/notes/xmindToMarkmap";

// .xmind import — the IMPURE, THIN unzip+parse layer (Phase 4 item 3). A `.xmind`
// file is a ZIP archive. Modern XMind stores the map in `content.json` (an array of
// sheets, each with a `rootTopic`); older files use `content.xml`. This layer:
//   1. reads the file bytes off disk (Node fs — desktop-only, like localFiles.ts),
//   2. unzips with `fflate` (tiny, zero-dep — chosen over jszip for size),
//   3. extracts content.json (primary) or content.xml (fallback) bytes,
//   4. delegates ALL tree→outline mapping to the PURE `xmindToMarkmap` converter.
// It deliberately does NOT touch the note schema or the vault — the caller (the
// /api/notes/import-xmind route) creates the markmap note via the normal note path,
// so the result renders via the existing `markmap` plugin (NO new renderer).

/** Parse already-read .xmind bytes → a markmap markdown outline string. */
export function xmindBytesToMarkmap(bytes: Uint8Array): string {
  const files = unzipSync(bytes); // { [path]: Uint8Array }
  // Entry names can be nested (rare); match by basename, JSON first.
  const findByName = (name: string): Uint8Array | undefined => {
    const exact = files[name];
    if (exact) return exact;
    for (const key of Object.keys(files)) {
      if (key.split("/").pop()?.toLowerCase() === name) return files[key];
    }
    return undefined;
  };

  const jsonBytes = findByName("content.json");
  if (jsonBytes) {
    const parsed = JSON.parse(strFromU8(jsonBytes));
    return xmindToMarkmap({ json: parsed });
  }

  const xmlBytes = findByName("content.xml");
  if (xmlBytes) {
    return xmindToMarkmap({ xml: strFromU8(xmlBytes) });
  }

  throw new Error("Not a recognizable .xmind file: no content.json or content.xml inside the archive");
}

/** Read a .xmind file off disk and convert it → a markmap markdown outline. */
export async function importXmindToMarkmap(filePath: string): Promise<{ outline: string }> {
  const data = await fs.readFile(filePath);
  // fs returns a Buffer (a Uint8Array subclass) — pass straight to fflate.
  const outline = xmindBytesToMarkmap(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return { outline };
}
