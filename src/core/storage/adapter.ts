// StorageAdapter — the filesystem seam for the vault. The core data layer talks
// to storage only through this interface, so the Node implementation (desktop /
// server) can be swapped for a mobile one (Capacitor Filesystem / SQLite) or an
// in-memory one (tests) without touching the stores. Paths are opaque keys to
// the adapter; the core composes them with `path.join`.
export interface StorageAdapter {
  ensureDir(dirPath: string): Promise<void>;
  /** Returns null when the file does not exist. */
  readText(filePath: string): Promise<string | null>;
  /** Returns null when the file does not exist. */
  readBytes(filePath: string): Promise<Uint8Array | null>;
  writeText(filePath: string, data: string): Promise<void>;
  writeBytes(filePath: string, data: Uint8Array): Promise<void>;
  /** Durable, all-or-nothing write (no torn files under crash/concurrency). */
  writeTextAtomic(filePath: string, data: string): Promise<void>;
  appendText(filePath: string, data: string): Promise<void>;
}
