import { statSync } from "node:fs";

// Use the requested directory only if it's a real, existing directory; otherwise
// fall back (to the app's cwd). Keeps a bad/typo'd path from killing the spawn.
export function resolveCwd(requested: string | undefined, fallback: string): string {
  const trimmed = requested?.trim();
  if (!trimmed) return fallback;
  try {
    if (statSync(trimmed).isDirectory()) return trimmed;
  } catch {
    // not a directory / doesn't exist
  }
  return fallback;
}
