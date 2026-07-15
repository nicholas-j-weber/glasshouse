import { useEffect, useState } from "react";
import { ensureActiveSheet, listSheets } from "./sheetsStore";
import { subscribeSheetsChanged } from "./sheetsSubscription";
import type { SheetMeta } from "./types";

// Addendum S, 8.4/8.5: reactive read of the sheets list and which one is
// active — refreshes on create/rename/delete/switch. activeSheetId is
// undefined only during the brief window before the first sheet is
// bootstrapped (mirrors useHeadVersion's undefined-until-ready).
export function useSheets(): { sheets: SheetMeta[]; activeSheetId: string | undefined } {
  const [sheets, setSheets] = useState<SheetMeta[]>([]);
  const [activeSheetId, setActiveSheetId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    // Two notifications can fire close together (e.g. ChatHeaderTitle's
    // fire-and-forget renameSheet immediately followed by a "+ New Chat"
    // click's createSheet) and their refresh() calls aren't guaranteed to
    // resolve in the order they started — real, reproducible race found
    // via e2e testing the auto-rename-on-create flow. Only ever apply the
    // result of the most recently *started* refresh, so an earlier call
    // that happens to resolve later can't overwrite newer state with stale
    // data.
    let latestRequestId = 0;

    async function refresh() {
      const requestId = ++latestRequestId;
      const activeId = await ensureActiveSheet();
      const list = await listSheets();
      if (!cancelled && requestId === latestRequestId) {
        setSheets(list);
        setActiveSheetId(activeId);
      }
    }

    void refresh();
    const unsubscribe = subscribeSheetsChanged(() => void refresh());

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { sheets, activeSheetId };
}
