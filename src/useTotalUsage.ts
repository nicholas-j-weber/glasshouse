import { getTotalUsage } from "./tokenUsageStore";
import { subscribeUsageChanged } from "./usageSubscription";
import type { ProviderUsage } from "./providers/types";
import { useSubscribedResource } from "./useSubscribedResource";

const ZERO_USAGE: ProviderUsage = { inputTokens: 0, outputTokens: 0 };

// reactive read of a sheet's running usage total, refreshing
// whenever any real call records usage anywhere in the app (recordUsage
// isn't scoped to "the currently active sheet," so this re-fetches rather
// than assuming the notification was for this particular sheetId — cheap,
// since it's just summing a typically-small table). Doesn't reset to
// ZERO_USAGE on a sheetId change the way useHeadVersion/useActiveLineage
// reset theirs — briefly showing the previous sheet's total for one
// refresh cycle is harmless here, unlike showing its head/lineage would be.
export function useTotalUsage(sheetId: string): ProviderUsage {
  return useSubscribedResource(() => getTotalUsage(sheetId), subscribeUsageChanged, [sheetId], ZERO_USAGE, false);
}
