// Settings section registry (SHELL-1, docs/design/app-shell-ux.md §1) — the additive
// seam that lets tracks land their settings panels WITHOUT touching the hub again
// (the recurring-capability principle; same module-scope registry idiom as the
// NoteType / provider / view registries). The hub renders `listSettingsSections()`
// in `order`; a section's render failure is isolated by the hub's error boundary.

import type { ReactNode } from "react";

export type SettingsSection = {
  /** Stable id (e.g. "ai-providers"). Re-registering the same id REPLACES it. */
  id: string;
  /** Section heading shown in the hub. */
  title: string;
  /** Sort key — lower renders first; ties break on id for a stable order. */
  order: number;
  /** The section body. Failures are caught per-section by the hub, never crash it. */
  render(): ReactNode;
};

const sections = new Map<string, SettingsSection>();

/** Register (or replace) a settings section. Idempotent per id — re-imports and
    re-installs must not duplicate (same motivation as registerProvider). */
export function registerSettingsSection(section: SettingsSection): void {
  sections.set(section.id, section);
}

/** All registered sections, sorted by order (then id — deterministic ties). */
export function listSettingsSections(): SettingsSection[] {
  return [...sections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Test seam: drop every registered section (module state survives re-imports). */
export function clearSettingsSectionsForTests(): void {
  sections.clear();
}
