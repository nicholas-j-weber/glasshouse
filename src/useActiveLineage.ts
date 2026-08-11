import { subscribeHeadChanged } from "./subscriptions";
import { getActiveLineage } from "./store";
import type { Version } from "./types";
import { useSubscribedResource } from "./useSubscribedResource";

// "the current head and its ancestors" — reactive wrapper around
// store.getActiveLineage(), refreshing on the same notifications
// useHeadVersion listens for. Oldest first (skeleton first, head last),
// matching getActiveLineage's own ordering. Scoped by sheetId,
// re-fetching (and clearing to []) whenever it changes.
export function useActiveLineage(sheetId: string): Version[] {
  return useSubscribedResource(() => getActiveLineage(sheetId), subscribeHeadChanged, [sheetId], []);
}
