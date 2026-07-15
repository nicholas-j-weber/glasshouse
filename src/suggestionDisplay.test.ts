import { describe, expect, it } from "vitest";
import { describeSuggestion, formatSuggestionAsSourceBlock } from "./suggestionDisplay";
import type { SheetSuggestion } from "./types";

describe("describeSuggestion", () => {
  const cases: Array<[SheetSuggestion, string]> = [
    [{ type: "new_memory", label: "Deadline", body: "July 10" }, "Deadline"],
    [{ type: "edit_memory", memoryId: "m1", label: "Deadline", body: "July 12" }, "m1"],
    [{ type: "tone_update", body: "More casual" }, "More casual"],
    [{ type: "deactivate_memory", memoryId: "m2", reason: "stale" }, "stale"],
    [{ type: "reorder_pins", pinOrder: ["m1", "m2"] }, "m1"],
    [{ type: "compress_conversation", body: "Condensed.", turnIds: ["t1", "t2"] }, "Condensed."],
  ];

  it.each(cases)("includes key content for %o", (suggestion, expectedSubstring) => {
    expect(describeSuggestion(suggestion)).toContain(expectedSubstring);
  });

  it("compress_conversation states how many turns it covers, singular vs. plural", () => {
    expect(describeSuggestion({ type: "compress_conversation", body: "X", turnIds: ["a", "b", "c"] })).toContain("3 conversation turns");
    expect(describeSuggestion({ type: "compress_conversation", body: "X", turnIds: ["a"] })).toContain("1 conversation turn ");
  });
});

describe("formatSuggestionAsSourceBlock", () => {
  it("renders new_memory and edit_memory as a Memory block (Addendum E 3.2)", () => {
    expect(formatSuggestionAsSourceBlock({ type: "new_memory", label: "Deadline", body: "July 10" })).toBe(
      "## Memory: Deadline\nJuly 10",
    );
    expect(
      formatSuggestionAsSourceBlock({ type: "edit_memory", memoryId: "m1", label: "Deadline", body: "July 12" }),
    ).toBe("## Memory: Deadline\nJuly 12");
  });

  it("renders tone_update under a Tone header", () => {
    expect(formatSuggestionAsSourceBlock({ type: "tone_update", body: "More casual" })).toBe(
      "## Tone\nMore casual",
    );
  });

  it("renders deactivate_memory and reorder_pins as plain descriptive lines", () => {
    expect(formatSuggestionAsSourceBlock({ type: "deactivate_memory", memoryId: "m2", reason: "stale" })).toBe(
      "Deactivate memory m2: stale",
    );
    expect(formatSuggestionAsSourceBlock({ type: "reorder_pins", pinOrder: ["m1", "m2"] })).toBe(
      "Reorder pins: m1, m2",
    );
  });

  it("renders compress_conversation under a Conversation Summary header, naming which turns it replaces", () => {
    const result = formatSuggestionAsSourceBlock({ type: "compress_conversation", body: "Condensed.", turnIds: ["t1", "t2"] });
    expect(result).toContain("## Conversation Summary");
    expect(result).toContain("t1, t2");
    expect(result).toContain("Condensed.");
  });
});
