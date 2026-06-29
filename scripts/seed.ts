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

export const demoHtml = `<style>
  .physics-page {
    max-width: 760px;
    margin: 0 auto;
    padding: 42px 48px 64px;
    color: #20242c;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 18px;
    line-height: 1.62;
  }
  .physics-page h1 {
    margin: 0 0 24px;
    font-size: 21px;
    line-height: 1.2;
  }
  .physics-section {
    margin-right: 20px;
    font-weight: 400;
  }
  .physics-highlight {
    border-radius: 4px;
    background: #fff4d9;
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
    padding: 2px 6px;
  }
  .physics-highlight.blue {
    background: #eaf3ff;
  }
  .physics-equation {
    display: flex;
    justify-content: center;
    align-items: baseline;
    gap: 118px;
    margin: 24px 0;
    font-size: 20px;
  }
  .physics-equation span:first-child {
    padding: 2px 12px;
    border-radius: 4px;
    background: #eaf3ff;
    font-style: italic;
  }
  .physics-anchor-row {
    position: relative;
    margin: 32px 0;
  }
  .physics-anchor-row::before {
    content: "";
    position: absolute;
    left: -28px;
    top: 4px;
    width: 18px;
    height: 18px;
    background: center / contain no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M12 22V8'/%3E%3Cpath d='M5 12H2a10 10 0 0 0 20 0h-3'/%3E%3Ccircle cx='12' cy='5' r='3'/%3E%3C/svg%3E");
  }
</style>
<article class="physics-page" data-study-id="demo-root">
  <section data-study-id="demo-intro">
    <h1 data-study-id="demo-title"><span class="physics-section">2.2</span>Pressure in Liquids</h1>
    <p data-study-id="demo-lead">In a static liquid, pressure increases with depth.</p>
    <p class="physics-anchor-row" data-study-id="demo-paragraph"><span class="physics-highlight">At a depth <em>h</em> below the surface of a liquid with density <em>&rho;</em>, the pressure is given by</span></p>
    <div class="physics-equation" data-study-id="demo-equation"><span>p = &rho;gh</span><small>(2.2)</small></div>
    <p data-study-id="demo-gravity">where <em>g</em> is the acceleration due to gravity.</p>
    <p class="physics-anchor-row" data-study-id="demo-pascal">This pressure acts equally in all directions at a point, which is known as <span class="physics-highlight">Pascal's principle.</span></p>
    <p class="physics-anchor-row" data-study-id="demo-total">The total pressure at depth <em>h</em> in an open container is the <span class="physics-highlight blue">sum of the atmospheric pressure <em>p</em><sub>0</sub> and <em>&rho;gh</em>:</span></p>
    <div class="physics-equation" data-study-id="demo-equation-total"><span>p<sub>total</sub> = p<sub>0</sub> + &rho;gh</span><small>(2.3)</small></div>
    <p data-study-id="demo-close">These relations are fundamental in fluid statics and have many important applications.</p>
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
    title: "Physics_Textbook_Fluids.pdf",
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
