import Dexie, { type Table } from "dexie";
import type { PersistedMessage, SheetMeta, UsageRecord, Version } from "./types";

// Sheet data, including version history, persisted in IndexedDB
// (single local user, no accounts). Multiple independent sheets
// now coexist in the same database — still no sync, no collaboration.

export interface HeadRecord {
  // no longer a fixed "head" singleton — one row per sheet,
  // keyed by sheetId.
  id: string;
  versionId: string;
}

export class ContextSheetDB extends Dexie {
  sheets!: Table<SheetMeta, string>;
  versions!: Table<Version, string>;
  head!: Table<HeadRecord, string>;
  messages!: Table<PersistedMessage, string>;
  usage!: Table<UsageRecord, string>;

  constructor(name = "context-sheets") {
    super(name);
    this.version(1).stores({
      versions: "id, parentId",
      head: "id",
    });
    // adds multi-sheet support (sheets, messages) and scopes
    // versions/head by sheetId. Deliberately no migration: existing
    // versions/head rows predate sheetId entirely and
    // are disposable test data — the upgrade clears both tables outright
    // rather than backfilling a synthetic sheetId; ensureActiveSheet's
    // bootstrap then creates a fresh default sheet, indistinguishable from
    // a brand-new install.
    this.version(2)
      .stores({
        sheets: "id, createdAt",
        versions: "id, sheetId, parentId",
        head: "id",
        messages: "id, sheetId, createdAt",
      })
      .upgrade(async (tx) => {
        await tx.table("versions").clear();
        await tx.table("head").clear();
      });
    // adds the usage table. Purely additive — no existing
    // table's shape changes, so no upgrade()/migration is needed here,
    // unlike version 2's breaking change above.
    this.version(3).stores({
      sheets: "id, createdAt",
      versions: "id, sheetId, parentId",
      head: "id",
      messages: "id, sheetId, createdAt",
      usage: "id, sheetId, createdAt",
    });
  }
}

export const db = new ContextSheetDB();
