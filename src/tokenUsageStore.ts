import type { ContextSheetDB } from "./db";
import { db as defaultDb } from "./db";
import { notifyUsageChanged } from "./usageSubscription";
import type { ProviderUsage } from "./providers/types";

// Same hygiene as store.ts's notifyIfDefaultDb / sheetsStore.ts's — only
// the app's single real database should notify subscribers, not the
// isolated instances tests construct.
function notifyIfDefaultDb(db: ContextSheetDB): void {
  if (db === defaultDb) notifyUsageChanged();
}

// records one real call's usage. Called immediately after any
// successful call that reported usage — the main chat/revision/sheet-editor
// call and the disambiguated follow-up call alike, all via the
// same shared call sites in suggestionSession.ts.
export async function recordUsage(
  sheetId: string,
  usage: ProviderUsage,
  db: ContextSheetDB = defaultDb,
): Promise<void> {
  await db.usage.add({
    id: crypto.randomUUID(),
    sheetId,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    createdAt: new Date().toISOString(),
  });
  notifyIfDefaultDb(db);
}

// the running total shown as "Tokens consumed" — the
// sum of every recorded call for this sheet, not a single stored counter.
export async function getTotalUsage(
  sheetId: string,
  db: ContextSheetDB = defaultDb,
): Promise<ProviderUsage> {
  const records = await db.usage.where("sheetId").equals(sheetId).toArray();
  return records.reduce(
    (total, record) => ({
      inputTokens: total.inputTokens + record.inputTokens,
      outputTokens: total.outputTokens + record.outputTokens,
    }),
    { inputTokens: 0, outputTokens: 0 },
  );
}
