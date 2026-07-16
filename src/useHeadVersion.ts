import { subscribeHeadChanged } from "./headSubscription";
import { ensureInitialized, getHeadVersion } from "./store";
import type { Version } from "./types";
import { useSubscribedResource } from "./useSubscribedResource";

// Reactive read of the given sheet's current head — re-fetches whenever any
// store mutation (createVersion, revertToVersion, importSheet, first-run
// ensureInitialized) notifies via headSubscription.ts. undefined during the
// brief window before the skeleton is created, and again immediately after
// sheetId changes (switching sheets), so a stale previous
// sheet's head is never shown under the new sheetId.
//
// Only the very first fetch for a given sheetId goes through
// ensureInitialized (bootstrap-if-missing); every subsequent
// subscription-triggered refresh uses a plain getHeadVersion read instead.
// Tried making every refresh go through ensureInitialized, on the
// reasoning that it's a no-op read once the sheet already exists — broke a
// real scenario live (importing a file's global memory pool intermittently
// failed to show up): headSubscription's notifications are a single
// unscoped broadcast, so an unrelated sheet's import also wakes this
// hook's own subscription mid-way through the *target* sheet's own
// multi-step import, and re-running ensureInitialized on every one of
// those wake-ups reintroduces a bootstrap-vs-import write ordering hazard
// that a plain read doesn't have. `bootstrapped` is a plain local (not a
// ref) — recreated every render, but only the closure captured by
// whichever render's effect is currently mounted (i.e. since the last
// sheetId change) is ever actually called, so it still tracks "first
// fetch since this sheetId's effect started" correctly.
export function useHeadVersion(sheetId: string): Version | undefined {
  let bootstrapped = false;
  const fetchValue = async () => {
    if (bootstrapped) return getHeadVersion(sheetId);
    bootstrapped = true;
    return ensureInitialized(sheetId);
  };

  return useSubscribedResource(fetchValue, subscribeHeadChanged, [sheetId], undefined);
}
