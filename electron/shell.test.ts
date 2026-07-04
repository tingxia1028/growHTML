import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEV_SERVER_URL, isDevMode, resolveClientDir, resolveStartUrl, resolveVaultRoot } from "./shell";

describe("electron shell helpers", () => {
  it("detects dev mode from ELECTRON_DEV or a --dev argv flag", () => {
    expect(isDevMode({ ELECTRON_DEV: "1" })).toBe(true);
    expect(isDevMode({ ELECTRON_DEV: "true" })).toBe(true);
    expect(isDevMode({}, ["--dev"])).toBe(true);
    expect(isDevMode({})).toBe(false);
    expect(isDevMode({}, [])).toBe(false);
  });

  it("loads the Vite dev server in dev and the in-process server in prod", () => {
    expect(resolveStartUrl({ ELECTRON_DEV: "1" }, "http://127.0.0.1:5000")).toBe(DEV_SERVER_URL);
    expect(resolveStartUrl({ ELECTRON_DEV: "1", ELECTRON_DEV_URL: "http://127.0.0.1:9999" }, "http://x")).toBe(
      "http://127.0.0.1:9999"
    );
    expect(resolveStartUrl({}, "http://127.0.0.1:5000")).toBe("http://127.0.0.1:5000");
  });

  it("serves the bundled client dir in prod and nothing in dev", () => {
    expect(resolveClientDir({}, "/app/dist-electron", path.posix.join)).toBe("/app/dist");
    expect(resolveClientDir({ ELECTRON_DEV: "1" }, "/app/dist-electron", path.posix.join)).toBeUndefined();
  });

  it("puts the vault under userData when packaged; env override and dev keep the default resolution", () => {
    // Packaged install → <userData>/vault (the install dir is not for user data).
    expect(resolveVaultRoot({}, true, "/Users/a/AppData/Roaming/Growte", path.posix.join)).toBe(
      "/Users/a/AppData/Roaming/Growte/vault"
    );
    // STUDY_VAULT_ROOT always wins — undefined defers to openVault's env resolution.
    expect(resolveVaultRoot({ STUDY_VAULT_ROOT: "D:/my-vault" }, true, "/x", path.posix.join)).toBeUndefined();
    // Unpackaged (dev / repo `npm run electron`) keeps the cwd-relative data/vault.
    expect(resolveVaultRoot({}, false, "/x", path.posix.join)).toBeUndefined();
  });
});
