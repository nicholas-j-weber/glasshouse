import { beforeEach, describe, expect, it } from "vitest";
import { ContextSheetDB } from "./db";
import {
  createVersion,
  ensureInitialized,
  exportSheet,
  getActiveLineage,
  getHeadVersion,
  importSheet,
  revertToVersion,
} from "./store";
import type { Sheet } from "./types";

let db: ContextSheetDB;
const sheetId = "sheet-1";

// Fresh, isolated IndexedDB database per test.
beforeEach(() => {
  db = new ContextSheetDB(`test-${crypto.randomUUID()}`);
});

function withFreeformNotes(sheet: Sheet, freeformNotes: string): Sheet {
  return { ...sheet, freeformNotes };
}

describe("ensureInitialized", () => {
  it("creates the §8.1 skeleton (default Tone, no memories — Addendum J/O) on first call", async () => {
    const version = await ensureInitialized(sheetId, db);

    expect(version.parentId).toBeNull();
    expect(version.sheetId).toBe(sheetId);
    expect(version.sheet.memories).toEqual([]);
    expect(version.sheet.tone.body).toContain("Clear and direct");
    expect(version.sheet.tone.active).toBe(true);
  });

  it("is idempotent — a second call returns the same head, not a new skeleton", async () => {
    const first = await ensureInitialized(sheetId, db);
    const second = await ensureInitialized(sheetId, db);
    expect(second.id).toBe(first.id);

    const versionCount = await db.versions.count();
    expect(versionCount).toBe(1);
  });

  it("keeps different sheets' skeletons fully independent", async () => {
    const a = await ensureInitialized("sheet-a", db);
    const b = await ensureInitialized("sheet-b", db);
    expect(a.id).not.toBe(b.id);
    expect(await db.versions.count()).toBe(2);
  });
});

describe("createVersion", () => {
  it("chains new versions off the current head", async () => {
    const skeleton = await ensureInitialized(sheetId, db);
    const v2 = await createVersion(withFreeformNotes(skeleton.sheet, "note 1"), { kind: "manual_edit" }, sheetId, db);
    const v3 = await createVersion(withFreeformNotes(skeleton.sheet, "note 2"), { kind: "manual_edit" }, sheetId, db);

    expect(v2.parentId).toBe(skeleton.id);
    expect(v3.parentId).toBe(v2.id);

    const head = await getHeadVersion(sheetId, db);
    expect(head?.id).toBe(v3.id);
  });

  it("stamps attribution exactly as given (Addendum A 4.1.1: one accept = one version)", async () => {
    const skeleton = await ensureInitialized(sheetId, db);
    const v2 = await createVersion(
      withFreeformNotes(skeleton.sheet, "note"),
      { kind: "ai_suggestion_accepted", chatMessageId: "msg-1" },
      sheetId,
      db,
    );
    expect(v2.attribution).toEqual({ kind: "ai_suggestion_accepted", chatMessageId: "msg-1" });
  });
});

describe("revertToVersion", () => {
  it("moves head back to N without deleting versions created after N", async () => {
    const v1 = await ensureInitialized(sheetId, db);
    const v2 = await createVersion(withFreeformNotes(v1.sheet, "note 1"), { kind: "manual_edit" }, sheetId, db);
    await createVersion(withFreeformNotes(v1.sheet, "note 2"), { kind: "manual_edit" }, sheetId, db);

    await revertToVersion(v2.id, sheetId, db);

    const head = await getHeadVersion(sheetId, db);
    expect(head?.id).toBe(v2.id);
    expect(await db.versions.count()).toBe(3); // nothing deleted
  });

  it("branches correctly: editing after a revert parents the new version on N, not on the old head", async () => {
    const v1 = await ensureInitialized(sheetId, db);
    const v2 = await createVersion(withFreeformNotes(v1.sheet, "note 1"), { kind: "manual_edit" }, sheetId, db);
    const oldHead = await createVersion(withFreeformNotes(v1.sheet, "note 2"), { kind: "manual_edit" }, sheetId, db);

    await revertToVersion(v2.id, sheetId, db);
    const v4 = await createVersion(withFreeformNotes(v1.sheet, "note 3"), { kind: "manual_edit" }, sheetId, db);

    expect(v4.parentId).toBe(v2.id);
    expect(v4.parentId).not.toBe(oldHead.id);

    // old branch is still in storage, just off the active line
    const lineage = await getActiveLineage(sheetId, db);
    expect(lineage.map((v) => v.id)).not.toContain(oldHead.id);
    expect(await db.versions.get(oldHead.id)).toBeDefined();
  });

  it("throws when reverting to an unknown version id", async () => {
    await ensureInitialized(sheetId, db);
    await expect(revertToVersion("does-not-exist", sheetId, db)).rejects.toThrow();
  });
});

describe("getActiveLineage", () => {
  it("returns the current head and its ancestors, oldest first", async () => {
    const v1 = await ensureInitialized(sheetId, db);
    const v2 = await createVersion(withFreeformNotes(v1.sheet, "note 1"), { kind: "manual_edit" }, sheetId, db);
    const v3 = await createVersion(withFreeformNotes(v1.sheet, "note 2"), { kind: "manual_edit" }, sheetId, db);

    const lineage = await getActiveLineage(sheetId, db);
    expect(lineage.map((v) => v.id)).toEqual([v1.id, v2.id, v3.id]);
  });
});

describe("backward compatibility with pre-Addendum-O data", () => {
  // Simulates a Version persisted with the old dedicated conversationSummary
  // field (Addendum I through the version just before Addendum O) — written
  // directly, bypassing createVersion, since nothing in current code can
  // construct a Sheet with that field anymore.
  async function seedLegacyVersion(id: string, conversationSummaryBody: string) {
    const legacySheet = {
      tone: {
        id: "tone",
        label: "Tone",
        body: "Clear and direct.",
        pinRank: 0,
        active: true,
        lastModified: "2026-01-01T00:00:00.000Z",
        provenance: { source: "manual" },
      },
      conversationSummary: {
        id: "legacy-cs",
        label: "Conversation Summary",
        body: conversationSummaryBody,
        pinRank: 0,
        active: true,
        lastModified: "2026-03-01T00:00:00.000Z",
        provenance: { source: "manual" },
      },
      memories: [],
      freeformNotes: "",
    };
    await db.versions.add({
      id,
      sheetId,
      parentId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      attribution: { kind: "manual_edit" },
      sheet: legacySheet,
    } as never);
    await db.head.put({ id: sheetId, versionId: id });
  }

  it("migrates legacy conversationSummary content into tagged memories, without crashing", async () => {
    await seedLegacyVersion(
      "legacy-v1",
      "1. User asked about X; I explained Y.\n2. User asked about Z; I explained W.",
    );

    const head = await getHeadVersion(sheetId, db);
    const turns = head?.sheet.memories.filter((m) => m.kind === "conversation_turn") ?? [];

    expect(turns).toHaveLength(2);
    expect(turns.map((t) => t.body)).toEqual([
      "User asked about X; I explained Y.",
      "User asked about Z; I explained W.",
    ]);
    // chronological order preserved via synthetic ascending timestamps
    expect(turns[0].lastModified.localeCompare(turns[1].lastModified)).toBeLessThan(0);
  });

  it("strips the stray field so it never gets carried into a newly-created real version", async () => {
    await seedLegacyVersion("legacy-v2", "1. Old turn.");
    const head = await getHeadVersion(sheetId, db);
    expect((head?.sheet as unknown as { conversationSummary?: unknown }).conversationSummary).toBeUndefined();
  });

  it("produces stable, deterministic ids across repeated reads of the same unmigrated version", async () => {
    await seedLegacyVersion("legacy-v3", "1. Turn one.\n2. Turn two.");

    const firstRead = await getHeadVersion(sheetId, db);
    const secondRead = await getHeadVersion(sheetId, db);

    const firstIds = firstRead?.sheet.memories.map((m) => m.id).sort();
    const secondIds = secondRead?.sheet.memories.map((m) => m.id).sort();
    expect(firstIds).toEqual(secondIds);
  });

  it("does not duplicate turns when a real version is created from migrated data", async () => {
    await seedLegacyVersion("legacy-v4", "1. Only turn.");
    const migratedHead = await ensureInitialized(sheetId, db); // reads current (migrated) head
    const newVersion = await createVersion(
      { ...migratedHead.sheet, freeformNotes: "triggered a real edit" },
      { kind: "manual_edit" },
      sheetId,
      db,
    );

    const turnsInNewVersion = newVersion.sheet.memories.filter((m) => m.kind === "conversation_turn");
    expect(turnsInNewVersion).toHaveLength(1);

    // Reading the new head again must not re-migrate/duplicate, since the
    // stray field was stripped before this version was ever persisted.
    const rereadHead = await getHeadVersion(sheetId, db);
    const turnsOnReread = rereadHead?.sheet.memories.filter((m) => m.kind === "conversation_turn") ?? [];
    expect(turnsOnReread).toHaveLength(1);
  });

  it("handles an empty legacy conversationSummary body with no migrated turns", async () => {
    await seedLegacyVersion("legacy-v5", "");
    const head = await getHeadVersion(sheetId, db);
    expect(head?.sheet.memories.filter((m) => m.kind === "conversation_turn")).toHaveLength(0);
  });
});

describe("export / import (§8.3.1)", () => {
  it("exports formatVersion, headVersionId, and only the active lineage", async () => {
    const v1 = await ensureInitialized(sheetId, db);
    const v2 = await createVersion(withFreeformNotes(v1.sheet, "note 1"), { kind: "manual_edit" }, sheetId, db);
    await createVersion(withFreeformNotes(v1.sheet, "note 2"), { kind: "manual_edit" }, sheetId, db);
    await revertToVersion(v2.id, sheetId, db); // strand the third version off the active line

    const exported = await exportSheet(sheetId, db);

    expect(exported.formatVersion).toBe("1.0");
    expect(exported.headVersionId).toBe(v2.id);
    expect(exported.versions.map((v) => v.id)).toEqual([v1.id, v2.id]);
  });

  it("import replaces the version chain and sets head to headVersionId", async () => {
    const sourceDb = new ContextSheetDB(`test-source-${crypto.randomUUID()}`);
    const v1 = await ensureInitialized(sheetId, sourceDb);
    await createVersion(withFreeformNotes(v1.sheet, "imported note"), { kind: "manual_edit" }, sheetId, sourceDb);
    const exported = await exportSheet(sheetId, sourceDb);

    // target db starts with unrelated pre-existing state
    await ensureInitialized(sheetId, db);

    await importSheet(exported, sheetId, db);

    const head = await getHeadVersion(sheetId, db);
    // Addendum AV: ids are freshly minted on import, no longer preserved —
    // assert on content/shape instead of the old (now-meaningless) id.
    expect(head?.sheet.freeformNotes).toBe("imported note");
    expect(await db.versions.count()).toBe(2);
  });

  it("does not disturb other sheets' versions in the same database", async () => {
    await ensureInitialized("sheet-other", db);
    const v1 = await ensureInitialized(sheetId, db);
    await createVersion(withFreeformNotes(v1.sheet, "note"), { kind: "manual_edit" }, sheetId, db);
    const exported = await exportSheet(sheetId, db);

    await importSheet(exported, sheetId, db);

    expect(await getHeadVersion("sheet-other", db)).toBeDefined();
    const lineage = await getActiveLineage(sheetId, db);
    expect(lineage).toHaveLength(2);
    expect(lineage[1].sheet.freeformNotes).toBe("note");
  });

  it("importing an export from one sheet into a different, still-existing sheet doesn't collide on version id (Addendum AV, fixes a confirmed real bug)", async () => {
    // The exact reported scenario: export a chat that still exists in the
    // database, then import that same file into a brand-new, different
    // chat — db.ts's versions store keys id table-wide, not per sheetId, so
    // reusing the file's original ids collided with the source sheet's own
    // still-present rows and threw ConstraintError on every version.
    const v1 = await ensureInitialized(sheetId, db);
    const v2 = await createVersion(withFreeformNotes(v1.sheet, "source note"), { kind: "manual_edit" }, sheetId, db);
    const exported = await exportSheet(sheetId, db);

    const newSheetId = "sheet-new-and-empty";
    await expect(importSheet(exported, newSheetId, db)).resolves.not.toThrow();

    const newHead = await getHeadVersion(newSheetId, db);
    expect(newHead?.sheet.freeformNotes).toBe("source note");
    // The original sheet is completely untouched — same ids it always had.
    const originalLineage = await getActiveLineage(sheetId, db);
    expect(originalLineage.map((v) => v.id)).toEqual([v1.id, v2.id]);
  });

  it("preserves parent/child lineage order through the id remap", async () => {
    const v1 = await ensureInitialized(sheetId, db);
    await createVersion(withFreeformNotes(v1.sheet, "middle"), { kind: "manual_edit" }, sheetId, db);
    const v3sheet = withFreeformNotes(v1.sheet, "last");
    await createVersion(v3sheet, { kind: "manual_edit" }, sheetId, db);
    const exported = await exportSheet(sheetId, db);

    const newSheetId = "sheet-new-2";
    await importSheet(exported, newSheetId, db);

    const lineage = await getActiveLineage(newSheetId, db);
    expect(lineage.map((v) => v.sheet.freeformNotes)).toEqual(["", "middle", "last"]);
    expect(lineage[1].parentId).toBe(lineage[0].id);
    expect(lineage[2].parentId).toBe(lineage[1].id);
  });

  it("stamps the target sheetId onto every imported version, even a pre-Addendum-S export with none", async () => {
    const legacyExport = {
      formatVersion: "1.0" as const,
      headVersionId: "legacy-head",
      versions: [
        {
          id: "legacy-head",
          parentId: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          attribution: { kind: "manual_edit" as const },
          sheet: { tone: { id: "t", label: "Tone", body: "x", pinRank: 0, active: true, lastModified: "2026-01-01T00:00:00.000Z", provenance: { source: "manual" as const } }, memories: [], freeformNotes: "" },
        },
      ],
    };

    await importSheet(legacyExport as never, sheetId, db);

    const head = await getHeadVersion(sheetId, db);
    expect(head?.sheetId).toBe(sheetId);
  });
});
