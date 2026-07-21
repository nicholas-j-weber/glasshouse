// Minimal pub-sub primitive: notify() runs every subscribed listener,
// subscribe() registers one and returns its unsubscribe. Shared by
// headSubscription/sheetsSubscription/usageSubscription, each of which
// wraps one for its own named notify/subscribe pair rather than exposing
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
