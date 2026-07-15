import { useEffect, useState } from "react";
import { subscribeHeadChanged } from "./headSubscription";
import { ensureInitialized, getHeadVersion } from "./store";
import type { Version } from "./types";

// Reactive read of the given sheet's current head — re-fetches whenever any
// store mutation (createVersion, revertToVersion, importSheet, first-run
// ensureInitialized) notifies via headSubscription.ts. undefined during the
// brief window before the skeleton is created, and again immediately after
// sheetId changes (switching sheets), so a stale previous
// sheet's head is never shown under the new sheetId.
export function useHeadVersion(sheetId: string): Version | undefined {
  const [head, setHead] = useState<Version | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setHead(undefined);

    async function refresh() {
      const version = await getHeadVersion(sheetId);
      if (!cancelled) setHead(version);
    }

    ensureInitialized(sheetId).then((version) => {
      if (!cancelled) setHead(version);
    });

    const unsubscribe = subscribeHeadChanged(() => {
      void refresh();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sheetId]);

  return head;
}
