import { describe, expect, it } from "vitest";
import {
  addConversationTurn,
  addMemory,
  deleteMemory,
  editFreeformNotes,
  editMemory,
  editTone,
  memoryExists,
  nextPinRank,
  setPinned,
} from "./sheetEdits";
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
    kind: overrides.kind,
  };
}

function makeSheet(memories: Memory[] = []): Sheet {
  return {
    tone: makeMemory({ id: "tone", label: "Tone", body: "Clear and direct." }),
    memories,
    freeformNotes: "",
  };
}

describe("addMemory", () => {
  it("appends a new active, unpinned, manually-provenanced memory", () => {
    const sheet = makeSheet();
    const result = addMemory(sheet, "New label", "New body", "2026-06-01T00:00:00.000Z");

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      label: "New label",
      body: "New body",
      pinRank: null,
      active: true,
      provenance: { source: "manual" },
    });
  });
});

describe("editMemory", () => {
  it("updates label, body, and lastModified for the matching memory only", () => {
    const sheet = makeSheet([makeMemory({ id: "m1", label: "Old" }), makeMemory({ id: "m2", label: "Other" })]);
    const result = editMemory(sheet, "m1", "New", "New body", "2026-06-01T00:00:00.000Z");

    expect(result.memories.find((m) => m.id === "m1")).toMatchObject({ label: "New", body: "New body" });
    expect(result.memories.find((m) => m.id === "m2")?.label).toBe("Other");
  });
});

describe("deleteMemory", () => {
  it("removes only the matching memory", () => {
    const sheet = makeSheet([makeMemory({ id: "m1" }), makeMemory({ id: "m2" })]);
    const result = deleteMemory(sheet, "m1");
    expect(result.memories.map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("memoryExists", () => {
  it("returns true when a memory with the given id is present", () => {
    const sheet = makeSheet([makeMemory({ id: "m1" })]);
    expect(memoryExists(sheet, "m1")).toBe(true);
  });

  it("returns false when no memory matches", () => {
    const sheet = makeSheet([makeMemory({ id: "m1" })]);
    expect(memoryExists(sheet, "hallucinated-id")).toBe(false);
  });
});

describe("nextPinRank", () => {
  it("returns 0 when nothing is pinned", () => {
    expect(nextPinRank([makeMemory({ pinRank: null })])).toBe(0);
  });

  it("returns one past the current max pinRank", () => {
    expect(nextPinRank([makeMemory({ pinRank: 2 }), makeMemory({ pinRank: 5 })])).toBe(6);
  });
});

describe("setPinned", () => {
  it("assigns the next pinRank when pinning", () => {
    const sheet = makeSheet([makeMemory({ id: "m1", pinRank: 3 }), makeMemory({ id: "m2", pinRank: null })]);
    const result = setPinned(sheet, "m2", true);
    expect(result.memories.find((m) => m.id === "m2")?.pinRank).toBe(4);
  });

  it("sets pinRank to null when unpinning", () => {
    const sheet = makeSheet([makeMemory({ id: "m1", pinRank: 3 })]);
    const result = setPinned(sheet, "m1", false);
    expect(result.memories.find((m) => m.id === "m1")?.pinRank).toBeNull();
  });
});

describe("editFreeformNotes / editTone", () => {
  it("each update only their own field", () => {
    const sheet = makeSheet();
    expect(editFreeformNotes(sheet, "Scratch note").freeformNotes).toBe("Scratch note");
    expect(editTone(sheet, "More casual", "2026-06-01T00:00:00.000Z").tone.body).toBe("More casual");
  });
});

describe("addConversationTurn", () => {
  it("appends a new memory tagged kind: conversation_turn, pinRank always null", () => {
    const sheet = makeSheet();
    const result = addConversationTurn(sheet, "User asked/said: Hi. AI replied: Hello.", "2026-06-01T00:00:00.000Z");

    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]).toMatchObject({
      kind: "conversation_turn",
      body: "User asked/said: Hi. AI replied: Hello.",
      pinRank: null,
      active: true,
      label: "Conversation Summary",
    });
  });

  it("leaves existing memories (including other turns) untouched", () => {
    const sheet = makeSheet([makeMemory({ id: "existing", kind: "conversation_turn", body: "Earlier turn" })]);
    const result = addConversationTurn(sheet, "New turn", "2026-06-01T00:00:00.000Z");

    expect(result.memories).toHaveLength(2);
    expect(result.memories.find((m) => m.id === "existing")?.body).toBe("Earlier turn");
  });
});
