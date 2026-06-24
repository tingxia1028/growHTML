import type { StorageAdapter } from "./adapter";

// In-memory StorageAdapter — proves the vault runs on a non-Node backend (used
// by tests) and serves as the reference shape a mobile adapter (Capacitor
// Filesystem / SQLite) would implement. No real durability; everything lives in
// a Map keyed by path.
export class MemoryStorageAdapter implements StorageAdapter {
  private readonly files = new Map<string, string | Uint8Array>();

  async ensureDir(): Promise<void> {
    // Flat key space; directories are implicit.
  }

  async readText(filePath: string): Promise<string | null> {
    const value = this.files.get(filePath);
    if (value === undefined) return null;
    return typeof value === "string" ? value : new TextDecoder().decode(value);
  }

  async readBytes(filePath: string): Promise<Uint8Array | null> {
    const value = this.files.get(filePath);
    if (value === undefined) return null;
    return typeof value === "string" ? new TextEncoder().encode(value) : value;
  }

  async writeText(filePath: string, data: string): Promise<void> {
    this.files.set(filePath, data);
  }

  async writeBytes(filePath: string, data: Uint8Array): Promise<void> {
    this.files.set(filePath, data);
  }

  async writeTextAtomic(filePath: string, data: string): Promise<void> {
    this.files.set(filePath, data);
  }

  async appendText(filePath: string, data: string): Promise<void> {
    const existing = await this.readText(filePath);
    this.files.set(filePath, (existing ?? "") + data);
  }

  async deleteFile(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }
}
