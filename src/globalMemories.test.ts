import { beforeEach, describe, expect, it } from "vitest";
import { ContextSheetDB } from "./db";
import {
  exportSheetWithGlobalPool,
  GLOBAL_MEMORIES_SHEET_ID,
  importSheetWithGlobalPool,
  mergeMemoryPools,
} from "./globalMemories";
import { createVersion, ensureInitialized, getHeadVersion } from "./store";
import type { Memory, Sheet } from "./types";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: crypto.randomUUID(),
    label: "L",
    body: "B",
    pinRank: null,
    active: true,
    lastModified: "2026-01-01T00:00:00.000Z",
    provenance: { source: "manual" },
    ...overrides,
  };
}

function makeSheet(memories: Memory[]): Sheet {
  return {
    tone: makeMemory({ label: "Tone", body: "Clear and direct." }),
    memories,
    freeformNotes: "",
  };
}

describe("mergeMemoryPools", () => {
  it("concatenates local conversation turns with global ordinary memories", () => {
    const turn = makeMemory({ kind: "conversation_turn", body: "turn 1" });
    const globalFact = makeMemory({ label: "Name", body: "Nicholas" });
    const merged = mergeMemoryPools(makeSheet([turn]), makeSheet([globalFact]));

    expect(merged.memories).toEqual([turn, globalFact]);
  });

  it("hides a stray ordinary memory left in local storage from before this addendum", () => {
    const strayLocalOrdinary = makeMemory({ label: "Old local fact", body: "should be invisible now" });
    const turn = makeMemory({ kind: "conversation_turn", body: "turn 1" });
    const merged = mergeMemoryPools(makeSheet([strayLocalOrdinary, turn]), makeSheet([]));

    expect(merged.memories).toEqual([turn]);
  });

  it("includes local kind: summary memories too, not just conversation turns (Addendum AL)", () => {
    const digest = makeMemory({ kind: "summary", body: "Condensed digest" });
    const turn = makeMemory({ kind: "conversation_turn", body: "turn 1" });
    const merged = mergeMemoryPools(makeSheet([digest, turn]), makeSheet([]));

    expect(merged.memories).toEqual([digest, turn]);
  });

  it("keeps the local sheet's tone and freeformNotes untouched", () => {
    const local = makeSheet([]);
    local.freeformNotes = "local notes";
    const merged = mergeMemoryPools(local, makeSheet([makeMemory()]));

    expect(merged.tone).toEqual(local.tone);
    expect(merged.freeformNotes).toBe("local notes");
  });

  it("returns an empty memories array when both pools are empty", () => {
    const merged = mergeMemoryPools(makeSheet([]), makeSheet([]));
    expect(merged.memories).toEqual([]);
  });
});

describe("exportSheetWithGlobalPool / importSheetWithGlobalPool (Addendum U)", () => {
  let db: ContextSheetDB;
  const sheetId = "sheet-1";

  beforeEach(() => {
    db = new ContextSheetDB(`test-${crypto.randomUUID()}`);
  });

  it("exports a 1.1 file with both the local and global lineages", async () => {
    const local = await ensureInitialized(sheetId, db);
    const global = await ensureInitialized(GLOBAL_MEMORIES_SHEET_ID, db);

    const exported = await exportSheetWithGlobalPool(sheetId, db);

    expect(exported.formatVersion).toBe("1.1");
    expect(exported.headVersionId).toBe(local.id);
    expect(exported.versions.map((v) => v.id)).toEqual([local.id]);
    expect(exported.globalHeadVersionId).toBe(global.id);
    expect(exported.globalVersions?.map((v) => v.id)).toEqual([global.id]);
  });

  it("round-trips a shared memory through export and import into a fresh database", async () => {
    const sourceDb = new ContextSheetDB(`test-source-${crypto.randomUUID()}`);
    await ensureInitialized(sheetId, sourceDb);
    const globalHead = await ensureInitialized(GLOBAL_MEMORIES_SHEET_ID, sourceDb);
    const sharedMemory: Memory = {
      id: crypto.randomUUID(),
      label: "Favorite Color",
      body: "Blue",
      pinRank: null,
      active: true,
      lastModified: "2026-01-01T00:00:00.000Z",
      provenance: { source: "manual" },
    };
    await createVersion(
      { ...globalHead.sheet, memories: [sharedMemory] },
      { kind: "manual_edit" },
      GLOBAL_MEMORIES_SHEET_ID,
      sourceDb,
    );
    const exported = await exportSheetWithGlobalPool(sheetId, sourceDb);

    await ensureInitialized(sheetId, db); // target db starts with unrelated pre-existing state
    await importSheetWithGlobalPool(exported, sheetId, db);

    const importedGlobalHead = await getHeadVersion(GLOBAL_MEMORIES_SHEET_ID, db);
    expect(importedGlobalHead?.sheet.memories).toEqual([sharedMemory]);
  });

  it("importing a 1.0 file replaces only the local chain, leaving the current global pool untouched", async () => {
    const globalHead = await ensureInitialized(GLOBAL_MEMORIES_SHEET_ID, db);
    const existingGlobalMemory: Memory = {
      id: crypto.randomUUID(),
      label: "Preexisting",
      body: "should survive a 1.0 import",
      pinRank: null,
      active: true,
      lastModified: "2026-01-01T00:00:00.000Z",
      provenance: { source: "manual" },
    };
    await createVersion(
      { ...globalHead.sheet, memories: [existingGlobalMemory] },
      { kind: "manual_edit" },
      GLOBAL_MEMORIES_SHEET_ID,
      db,
    );

    const localHead = await ensureInitialized(sheetId, db);
    const legacyExport = {
      formatVersion: "1.0" as const,
      headVersionId: localHead.id,
      versions: [localHead],
    };

    await importSheetWithGlobalPool(legacyExport, sheetId, db);

    const globalAfter = await getHeadVersion(GLOBAL_MEMORIES_SHEET_ID, db);
    expect(globalAfter?.sheet.memories).toEqual([existingGlobalMemory]);
  });
});
