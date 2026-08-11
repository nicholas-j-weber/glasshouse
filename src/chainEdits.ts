import type { ContextSheetDB } from "./db";
import { db as defaultDb } from "./db";
import { applyOverlay, type PendingOverlay } from "./sheetOverlay";
import { setOverlay } from "./sheetOverlayStore";
import { ensureInitialized, createVersion } from "./store";
import type { Memory, Sheet } from "./types";

// The persisting counterpart to sheetEdits.ts's pure Sheet -> Sheet
// transforms: read a chain's current head with the pending overlay folded
// in, apply one of those transforms, and commit the result as a new
// version. SheetPanel and LibraryModal both did this by hand — with their
// own commit/read pair each, identical apart from which chain they name —
// so the read-edit-commit cycle lives here once instead.
//
// Re-reads the head rather than using whatever the caller already rendered:
// a manual edit must build on the chain's actual current state, not a
// snapshot from whenever the component last re-rendered.
export async function editChain(
  sheetId: string,
  overlay: PendingOverlay,
  edit: (sheet: Sheet) => Sheet,
  db: ContextSheetDB = defaultDb,
): Promise<void> {
  const head = await ensureInitialized(sheetId, db);
  await createVersion(edit(applyOverlay(head.sheet, overlay)), { kind: "manual_edit" }, sheetId, db);

  // A full resetOverlay() here was a real bug: the overlay is shared across
  // both the local and global chains (sheetOverlayStore.ts), so wiping it
  // wholesale after writing only *this* chain silently drops a still-
  // pending toggle on the *other* chain's memory — e.g. deactivate a global
  // memory, then edit a local one, and the global toggle vanishes without
  // ever being baked into a version. Only clear the entries this chain's
  // own memories actually cover; anything left survives for that other
  // chain's own next edit to bake in instead.
  const idsInThisChain = new Set(head.sheet.memories.map((m) => m.id));
  setOverlay((prev) => ({
    activeOverrides: Object.fromEntries(Object.entries(prev.activeOverrides).filter(([id]) => !idsInThisChain.has(id))),
    pinReorder: prev.pinReorder?.some((id) => !idsInThisChain.has(id)) ? prev.pinReorder : null,
  }));
}

// Deliberately not an editChain call: a manual active/inactive toggle is
// session-only and never version-stamped on its own (sheetOverlay.ts), and
// it's pool-agnostic — the overlay doesn't care which chain a memory is on.
export function toggleMemoryActive(memory: Memory): void {
  setOverlay((prev) => ({
    ...prev,
    activeOverrides: { ...prev.activeOverrides, [memory.id]: !memory.active },
  }));
}
