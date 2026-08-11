import type { ContextSheetDB } from "./db";
import { db as defaultDb } from "./db";
import { getStoredActiveSheetId, setStoredActiveSheetId } from "./settingsStorage";
import { notifySheetsChanged } from "./subscriptions";
import { resetOverlay } from "./sheetOverlayStore";
import { ensureInitialized } from "./store";
import type { SheetMeta } from "./types";

// Same hygiene as store.ts's notifyIfDefaultDb: only the app's single real
// database should notify subscribers, not the isolated instances tests
// construct.
function notifyIfDefaultDb(db: ContextSheetDB): void {
  if (db === defaultDb) notifySheetsChanged();
}

export async function listSheets(db: ContextSheetDB = defaultDb): Promise<SheetMeta[]> {
  const sheets = await db.sheets.toArray();
  return sheets.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// inserts a SheetMeta row and its skeleton version (via
// store.ts's ensureInitialized, so skeleton-creation logic isn't
// duplicated), then makes it the active sheet.
export async function createSheet(name: string, db: ContextSheetDB = defaultDb): Promise<string> {
  const id = crypto.randomUUID();
  const meta: SheetMeta = { id, name: name.trim() || "Untitled Sheet", createdAt: new Date().toISOString() };
  await db.sheets.add(meta);
  await ensureInitialized(id, db);
  setStoredActiveSheetId(id);
  notifyIfDefaultDb(db);
  return id;
}

// bootstraps a default sheet if none exist yet, and
// resolves the active-sheet preference to something that actually exists —
// mirrors store.ts's ensureInitialized "never let there be nothing"
// guarantee, one level up (a sheet container, not just a version).
//
// Guarded against concurrent invocation: React StrictMode's dev-mode
// double-effect-invoke calls this twice back-to-back before the first
// call's writes land, and without this guard both calls would see zero
// sheets and each create their own "Sheet 1."
let bootstrapInFlight: Promise<string> | null = null;

export async function ensureActiveSheet(db: ContextSheetDB = defaultDb): Promise<string> {
  if (bootstrapInFlight) return bootstrapInFlight;

  bootstrapInFlight = (async () => {
    try {
      const sheets = await listSheets(db);
      if (sheets.length === 0) {
        return await createSheet("Chat 1", db);
      }

      const stored = getStoredActiveSheetId();
      if (stored && sheets.some((s) => s.id === stored)) return stored;

      setStoredActiveSheetId(sheets[0].id);
      notifyIfDefaultDb(db);
      return sheets[0].id;
    } finally {
      bootstrapInFlight = null;
    }
  })();

  return bootstrapInFlight;
}

// updates the active-sheet preference and resets the
// shared PendingOverlay — deactivate/reorder toggles not
// yet folded into a version are scoped to whichever sheet is currently
// open and must not leak into a different sheet's memories. Doesn't take a
// db param — it never touches sheet data, only the local preference — so it
// always notifies (there's no "isolated test instance" concept for it to
// guard against).
export function switchSheet(sheetId: string): void {
  setStoredActiveSheetId(sheetId);
  resetOverlay();
  notifySheetsChanged();
}

// metadata only, not version-worthy — this isn't sheet
// content, and version-worthy changes are already limited to content.
export async function renameSheet(sheetId: string, name: string, db: ContextSheetDB = defaultDb): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  await db.sheets.update(sheetId, { name: trimmed });
  notifyIfDefaultDb(db);
}

// cascade-deletes every Version and persisted message
// scoped to this sheetId, plus its head row and its SheetMeta row, in one
// transaction. Genuinely irreversible — unlike reverting to a prior
// version (non-destructive), this is the first destructive action in
// this codebase; the caller (UI) is responsible for confirming with the
// user before calling this.
// also cascades to the sheet's usage records — nothing writes those anymore
// (the readout they fed is gone), but existing installs still hold rows from
// when it did, and those shouldn't outlive their sheet.
export async function deleteSheet(sheetId: string, db: ContextSheetDB = defaultDb): Promise<void> {
  const wasActive = getStoredActiveSheetId() === sheetId;

  await db.transaction("rw", db.sheets, db.versions, db.head, db.messages, db.usage, async () => {
    await db.versions.where("sheetId").equals(sheetId).delete();
    await db.messages.where("sheetId").equals(sheetId).delete();
    await db.usage.where("sheetId").equals(sheetId).delete();
    await db.head.delete(sheetId);
    await db.sheets.delete(sheetId);
  });

  if (wasActive) {
    resetOverlay();
    await ensureActiveSheet(db); // falls back to another sheet, or a fresh default if none remain
  }
  notifyIfDefaultDb(db);
}
