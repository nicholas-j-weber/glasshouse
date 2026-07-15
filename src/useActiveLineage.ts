import { useEffect, useState } from "react";
import { subscribeHeadChanged } from "./headSubscription";
import { getActiveLineage } from "./store";
import type { Version } from "./types";

// "the current head and its ancestors" — reactive wrapper around
// store.getActiveLineage(), refreshing on the same notifications
// useHeadVersion listens for. Oldest first (skeleton first, head last),
// matching getActiveLineage's own ordering. Scoped by sheetId,
// re-fetching (and clearing to []) whenever it changes.
export function useActiveLineage(sheetId: string): Version[] {
  const [lineage, setLineage] = useState<Version[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLineage([]);

    async function refresh() {
      const versions = await getActiveLineage(sheetId);
      if (!cancelled) setLineage(versions);
    }

    void refresh();
    const unsubscribe = subscribeHeadChanged(() => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sheetId]);

  return lineage;
}
