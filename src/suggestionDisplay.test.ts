import { describe, expect, it } from "vitest";
import { formatSuggestionAsSourceBlock } from "./suggestionDisplay";

describe("formatSuggestionAsSourceBlock", () => {
  it("renders new_memory and edit_memory as a Memory block", () => {
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
