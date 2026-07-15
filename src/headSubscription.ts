// Minimal pub-sub so UI surfaces (chat pane, sheet panel) can react when the
// store's head version changes, without pulling in a state-management
// library for what's otherwise a single IndexedDB-backed pointer.

type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyHeadChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeHeadChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
