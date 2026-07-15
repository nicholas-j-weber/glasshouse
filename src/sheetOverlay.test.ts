import { describe, expect, it } from "vitest";
import { applyOverlay, EMPTY_OVERLAY } from "./sheetOverlay";
import type { Memory, Sheet } from "./types";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? "id",
    label: overrides.label ?? "Label",
    body: overrides.body ?? "Body",
    pinRank: overrides.pinRank ?? null,
    active: overrides.active ?? true,
    lastModified: overrides.lastModified ?? "2026-01-01T00:00:00.000Z",
    provenance: overrides.provenance ?? { source: "manual" },
  };
}

function makeSheet(memories: Memory[]): Sheet {
  return {
    tone: makeMemory({ id: "tone", label: "Tone", body: "Clear and direct." }),
    memories,
    freeformNotes: "",
  };
}

describe("applyOverlay", () => {
  it("returns the same sheet reference when the overlay is empty", () => {
    const sheet = makeSheet([makeMemory({ id: "m1" })]);
    expect(applyOverlay(sheet, EMPTY_OVERLAY)).toBe(sheet);
  });

  it("sets active per activeOverrides, leaves unmentioned memories untouched", () => {
    const sheet = makeSheet([makeMemory({ id: "m1" }), makeMemory({ id: "m2" })]);
    const result = applyOverlay(sheet, { activeOverrides: { m1: false }, pinReorder: null });

    expect(result.memories.find((m) => m.id === "m1")?.active).toBe(false);
    expect(result.memories.find((m) => m.id === "m2")?.active).toBe(true);
  });

  it("can override active in either direction (manual re-toggle, not just deactivation)", () => {
    const sheet = makeSheet([makeMemory({ id: "m1", active: false })]);
    const result = applyOverlay(sheet, { activeOverrides: { m1: true }, pinReorder: null });

    expect(result.memories.find((m) => m.id === "m1")?.active).toBe(true);
  });

  it("reassigns pinRank by index for memories named in pinReorder", () => {
    const sheet = makeSheet([
      makeMemory({ id: "m1", pinRank: 5 }),
      makeMemory({ id: "m2", pinRank: 1 }),
    ]);
    const result = applyOverlay(sheet, { activeOverrides: {}, pinReorder: ["m2", "m1"] });

    expect(result.memories.find((m) => m.id === "m2")?.pinRank).toBe(0);
    expect(result.memories.find((m) => m.id === "m1")?.pinRank).toBe(1);
  });

  it("leaves pinRank untouched for memories omitted from pinReorder", () => {
    const sheet = makeSheet([makeMemory({ id: "m1", pinRank: 3 }), makeMemory({ id: "m2", pinRank: null })]);
    const result = applyOverlay(sheet, { activeOverrides: {}, pinReorder: ["m1"] });

    expect(result.memories.find((m) => m.id === "m1")?.pinRank).toBe(0);
    expect(result.memories.find((m) => m.id === "m2")?.pinRank).toBeNull();
  });

  it("applies both an active override and a pin reorder together", () => {
    const sheet = makeSheet([
      makeMemory({ id: "m1", pinRank: 2 }),
      makeMemory({ id: "m2", active: true }),
    ]);
    const result = applyOverlay(sheet, { activeOverrides: { m2: false }, pinReorder: ["m1"] });

    expect(result.memories.find((m) => m.id === "m1")?.pinRank).toBe(0);
    expect(result.memories.find((m) => m.id === "m2")?.active).toBe(false);
  });
});
