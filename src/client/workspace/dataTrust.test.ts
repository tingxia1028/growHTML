// @vitest-environment jsdom
// Data-trust client actions (TRUST-1/2): the default IO hits the RIGHT endpoints
// (mock fetch), the local zip peek (nothing uploaded) recognizes/refuses packs,
// and the import flow enforces the doc's semantics — DIFFERENT-VAULT warning on
// id mismatch, the typed confirm phrase gate, the honest completion/failed
// messages, and reload only when the server says no restart is needed.

import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  IMPORT_CONFIRM_PHRASE,
  downloadBlob,
  getDataTrustIo,
  importVaultFromFile,
  peekVaultZip,
  runBackupNow,
  runExportVault,
  setDataTrustIoForTests,
  type DataTrustUi,
  type VaultImportOutcome
} from "./dataTrust";

afterEach(() => {
  setDataTrustIoForTests(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function makeUi(promptAnswer: string | null = null) {
  const alerts: string[] = [];
  const prompts: string[] = [];
  let reloads = 0;
  const ui: DataTrustUi = {
    alert: (message) => alerts.push(message),
    prompt: (message) => {
      prompts.push(message);
      return promptAnswer;
    },
    reload: () => {
      reloads += 1;
    }
  };
  return { ui, alerts, prompts, reloads: () => reloads };
}

function makeVaultZip(overrides?: { createdAt?: string; format?: string }): Uint8Array<ArrayBuffer> {
  const manifest = {
    format: overrides?.format ?? "growte-vault",
    formatVersion: 1,
    kind: "export",
    appVersion: "0.1.0",
    createdAt: "2026-07-04T00:00:00.000Z",
    vault: { name: "旧库", createdAt: overrides?.createdAt ?? "2026-01-01T00:00:00.000Z", schemaVersion: 1 },
    counts: { sources: 2, notes: 3 }
  };
  return zipSync({
    "growte-vault.json": strToU8(JSON.stringify(manifest)),
    ".study/manifest.json": strToU8("{}")
  });
}

const vaultInfo = {
  vault: {
    name: "我的库",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1
  },
  counts: { sources: 1 },
  rootDir: "X:/vault"
};

describe("default IO endpoints (mock fetch)", () => {
  it("backupNow POSTs /api/backup/now; status + info GET their routes", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string }) => {
        calls.push({ url, method: init?.method });
        return {
          status: 200,
          ok: true,
          json: async () => ({ ok: true })
        };
      })
    );

    const io = getDataTrustIo();
    await io.backupNow();
    await io.fetchBackupStatus();
    await io.fetchVaultInfo();
    expect(calls).toEqual([
      { url: "/api/backup/now", method: "POST" },
      { url: "/api/backup/status", method: "GET" },
      { url: "/api/vault/info", method: "GET" }
    ]);
  });

  it("exportVault GETs /api/vault/export and takes the server's file name; importVault POSTs the bytes with the confirm phrase", async () => {
    const blob = new Blob(["zipbytes"]);
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url === "/api/vault/export") {
          return {
            ok: true,
            status: 200,
            headers: { get: (name: string) => (name === "content-disposition" ? 'attachment; filename="vault-20260704-010203.growte-vault.zip"' : null) },
            blob: async () => blob
          };
        }
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      })
    );

    const io = getDataTrustIo();
    const exported = await io.exportVault();
    expect(exported.fileName).toBe("vault-20260704-010203.growte-vault.zip");
    expect(exported.blob).toBe(blob);

    const bytes = new Uint8Array([1, 2, 3]);
    await io.importVault(bytes, IMPORT_CONFIRM_PHRASE);
    const importCall = calls[1];
    expect(importCall.url).toBe(`/api/vault/import?confirm=${encodeURIComponent(IMPORT_CONFIRM_PHRASE)}`);
    expect(importCall.init?.method).toBe("POST");
    expect((importCall.init?.headers as Record<string, string>)["Content-Type"]).toBe("application/zip");
    expect(importCall.init?.body).toBe(bytes);
  });
});

describe("peekVaultZip (local, nothing uploaded)", () => {
  it("reads the transfer manifest out of a real pack", () => {
    const peek = peekVaultZip(makeVaultZip());
    expect(peek).toEqual({
      vaultName: "旧库",
      vaultCreatedAt: "2026-01-01T00:00:00.000Z",
      appVersion: "0.1.0",
      counts: { sources: 2, notes: 3 }
    });
  });

  it("refuses garbage bytes, manifest-less zips, and foreign formats", () => {
    expect(peekVaultZip(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(peekVaultZip(zipSync({ "readme.txt": strToU8("hi") }))).toBeNull();
    expect(peekVaultZip(makeVaultZip({ format: "other" }))).toBeNull();
  });
});

describe("importVaultFromFile", () => {
  const okOutcome: VaultImportOutcome = {
    ok: true,
    counts: { sources: 2 },
    sourceVault: { name: "旧库", createdAt: "2026-01-01T00:00:00.000Z" },
    sameVault: true,
    preImportBackup: "vault-backup-20260704-010203-pre-import.zip",
    restartRequired: false
  };

  it("same vault: phrase typed → uploads the bytes with the confirm phrase, reports the pre-import backup, reloads", async () => {
    const importVault = vi.fn(async () => okOutcome);
    setDataTrustIoForTests({ fetchVaultInfo: async () => vaultInfo, importVault });
    const { ui, alerts, prompts, reloads } = makeUi(IMPORT_CONFIRM_PHRASE);

    const bytes = makeVaultZip();
    await importVaultFromFile(new File([bytes], "pack.growte-vault.zip"), ui);

    expect(importVault).toHaveBeenCalledTimes(1);
    const [sentBytes, phrase] = importVault.mock.calls[0] as unknown as [Uint8Array, string];
    expect(Array.from(sentBytes)).toEqual(Array.from(bytes)); // the picked bytes, verbatim
    expect(phrase).toBe(IMPORT_CONFIRM_PHRASE);
    expect(prompts[0]).not.toContain("⚠️"); // same vault ⇒ no DIFFERENT-VAULT warning
    expect(prompts[0]).toContain(IMPORT_CONFIRM_PHRASE);
    expect(alerts.some((m) => m.includes("导入完成") && m.includes("vault-backup-20260704-010203-pre-import.zip"))).toBe(true);
    expect(reloads()).toBe(1);
  });

  it("DIFFERENT vault (id mismatch): the warning rides the confirm prompt", async () => {
    setDataTrustIoForTests({
      fetchVaultInfo: async () => ({ ...vaultInfo, vault: { ...vaultInfo.vault, createdAt: "2020-05-05T00:00:00.000Z" } }),
      importVault: async () => okOutcome
    });
    const { ui, prompts } = makeUi(IMPORT_CONFIRM_PHRASE);
    await importVaultFromFile(new File([makeVaultZip()], "pack.zip"), ui);
    expect(prompts[0]).toContain("⚠️");
    expect(prompts[0]).toContain("另一个库");
  });

  it("wrong phrase → NOTHING uploaded; cancel → silent no-op", async () => {
    const importVault = vi.fn(async () => okOutcome);
    setDataTrustIoForTests({ fetchVaultInfo: async () => vaultInfo, importVault });

    const wrong = makeUi("替换");
    await importVaultFromFile(new File([makeVaultZip()], "pack.zip"), wrong.ui);
    expect(importVault).not.toHaveBeenCalled();
    expect(wrong.alerts.some((m) => m.includes("已取消"))).toBe(true);
    expect(wrong.reloads()).toBe(0);

    const cancelled = makeUi(null);
    await importVaultFromFile(new File([makeVaultZip()], "pack.zip"), cancelled.ui);
    expect(importVault).not.toHaveBeenCalled();
    expect(cancelled.alerts).toEqual([]);
  });

  it("a non-pack file is refused locally (no IO at all)", async () => {
    const fetchVaultInfo = vi.fn(async () => vaultInfo);
    const importVault = vi.fn(async () => okOutcome);
    setDataTrustIoForTests({ fetchVaultInfo, importVault });
    const { ui, alerts } = makeUi(IMPORT_CONFIRM_PHRASE);

    await importVaultFromFile(new File([new Uint8Array([9, 9, 9])], "random.zip"), ui);
    expect(alerts.some((m) => m.includes("不是有效的全库包"))).toBe(true);
    expect(fetchVaultInfo).not.toHaveBeenCalled();
    expect(importVault).not.toHaveBeenCalled();
  });

  it("restartRequired: true is reported honestly and does NOT reload", async () => {
    setDataTrustIoForTests({
      fetchVaultInfo: async () => vaultInfo,
      importVault: async () => ({ ...okOutcome, restartRequired: true })
    });
    const { ui, alerts, reloads } = makeUi(IMPORT_CONFIRM_PHRASE);
    await importVaultFromFile(new File([makeVaultZip()], "pack.zip"), ui);
    expect(alerts.some((m) => m.includes("请重启应用"))).toBe(true);
    expect(reloads()).toBe(0);
  });

  it("a server failure keeps the honest '库未被修改' framing", async () => {
    setDataTrustIoForTests({
      fetchVaultInfo: async () => vaultInfo,
      importVault: async () => {
        throw new Error("counts-mismatch 包不完整");
      }
    });
    const { ui, alerts, reloads } = makeUi(IMPORT_CONFIRM_PHRASE);
    await importVaultFromFile(new File([makeVaultZip()], "pack.zip"), ui);
    expect(alerts.some((m) => m.includes("导入失败") && m.includes("保持不变"))).toBe(true);
    expect(reloads()).toBe(0);
  });
});

describe("backup + export actions", () => {
  it("runBackupNow reports the new backup + total count; failures alert honestly", async () => {
    setDataTrustIoForTests({
      backupNow: async () => ({
        backup: { name: "vault-backup-20260704-010203-manual.zip", createdAt: "2026-07-04T01:02:03.000Z", reason: "manual", sizeBytes: 42 }
      }),
      fetchBackupStatus: async () => ({
        backups: [
          { name: "vault-backup-20260704-010203-manual.zip", createdAt: "2026-07-04T01:02:03.000Z", reason: "manual", sizeBytes: 42 },
          { name: "vault-backup-20260703-010203-auto.zip", createdAt: "2026-07-03T01:02:03.000Z", reason: "auto", sizeBytes: 40 }
        ],
        lastBackupAt: "2026-07-04T01:02:03.000Z",
        nextDueAt: "2026-07-05T01:02:03.000Z",
        backupsDir: "X:/backups"
      })
    });
    const ok = makeUi();
    await runBackupNow(ok.ui);
    expect(ok.alerts).toEqual(["已备份:vault-backup-20260704-010203-manual.zip(共 2 份)"]);

    setDataTrustIoForTests({
      backupNow: async () => {
        throw new Error("disk full");
      }
    });
    const failed = makeUi();
    await runBackupNow(failed.ui);
    expect(failed.alerts.some((m) => m.includes("备份失败") && m.includes("disk full"))).toBe(true);
  });

  it("runExportVault downloads the served blob under the server's file name", async () => {
    const blob = new Blob(["zip"]);
    setDataTrustIoForTests({ exportVault: async () => ({ blob, fileName: "vault-x.growte-vault.zip" }) });

    const created: string[] = [];
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:vault");
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
    let downloadName = "";
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      created.push(this.href);
      downloadName = this.getAttribute("download") ?? "";
    });

    try {
      const { ui, alerts } = makeUi();
      await runExportVault(ui);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(downloadName).toBe("vault-x.growte-vault.zip");
      expect(created[0]).toContain("blob:");
      expect(alerts).toEqual([]);
    } finally {
      delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });

  it("downloadBlob wires href + download and revokes the object URL", () => {
    const createUrl = vi.fn(() => "blob:one");
    const revokeUrl = vi.fn();
    (URL as unknown as { createObjectURL: unknown }).createObjectURL = createUrl;
    (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeUrl;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      downloadBlob(new Blob(["x"]), "a.zip");
      expect(createUrl).toHaveBeenCalledTimes(1);
      expect(clickSpy).toHaveBeenCalledTimes(1);
      expect(revokeUrl).toHaveBeenCalledWith("blob:one");
    } finally {
      delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
      delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
    }
  });
});
