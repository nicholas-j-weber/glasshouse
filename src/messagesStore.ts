import type { ContextSheetDB } from "./db";
import { db as defaultDb } from "./db";
import type { SessionMessage } from "./suggestionSession";
import type { CallMode } from "./types";

// persisted chat log, scoped by sheet. A human-facing
// convenience only — statelessness is unaffected, nothing read here is
// ever reconstructed into a system prompt or a call payload.
//
// also scoped by mode (ChatPane's "chat" vs ManageWithAIPanel's
// "sheet_editor") — the two previously shared one undifferentiated log
// (filtered only by sheetId), so a pending suggestion from one leaked into
// the other's view. No compound index for this — message counts per sheet
// are small enough in this local PoC that filtering client-side after the
// indexed sheetId lookup is simpler than a schema/version bump.
export async function loadMessages(sheetId: string, mode: CallMode, db: ContextSheetDB = defaultDb): Promise<SessionMessage[]> {
  const rows = await db.messages
    .where("sheetId")
    .equals(sheetId)
    .and((m) => m.mode === mode)
    .sortBy("createdAt");
  return rows.map(({ sheetId: _sheetId, ...message }) => message);
}

// Upsert: called both when a message is first added and again whenever one
// of its suggestions' status changes (accepted/rejected/revised), so the
// stored row always reflects final state, not just the first snapshot.
export async function saveMessage(
  sheetId: string,
  message: SessionMessage,
  db: ContextSheetDB = defaultDb,
): Promise<void> {
  await db.messages.put({ ...message, sheetId });
}
