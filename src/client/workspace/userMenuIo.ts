// User-menu IO (SHELL-1) — the menu's two read edges behind the standard swappable
// seam (profileIo idiom): the local Tier-A svpack identity (display name) and the
// app version for the 关于 row. Both are fire-and-forget readouts: failures fall
// back to defaults (本地用户 / no version) and never surface as menu errors.

import { entityClient, type AboutInfo, type SvpackIdentityInfo } from "../data/entityClient";

export type UserMenuIo = {
  /** GET /api/svpack/identity — null when this device never published. */
  fetchIdentity(): Promise<SvpackIdentityInfo>;
  /** GET /api/about — app + version. */
  fetchAbout(): Promise<AboutInfo>;
};

const defaultIo: UserMenuIo = {
  fetchIdentity: () => entityClient.svpackIdentity(),
  fetchAbout: () => entityClient.about()
};

let io: UserMenuIo = defaultIo;

export function getUserMenuIo(): UserMenuIo {
  return io;
}

/** Test seam: override any subset of the IO edges (null restores the real ones). */
export function setUserMenuIoForTests(next: Partial<UserMenuIo> | null): void {
  io = next ? { ...defaultIo, ...next } : defaultIo;
}
