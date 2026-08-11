import { useSyncExternalStore } from "react";
import type { PendingOverlay } from "./sheetOverlay";
import { getOverlay, subscribeOverlay } from "./sheetOverlayStore";

// sheetOverlayStore is exactly the shape useSyncExternalStore exists for —
// a subscribe/getSnapshot pair over module-level state outside React. It
// was hand-rolled as useState + useEffect before. getOverlay() returns the
// stored reference itself (setOverlay replaces it wholesale rather than
// mutating), which is the identity-stability this hook requires.
export function useSheetOverlay(): PendingOverlay {
  return useSyncExternalStore(subscribeOverlay, getOverlay);
}
