import { ensureActiveSheet, listSheets } from "./sheetsStore";
import { subscribeSheetsChanged } from "./sheetsSubscription";
import type { SheetMeta } from "./types";
import { useSubscribedResource } from "./useSubscribedResource";

// reactive read of the sheets list and which one is
// active — refreshes on create/rename/delete/switch. activeSheetId is
// undefined only during the brief window before the first sheet is
// bootstrapped (mirrors useHeadVersion's undefined-until-ready). The
// latestRequestId guard inside useSubscribedResource is what this hook
// originally found the hard way: two notifications can fire close
// together (e.g. ChatHeaderTitle's fire-and-forget renameSheet
// immediately followed by a "+ New Chat" click's createSheet) and their
// refreshes aren't guaranteed to resolve in the order they started —
// real, reproducible race found via e2e testing the auto-rename-on-create
// flow.
export function useSheets(): { sheets: SheetMeta[]; activeSheetId: string | undefined } {
  return useSubscribedResource<{ sheets: SheetMeta[]; activeSheetId: string | undefined }>(
    async () => ({ activeSheetId: await ensureActiveSheet(), sheets: await listSheets() }),
    subscribeSheetsChanged,
    [],
    { sheets: [], activeSheetId: undefined },
    false,
  );
}
