// Minimal pub-sub primitive: notify() runs every subscribed listener,
// subscribe() registers one and returns its unsubscribe. Used by
// subscriptions.ts (head/sheets changes) and sheetOverlayStore.ts, each
// wrapping one in its own named notify/subscribe pair rather than exposing
// this generic shape directly.
export function createSignal() {
  const listeners = new Set<() => void>();
  return {
    notify(): void {
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
