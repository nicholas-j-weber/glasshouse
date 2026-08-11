import Dexie, { type Table } from "dexie";
import type { PersistedMessage, RunLog, SheetMeta, StepRecord, UsageRecord, Version } from "./types";

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
  runs!: Table<RunLog, string>;
  runSteps!: Table<StepRecord, string>;

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
    // adds the Glasshouse pass tables (spec.md milestone 1):
    // reasoning-agent runs/steps and the code-diff version chain. Purely
    // additive, same no-migration reasoning as version 3.
    this.version(4).stores({
      sheets: "id, createdAt",
      versions: "id, sheetId, parentId",
      head: "id",
      messages: "id, sheetId, createdAt",
      usage: "id, sheetId, createdAt",
      runs: "runId, sheetId, chatMessageId",
      runSteps: "[runId+stepId], runId, role",
      codeVersions: "id, sheetId, parentId, chatMessageId",
      codeHead: "id",
    });
    // Removes the code-diff lane's tables — the "coding pass" feature
    // (proposed file changes as a separate versioned diff) was cut
    // entirely: a browser demo with no real filesystem/git to apply an
    // accepted diff to had no destination for it. Unlike version 3's usage
    // table (kept even after its own write path was later removed, since
    // existing installs might hold real rows worth cascading on sheet
    // delete), nothing here is worth preserving — no type or code anywhere
    // in the app still reads codeVersions/codeHead, so this drops them
    // outright via stores({...: null}) rather than leaving them as
    // orphaned tables no longer declared on the class above.
    this.version(5).stores({
      sheets: "id, createdAt",
      versions: "id, sheetId, parentId",
      head: "id",
      messages: "id, sheetId, createdAt",
      usage: "id, sheetId, createdAt",
      runs: "runId, sheetId, chatMessageId",
      runSteps: "[runId+stepId], runId, role",
      codeVersions: null,
      codeHead: null,
    });
  }
}

export const db = new ContextSheetDB();
