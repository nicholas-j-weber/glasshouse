import { useEffect, useState } from "react";
import { getTotalUsage } from "./tokenUsageStore";
import { subscribeUsageChanged } from "./usageSubscription";
import type { ProviderUsage } from "./providers/types";

const ZERO_USAGE: ProviderUsage = { inputTokens: 0, outputTokens: 0 };

// Addendum V: reactive read of a sheet's running usage total, refreshing
// whenever any real call records usage anywhere in the app (recordUsage
// isn't scoped to "the currently active sheet," so this re-fetches rather
// than assuming the notification was for this particular sheetId — cheap,
// since it's just summing a typically-small table).
export function useTotalUsage(sheetId: string): ProviderUsage {
  const [total, setTotal] = useState<ProviderUsage>(ZERO_USAGE);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      const usage = await getTotalUsage(sheetId);
      if (!cancelled) setTotal(usage);
    }

    void refresh();
    const unsubscribe = subscribeUsageChanged(() => void refresh());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [sheetId]);

  return total;
}
