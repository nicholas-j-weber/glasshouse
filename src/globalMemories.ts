import type { ContextSheetDB } from "./db";
import { db as defaultDb } from "./db";
import { exportSheet, importSheet } from "./store";
import type { Sheet, SheetExport } from "./types";

// Addendum T, 4.5: a reserved, non-user-visible sentinel id — never a real
// SheetMeta row, so it never appears in the sheet switcher (Addendum S
// 8.5). Reuses the exact same Version/head/versions machinery every real
// sheet already has, just keyed by this constant instead, which is what
// gives the global memory pool its own independent undo/revert history
// without any schema change.
export const GLOBAL_MEMORIES_SHEET_ID = "__global__";

// Addendum T, 5.1.4: merges a sheet's local content with the global memory
// pool for rendering/serialization. Local memories are filtered to
// conversation-turn (and, Addendum AL, summary) only — deliberate, not
// just forward-looking: it also hides any ordinary memory left over in
// local storage from before this addendum, rather than needing an explicit
// migration (Addendum T's "no migration" scope note).
export function mergeMemoryPools(localSheet: Sheet, globalSheet: Sheet): Sheet {
  return {
    ...localSheet,
    memories: [
      ...localSheet.memories.filter((m) => m.kind === "conversation_turn" || m.kind === "summary"),
      ...globalSheet.memories,
    ],
  };
}

// Addendum U, 8.3.2: exports a sheet's local chain and the global pool's
// chain together — store.ts's exportSheet stays an unchanged, single-chain
// primitive; this just calls it twice and combines the results, so a file
// "inspecting your own context outside the app" (§8.3) reflects everything
// the model actually saw, not just the sheet-local part of it.
export async function exportSheetWithGlobalPool(
  sheetId: string,
  db: ContextSheetDB = defaultDb,
): Promise<SheetExport> {
  const [local, global] = await Promise.all([exportSheet(sheetId, db), exportSheet(GLOBAL_MEMORIES_SHEET_ID, db)]);
  return {
    formatVersion: "1.1",
    headVersionId: local.headVersionId,
    versions: local.versions,
    globalHeadVersionId: global.headVersionId,
    globalVersions: global.versions,
  };
}

// Addendum U: imports the local chain unconditionally (same "replaces...
// with the imported one" semantics §8.3.1 always had). The global pool is
// only touched when the file actually has an opinion about it (a "1.1"
// file) — importing a "1.0" file must not wipe shared, cross-sheet data as
// a surprising side effect of a sheet-scoped action.
export async function importSheetWithGlobalPool(
  data: SheetExport,
  sheetId: string,
  db: ContextSheetDB = defaultDb,
): Promise<void> {
  await importSheet({ formatVersion: "1.0", headVersionId: data.headVersionId, versions: data.versions }, sheetId, db);

  if (data.formatVersion === "1.1" && data.globalHeadVersionId && data.globalVersions) {
    await importSheet(
      { formatVersion: "1.0", headVersionId: data.globalHeadVersionId, versions: data.globalVersions },
      GLOBAL_MEMORIES_SHEET_ID,
      db,
    );
  }
}
