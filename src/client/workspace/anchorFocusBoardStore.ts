// Anchor Focus board open-state — a tiny React-free store (the useSyncExternalStore idiom
// already used by i18n). It exists so the TopBar's "Anchor Focus" tab can OPEN the board
// while the board itself is mounted once at the shell level (like FloatingNoteEditor /
// GlobalSearch), WITHOUT threading a new field through WorkspaceContext (N3's contended
// domain — kept untouched). Session-scoped, never persisted: opening the board is a
// transient view choice, like the old one-anchor reveal it replaces.

import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export function setAnchorBoardOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function toggleAnchorBoard(): void {
  setAnchorBoardOpen(!open);
}

export function isAnchorBoardOpen(): boolean {
  return open;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAnchorBoardOpen(): boolean {
  return useSyncExternalStore(subscribe, isAnchorBoardOpen, isAnchorBoardOpen);
}
