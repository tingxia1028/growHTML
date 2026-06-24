import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { StorageAdapter } from "./adapter";

// Default StorageAdapter backed by the Node filesystem (desktop + server).
// Carries the durability guarantees the vault relies on: atomic temp+fsync+rename
// snapshot writes and fsync'd appends.
export class NodeStorageAdapter implements StorageAdapter {
  async ensureDir(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }

  async readText(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readBytes(filePath: string): Promise<Uint8Array | null> {
    try {
      return await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async writeText(filePath: string, data: string): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    await writeFile(filePath, data, "utf8");
  }

  async writeBytes(filePath: string, data: Uint8Array): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    await writeFile(filePath, data);
  }

  async writeTextAtomic(filePath: string, data: string): Promise<void> {
    const dir = path.dirname(filePath);
    await mkdir(dir, { recursive: true });
    const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);

    const handle = await open(tempPath, "w");
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      await rename(tempPath, filePath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }

  async appendText(filePath: string, data: string): Promise<void> {
    await this.ensureDir(path.dirname(filePath));
    const handle = await open(filePath, "a");
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  async deleteFile(filePath: string): Promise<void> {
    await rm(filePath, { force: true });
  }
}

// Shared default instance used everywhere unless a different adapter is injected.
export const nodeStorage = new NodeStorageAdapter();
