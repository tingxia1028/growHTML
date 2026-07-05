// Module-scope platform accessor. The non-hook pref helpers (the ~30
// readStored*/persist* pairs that will migrate in the next slice) can't call
// usePlatform() — they run outside React. They read the platform from here
// instead. main.tsx calls setPlatform(detectPlatform()) BEFORE the first render,
// so getPlatform() is always populated by the time any helper runs; it throws a
// clear error if that ordering is ever broken, rather than silently detecting a
// second (possibly divergent) adapter.
// See docs/implementation/platform-layering-build-spec.md §1.6.

import type { PlatformAdapter } from "./types";

let current: PlatformAdapter | null = null;

export function setPlatform(platform: PlatformAdapter): void {
  current = platform;
}

export function getPlatform(): PlatformAdapter {
  if (!current) {
    throw new Error(
      "Platform not set — call setPlatform(detectPlatform()) before first use (see main.tsx)."
    );
  }
  return current;
}

// Non-throwing accessor for module-scope helpers that must stay usable BEFORE the
// platform is set (e.g. entityClient.assetUrl called from a unit test that never runs
// main.tsx). Returns null when unset so the caller can fall back to a platform-neutral
// default, instead of the hard throw getPlatform() raises.
export function getPlatformOptional(): PlatformAdapter | null {
  return current;
}
