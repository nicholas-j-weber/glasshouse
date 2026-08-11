import { beforeEach, describe, expect, it } from "vitest";
import { editChain } from "./chainEdits";
import { ContextSheetDB } from "./db";
import { getOverlay, resetOverlay, setOverlay } from "./sheetOverlayStore";
import { createVersion, ensureInitialized, getHeadVersion } from "./store";
import type { Memory, Sheet } from "./types";

let db: ContextSheetDB;

beforeEach(() => {
  db = new ContextSheetDB(`test-${crypto.randomUUID()}`);
  resetOverlay();
});

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    label: overrides.label ?? "Label",
    body: overrides.body ?? "Body",
    pinRank: overrides.pinRank ?? null,
    active: overrides.active ?? true,
    lastModified: overrides.lastModified ?? "2026-01-01T00:00:00.000Z",
    provenance: overrides.provenance ?? { source: "manual" },
    kind: overrides.kind,
  };
}

async function seedChain(sheetId: string, memories: Memory[]): Promise<void> {
  const skeleton = await ensureInitialized(sheetId, db);
  const sheet: Sheet = { ...skeleton.sheet, memories };
  await createVersion(sheet, { kind: "manual_edit" }, sheetId, db);
}

describe("editChain", () => {
  it("clears only the overlay entries this chain's memories cover, leaving another chain's pending toggle intact", async () => {
    await seedChain("local", [makeMemory({ id: "turn-1", kind: "conversation_turn" })]);
    await seedChain("global", [makeMemory({ id: "mem-1" })]);

    setOverlay({ activeOverrides: { "turn-1": false, "mem-1": false }, pinReorder: null });

    await editChain("local", getOverlay(), (sheet) => sheet, db);

    // baked into the local version...
    const localHead = await getHeadVersion("local", db);
    expect(localHead?.sheet.memories.find((m) => m.id === "turn-1")?.active).toBe(false);

    // ...and cleared from the overlay, but "mem-1" (global, untouched by
    // this write) must survive to be baked in by its own chain's edit.
    expect(getOverlay().activeOverrides).toEqual({ "mem-1": false });
  });

  it("a later edit to the other chain bakes in and clears the remaining entry", async () => {
    await seedChain("local", [makeMemory({ id: "turn-1", kind: "conversation_turn" })]);
    await seedChain("global", [makeMemory({ id: "mem-1" })]);
    setOverlay({ activeOverrides: { "turn-1": false, "mem-1": false }, pinReorder: null });
    await editChain("local", getOverlay(), (sheet) => sheet, db);

    await editChain("global", getOverlay(), (sheet) => sheet, db);

    const globalHead = await getHeadVersion("global", db);
    expect(globalHead?.sheet.memories.find((m) => m.id === "mem-1")?.active).toBe(false);
    expect(getOverlay().activeOverrides).toEqual({});
  });

  it("preserves a pinReorder entirely outside this chain, but clears one entirely inside it", async () => {
    await seedChain("local", [makeMemory({ id: "turn-1", kind: "conversation_turn" })]);
    await seedChain("global", [makeMemory({ id: "mem-1", pinRank: 0 }), makeMemory({ id: "mem-2", pinRank: 1 })]);
    setOverlay({ activeOverrides: {}, pinReorder: ["mem-2", "mem-1"] });

    // Editing an unrelated chain (none of pinReorder's ids belong to it)
    // must not discard the still-pending global reorder.
    await editChain("local", getOverlay(), (sheet) => sheet, db);
    expect(getOverlay().pinReorder).toEqual(["mem-2", "mem-1"]);

    await editChain("global", getOverlay(), (sheet) => sheet, db);
    const globalHead = await getHeadVersion("global", db);
    expect(globalHead?.sheet.memories.find((m) => m.id === "mem-2")?.pinRank).toBe(0);
    expect(globalHead?.sheet.memories.find((m) => m.id === "mem-1")?.pinRank).toBe(1);
    expect(getOverlay().pinReorder).toBeNull();
  });
});
