// Trigger schema (PRO-1, proactive-learning §1): envelope + roundtrip, the when/actionRef
// discriminated-union discrimination, the conservative constraint DEFAULTS (克制), and the
// PRIVACY/PORTABILITY invariant — triggers are NOT part of the generic vaultEntitySchema
// union (like operation/memory/chatSession), so no generic entity flow can sweep a
// behavior-as-data definition up by accident.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { triggerSchema, vaultEntitySchema, type TriggerRecord } from ".";
import { createEntityId, isEntityId } from "../ids";
import { createSnapshotStore, type SnapshotRecord, type SnapshotStore } from "../store/snapshotStore";
import { closeSqliteStore } from "../store/engine";

const ULID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

const fixtureTrigger = {
  id: `trigger_${ULID}`,
  type: "trigger" as const,
  schemaVersion: 1 as const,
  createdAt: "2026-07-04T08:00:00.000Z",
  updatedAt: "2026-07-04T08:00:00.000Z",
  createdBy: "system" as const,
  name: "复习推动",
  description: "该复习了",
  enabled: true,
  when: { kind: "schedule" as const, atLocalTime: "19:00" },
  actionRef: { kind: "navigate" as const, target: "review.panel" },
  reason: "5 张卡到期 · 你 19:00 常复习",
  constraints: {
    dailyCap: 2,
    quietHours: { start: "22:00", end: "08:00" },
    minGapMinutes: 180,
    onlyWhenIdle: true
  }
};

describe("trigger schema", () => {
  it("roundtrips a full schedule+navigate trigger", () => {
    const parsed = triggerSchema.parse(fixtureTrigger);
    expect(parsed).toEqual({ ...fixtureTrigger, metadata: {} });
    expect(parsed.when.kind).toBe("schedule");
    expect(parsed.actionRef.kind).toBe("navigate");
  });

  it("applies conservative constraint DEFAULTS (克制) when omitted", () => {
    const parsed = triggerSchema.parse({
      ...fixtureTrigger,
      enabled: undefined,
      description: undefined,
      constraints: undefined
    });
    // 克制: opt-in (off), quiet 22:00–08:00, cap 2, 3h gap, idle-only.
    expect(parsed.enabled).toBe(false);
    expect(parsed.description).toBe("");
    expect(parsed.constraints).toEqual({
      dailyCap: 2,
      quietHours: { start: "22:00", end: "08:00" },
      minGapMinutes: 180,
      onlyWhenIdle: true
    });
  });

  it("discriminates the when union (schedule vs event) and the actionRef union (navigate vs operation)", () => {
    const eventTrigger = triggerSchema.parse({
      ...fixtureTrigger,
      when: { kind: "event", signal: "mistakes-accumulated" },
      actionRef: { kind: "operation", operationId: "op_x" }
    });
    // event/operation PARSE (forward-compat for PRO-2) even though the PRO-1 evaluator
    // rejects them — the schema DEFINES them; the evaluator gates them.
    expect(eventTrigger.when).toEqual({ kind: "event", signal: "mistakes-accumulated" });
    expect(eventTrigger.actionRef).toEqual({ kind: "operation", operationId: "op_x" });
  });

  it("rejects an unknown when.kind and a malformed local time", () => {
    expect(() => triggerSchema.parse({ ...fixtureTrigger, when: { kind: "nope", atLocalTime: "19:00" } })).toThrow();
    // Not zero-padded / out of 24h range → rejected (the client owns HH:MM formatting).
    expect(() => triggerSchema.parse({ ...fixtureTrigger, when: { kind: "schedule", atLocalTime: "9:00" } })).toThrow();
    expect(() =>
      triggerSchema.parse({ ...fixtureTrigger, when: { kind: "schedule", atLocalTime: "24:00" } })
    ).toThrow();
  });

  it("requires a non-empty reason (every nudge must show WHY it fired)", () => {
    expect(() => triggerSchema.parse({ ...fixtureTrigger, reason: "" })).toThrow();
  });

  it("mints trigger ids under the trigger kind", () => {
    const id = createEntityId("trigger");
    expect(id.startsWith("trigger_")).toBe(true);
    expect(isEntityId("trigger", id)).toBe(true);
  });

  it("is EXCLUDED from the generic vault-entity union (no import/export/share sweep)", () => {
    const result = vaultEntitySchema.safeParse(triggerSchema.parse(fixtureTrigger));
    expect(result.success).toBe(false);
  });
});

describe("trigger store round-trip", () => {
  let tempDir = "";
  let store: SnapshotStore<TriggerRecord>;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "trigger-store-"));
    store = createSnapshotStore({ filePath: path.join(tempDir, "triggers.jsonl"), schema: triggerSchema });
  });

  afterEach(async () => {
    // STORE-SQL Stage-3: release sqlite handles before rm (no-op on jsonl).
    closeSqliteStore(store as SnapshotStore<SnapshotRecord>);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("upserts, lists and re-reads a trigger definition", async () => {
    const record = triggerSchema.parse(fixtureTrigger);
    await store.upsert(record);
    expect(await store.get(record.id)).toEqual(record);
    expect(await store.list()).toEqual([record]);
  });
});
