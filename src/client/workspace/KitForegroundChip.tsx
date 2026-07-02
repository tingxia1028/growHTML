// KitForegroundChip — the document-level "识别为 · 更改" chip (subject-kits.md §3.6,
// milestone M-A): shows the active source's foreground kit AND how it was resolved
// (已固定 pin / 识别为 detected / 默认 default), with the winning detection's confidence
// + signals surfaced in the tooltip. A manual pick PINS the kit exactly the way the
// existing Product Kit <select> does (setActiveKit → metadata.activeKitIds); 自动
// clears the pin so detection takes over again. This is ComposerTypePicker's
// "detected · change" mental model one level up (note → document).
//
// Standalone + props-driven (jsdom-tested without the workspace tree): the resolution
// is DERIVED from the `source` prop through the pure foregroundForSource — the very
// resolver WorkspaceContext's activeKitIds useMemo rides — and every effect flows out
// through the two callbacks. No context import, no fetch.
//
// MOUNT (SC-1 gate): the designed home is views.tsx SourceViewerView's reader toolbar,
// which is reader-session-contended — the one-line mount is documented in
// docs/design/subject-kits.md §7 and lands with the reader-gated batch (roadmap).
// KitForegroundChipHost below is that one line's target: it binds the chip to the
// workspace ctx slice + the existing persistence seams.

import { useState } from "react";
import {
  CORE_KIT_ID,
  foregroundForSource,
  type ForegroundSourceLike
} from "../../kits/activation";
import { entityClient } from "../data/entityClient";

export type KitForegroundChipProps = {
  /** The active source (title/sourceType/metadata) — null renders nothing. */
  source: ForegroundSourceLike;
  /** Activation choices (WorkspaceContext.installedKits: id + display name). */
  kits: { id: string; name: string }[];
  /** A manual pick — pins the kit on this source (the existing setActiveKit contract:
      a kit id, or "core" to pin Core). */
  onPin(kitId: string): void;
  /** Clear the pin — back to auto (detection, else the workspace default). */
  onClearPin(): void;
};

export function KitForegroundChip({ source, kits, onPin, onClearPin }: KitForegroundChipProps) {
  const [picking, setPicking] = useState(false);
  if (!source) return null;

  const resolution = foregroundForSource(source);
  const currentId = resolution.kitIds[0] ?? CORE_KIT_ID;
  const currentName =
    currentId === CORE_KIT_ID ? "Core" : (kits.find((kit) => kit.id === currentId)?.name ?? currentId);

  if (picking) {
    return (
      <span className="kit-foreground-chip" data-mode={resolution.mode}>
        <select
          className="kit-chip-select"
          aria-label="Pin a Product Kit to this document"
          title="选择即固定到本文档（固定优先于自动识别）"
          value={currentId}
          onChange={(event) => {
            setPicking(false);
            onPin(event.target.value);
          }}
        >
          <option value={CORE_KIT_ID}>Core</option>
          {kits.map((kit) => (
            <option key={kit.id} value={kit.id}>
              {kit.name}
            </option>
          ))}
        </select>
        {resolution.mode === "pin" ? (
          <button
            type="button"
            className="link-button kit-chip-auto"
            title="清除固定，回到自动识别"
            onClick={() => {
              setPicking(false);
              onClearPin();
            }}
          >
            自动
          </button>
        ) : null}
      </span>
    );
  }

  const badge = resolution.mode === "pin" ? "已固定" : resolution.mode === "detected" ? "识别为" : "默认";
  // Explainability: the detected mode names its confidence + every fired signal.
  const explain = resolution.detection
    ? `识别置信度 ${resolution.detection.confidence.toFixed(2)} — ${resolution.detection.signals
        .map((signal) => `${signal.kind}: ${signal.value} (+${signal.points})`)
        .join(" · ")}`
    : resolution.mode === "pin"
      ? "此文档已固定该 Kit（手动选择优先于自动识别）"
      : "工作区默认 Kit（无固定、无识别命中）";

  return (
    <span className="kit-foreground-chip" data-mode={resolution.mode} title={explain}>
      <span className="kit-chip-label">
        {badge}: <strong>{currentName}</strong>
      </span>
      <button
        type="button"
        className="link-button kit-chip-change"
        title="更改本文档的 Kit（选择即固定）"
        onClick={() => setPicking(true)}
      >
        更改
      </button>
    </span>
  );
}

/**
 * The one-line mount adapter for the reader-gated batch (SC-1 pattern): binds the chip
 * to the workspace ctx slice it needs. Pinning reuses ctx.setActiveKit (the existing
 * metadata.activeKitIds write); clearing writes `activeKitIds: null` through the SAME
 * merge-patch endpoint — a non-array means "inherit" (activation.ts), so detection
 * takes over — then reloads sources so the useMemo foreground recomputes.
 */
export function KitForegroundChipHost({
  ctx
}: {
  ctx: {
    activeSource: ({ id: string } & NonNullable<ForegroundSourceLike>) | null;
    installedKits: { id: string; name: string }[];
    setActiveKit(kitId: string): Promise<void>;
    loadSources(): Promise<void>;
  };
}) {
  const { activeSource } = ctx;
  return (
    <KitForegroundChip
      source={activeSource}
      kits={ctx.installedKits}
      onPin={(kitId) => void ctx.setActiveKit(kitId)}
      onClearPin={() => {
        if (!activeSource) return;
        void entityClient
          .updateSourceMetadata(activeSource.id, { activeKitIds: null })
          .then(() => ctx.loadSources())
          // A failed clear leaves the pin in place; the next open re-reads the truth.
          .catch(() => undefined);
      }}
    />
  );
}
