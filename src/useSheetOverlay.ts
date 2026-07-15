import { useEffect, useState } from "react";
import type { PendingOverlay } from "./sheetOverlay";
import { getOverlay, subscribeOverlay } from "./sheetOverlayStore";

export function useSheetOverlay(): PendingOverlay {
  const [overlay, setOverlayState] = useState<PendingOverlay>(getOverlay());

  useEffect(() => subscribeOverlay(() => setOverlayState(getOverlay())), []);

  return overlay;
}
