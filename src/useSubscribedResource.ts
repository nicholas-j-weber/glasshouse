import { useEffect, useState } from "react";

// Shared "subscribe to a store + async refresh" pattern used by
// useHeadVersion, useActiveLineage, useTotalUsage, and useSheets. Each
// independently reads from IndexedDB, then re-reads whenever the
// relevant store notifies a change (headSubscription/usageSubscription/
// sheetsSubscription) — and each independently needed a guard against two
// overlapping fetches resolving out of order: useSheets.ts originally
// found this the hard way (a real, e2e-reproduced race — an auto-rename's
// fire-and-forget refresh immediately followed by a "+ New Chat" click's
// refresh, not guaranteed to resolve in the order they started), fixed
// there with a `latestRequestId` counter, but never ported to the other
// three. Folding all four into this one hook applies that same guard
// everywhere uniformly, not just where the race happened to get noticed.
//
// resetOnDepsChange controls whether the value snaps back to
// initialValue the instant deps change (before the new fetch resolves) —
// useHeadVersion/useActiveLineage want this, so a stale previous sheet's
// data is never shown under a new sheetId; useTotalUsage/useSheets don't
// (either the number briefly being one sheet behind is harmless, or, for
// useSheets, deps never changes at all).
export function useSubscribedResource<T>(
  fetchValue: () => Promise<T>,
  subscribe: (onChange: () => void) => () => void,
  deps: unknown[],
  initialValue: T,
  resetOnDepsChange = true,
): T {
  const [value, setValue] = useState<T>(initialValue);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- deps is caller-supplied and intentionally dynamic; each call site already lists its own real dependencies there
  useEffect(() => {
    let cancelled = false;
    let latestRequestId = 0;
    if (resetOnDepsChange) setValue(initialValue);

    async function refresh() {
      const requestId = ++latestRequestId;
      const result = await fetchValue();
      if (!cancelled && requestId === latestRequestId) setValue(result);
    }

    void refresh();
    const unsubscribe = subscribe(() => void refresh());

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- not an array literal by design; deps is the caller's real dependency list, just passed through a variable
  }, deps);

  return value;
}
