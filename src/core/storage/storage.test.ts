import { describe, expect, it } from "vitest";
import { fixtureHtmlBody } from "../fixtures/golden";
import { ingestHtmlSource, listSources, readSourceContent } from "../store/sources";
import { openVault } from "../vault";
import { MemoryStorageAdapter } from "./memoryStorage";

// Proves the StorageAdapter seam: the entire vault (dirs, manifest, JSONL stores,
// source files) runs on a non-Node backend. This is the path a mobile adapter
// (Capacitor Filesystem / SQLite) would take.
describe("vault on a non-Node StorageAdapter", () => {
  it("opens, ingests, persists, and reads back through in-memory storage", async () => {
    const storage = new MemoryStorageAdapter();
    const vault = await openVault({ rootDir: "/study", name: "Mobile Vault", storage });

    expect(vault.storage).toBe(storage);
    expect(vault.manifest.name).toBe("Mobile Vault");

    const source = await ingestHtmlSource(vault, { title: "Render Thread", content: fixtureHtmlBody });
    const sources = await listSources(vault);
    expect(sources.map((item) => item.id)).toContain(source.id);

    // Source content round-trips through the adapter.
    expect(await readSourceContent(vault, source)).toBe(fixtureHtmlBody);

    // JSONL entity store round-trips (upsert → get) on the same backend.
    const stored = await vault.stores.sources.get(source.id);
    expect(stored?.title).toBe("Render Thread");

    // A second vault opened on the SAME adapter sees the persisted data.
    const reopened = await openVault({ rootDir: "/study", storage });
    expect((await listSources(reopened)).map((item) => item.id)).toContain(source.id);
  });
});
