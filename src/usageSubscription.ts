// pub-sub for "a usage record was added for some sheet" —
// mirrors headSubscription.ts's pattern, kept separate from it since usage
// accounting is an independent concern from version/head changes.

type Listener = () => void;

const listeners = new Set<Listener>();

export function notifyUsageChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeUsageChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
