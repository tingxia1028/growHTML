import type { z } from "zod";
import type { StorageAdapter } from "../storage/adapter";

export type JsonlIssue = {
  line: number;
  reason: string;
  raw: string;
};

export type JsonlReadResult<T> = {
  records: T[];
  issues: JsonlIssue[];
};

export async function readJsonl<T>(
  filePath: string,
  schema: z.ZodType<T>,
  storage: StorageAdapter
): Promise<JsonlReadResult<T>> {
  const text = await storage.readText(filePath);
  if (text === null) {
    return { records: [], issues: [] };
  }

  const records: T[] = [];
  const issues: JsonlIssue[] = [];

  text.split(/\r?\n/).forEach((line, index) => {
    const raw = line.trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as unknown;
      const result = schema.safeParse(parsed);
      if (result.success) {
        records.push(result.data);
      } else {
        issues.push({
          line: index + 1,
          raw,
          reason: result.error.issues.map((issue) => issue.message).join("; ")
        });
      }
    } catch (error) {
      issues.push({
        line: index + 1,
        raw,
        reason: error instanceof Error ? error.message : "Invalid JSON"
      });
    }
  });

  return { records, issues };
}

export async function writeJsonlAtomic<T>(
  filePath: string,
  records: readonly T[],
  storage: StorageAdapter
) {
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  const text = body ? `${body}\n` : "";
  await storage.writeTextAtomic(filePath, text);
}

export async function appendJsonlRecord<T>(filePath: string, record: T, storage: StorageAdapter) {
  await storage.appendText(filePath, `${JSON.stringify(record)}\n`);
}
