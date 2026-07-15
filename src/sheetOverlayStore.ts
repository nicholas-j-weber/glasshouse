import { EMPTY_OVERLAY, type PendingOverlay } from "./sheetOverlay";

// A single module-level PendingOverlay shared by every UI surface (chat
// pane, sheet panel) — both accept suggestions and manual edits can toggle
// active state or propose a pin reorder, and both need to see the other's
// pending changes rather than maintaining independent, divergent overlays.

type Listener = () => void;

let current: PendingOverlay = EMPTY_OVERLAY;
const listeners = new Set<Listener>();

export function getOverlay(): PendingOverlay {
  return current;
}

export function setOverlay(next: PendingOverlay | ((prev: PendingOverlay) => PendingOverlay)): void {
  current = typeof next === "function" ? next(current) : next;
  for (const listener of listeners) listener();
}

export function resetOverlay(): void {
  setOverlay(EMPTY_OVERLAY);
}

export function subscribeOverlay(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
