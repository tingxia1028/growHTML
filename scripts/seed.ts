import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ingestHtmlSource, listSources } from "../src/core/store/sources";
import { getDefaultVaultRoot, openVault, type StudyVault } from "../src/core/vault";
import type { SourceRecord } from "../src/core/schema";

export type SeedVaultOptions = {
  rootDir?: string;
  legacyContentPath?: string;
};

export type SeedVaultResult = {
  mode: "existing" | "legacy" | "demo";
  source: SourceRecord;
  vault: StudyVault;
};

export const demoHtml = `<article data-study-id="demo-root">
  <section data-study-id="demo-intro">
    <h1 data-study-id="demo-title">AI Study Vault Demo</h1>
    <p data-study-id="demo-paragraph">Select this paragraph to create an Anchor, Note, and Patch.</p>
  </section>
</article>`;

export async function seedVault(options: SeedVaultOptions = {}): Promise<SeedVaultResult> {
  const vault = await openVault({ rootDir: options.rootDir ?? getDefaultVaultRoot() });
  const existingSources = await listSources(vault);
  if (existingSources.length > 0) {
    return {
      mode: "existing",
      source: existingSources[0],
      vault
    };
  }

  const legacyPath =
    options.legacyContentPath ?? path.resolve(process.cwd(), "data", "documents", "main", "content.html");
  const legacyContent = await readOptionalText(legacyPath);

  if (legacyContent?.trim()) {
    const source = await ingestHtmlSource(vault, {
      title: "Imported GrowHTML Document",
      content: legacyContent,
      createdBy: "system"
    });
    return { mode: "legacy", source, vault };
  }

  const source = await ingestHtmlSource(vault, {
    title: "AI Study Vault Demo",
    content: demoHtml,
    createdBy: "system"
  });
  return { mode: "demo", source, vault };
}

async function readOptionalText(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await seedVault();
  console.log(`Seeded vault (${result.mode}): ${result.source.title} [${result.source.id}]`);
}

