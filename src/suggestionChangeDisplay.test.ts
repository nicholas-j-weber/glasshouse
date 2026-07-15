import { describe, expect, it } from "vitest";
import { describeSuggestionChange } from "./suggestionChangeDisplay";
import type { Memory, Sheet } from "./types";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "mem-1",
    label: "Favorite Color",
    body: "Blue",
    pinRank: null,
    active: true,
    lastModified: "2026-01-01T00:00:00.000Z",
    provenance: { source: "manual" },
    ...overrides,
  };
}

function makeSheet(memories: Memory[] = [], toneBody = "Clear and direct."): Sheet {
  return {
    tone: makeMemory({ id: "tone", label: "Tone", body: toneBody }),
    memories,
    freeformNotes: "",
  };
}

describe("describeSuggestionChange", () => {
  it("new_memory has no before, shows the proposed label/body as after", () => {
    const sheet = makeSheet();
    const result = describeSuggestionChange({ type: "new_memory", label: "Pet", body: "A cat named Milo" }, sheet);
    expect(result).toEqual({ title: "New memory", before: null, after: "Pet: A cat named Milo" });
  });

  it("edit_memory shows the existing memory's text as before when found", () => {
    const sheet = makeSheet([makeMemory({ id: "mem-1", label: "Favorite Color", body: "Blue" })]);
    const result = describeSuggestionChange(
      { type: "edit_memory", memoryId: "mem-1", label: "Favorite Color", body: "Teal" },
      sheet,
    );
    expect(result).toEqual({ title: "Edit memory", before: "Favorite Color: Blue", after: "Favorite Color: Teal" });
  });

  it("edit_memory has before: null when the memoryId doesn't resolve to anything", () => {
    const sheet = makeSheet([]);
    const result = describeSuggestionChange(
      { type: "edit_memory", memoryId: "missing-id", label: "X", body: "Y" },
      sheet,
    );
    expect(result.before).toBeNull();
    expect(result.after).toBe("X: Y");
  });

  it("tone_update shows the current tone body as before", () => {
    const sheet = makeSheet([], "Clear and direct.");
    const result = describeSuggestionChange({ type: "tone_update", body: "Warm and casual." }, sheet);
    expect(result).toEqual({ title: "Tone update", before: "Clear and direct.", after: "Warm and casual." });
  });

  it("tone_update has before: null when the current tone is empty", () => {
    const sheet = makeSheet([], "");
    const result = describeSuggestionChange({ type: "tone_update", body: "Warm and casual." }, sheet);
    expect(result.before).toBeNull();
  });

  it("deactivate_memory shows the existing memory as before and the reason as after", () => {
    const sheet = makeSheet([makeMemory({ id: "mem-1", label: "Old Job", body: "Worked at Acme" })]);
    const result = describeSuggestionChange(
      { type: "deactivate_memory", memoryId: "mem-1", reason: "No longer relevant" },
      sheet,
    );
    expect(result).toEqual({
      title: "Deactivate memory",
      before: "Old Job: Worked at Acme",
      after: "Deactivated — No longer relevant",
    });
  });

  it("reorder_pins shows current pin order (by pinRank) and the proposed order, both as labels", () => {
    const sheet = makeSheet([
      makeMemory({ id: "a", label: "Alpha", pinRank: 1 }),
      makeMemory({ id: "b", label: "Beta", pinRank: 0 }),
      makeMemory({ id: "c", label: "Gamma", pinRank: null }), // unpinned, excluded from "before"
    ]);
    const result = describeSuggestionChange({ type: "reorder_pins", pinOrder: ["a", "b"] }, sheet);
    expect(result.title).toBe("Reorder pins");
    expect(result.before).toBe("Beta → Alpha"); // ordered by pinRank ascending
    expect(result.after).toBe("Alpha → Beta");
  });

  it("reorder_pins has before: null when nothing is currently pinned", () => {
    const sheet = makeSheet([makeMemory({ id: "a", label: "Alpha", pinRank: null })]);
    const result = describeSuggestionChange({ type: "reorder_pins", pinOrder: ["a"] }, sheet);
    expect(result.before).toBeNull();
  });

  it("reorder_pins falls back to the raw id for a proposed pin that doesn't resolve to a memory", () => {
    const sheet = makeSheet([]);
    const result = describeSuggestionChange({ type: "reorder_pins", pinOrder: ["ghost-id"] }, sheet);
    expect(result.after).toBe("ghost-id");
  });

  it("conversation_summary_update has no before, shows the new turn as after", () => {
    const sheet = makeSheet();
    const result = describeSuggestionChange(
      { type: "conversation_summary_update", body: "User asked/said: hi. AI replied: hello." },
      sheet,
    );
    expect(result).toEqual({
      title: "New conversation turn",
      before: null,
      after: "User asked/said: hi. AI replied: hello.",
    });
  });

  it("compress_conversation shows the covered turns' text (joined) as before, the digest as after", () => {
    const sheet = makeSheet([
      makeMemory({ id: "t1", kind: "conversation_turn", label: "Conversation Summary", body: "Turn one" }),
      makeMemory({ id: "t2", kind: "conversation_turn", label: "Conversation Summary", body: "Turn two" }),
    ]);
    const result = describeSuggestionChange(
      { type: "compress_conversation", body: "Condensed digest.", turnIds: ["t1", "t2"] },
      sheet,
    );
    expect(result).toEqual({ title: "Compress conversation turns", before: "Turn one / Turn two", after: "Condensed digest." });
  });

  it("compress_conversation has before: null when none of the named turnIds resolve to anything", () => {
    const sheet = makeSheet();
    const result = describeSuggestionChange(
      { type: "compress_conversation", body: "Condensed.", turnIds: ["ghost"] },
      sheet,
    );
    expect(result.before).toBeNull();
  });
});
