import { describe, expect, it } from "vitest";
import { parseModelResponse } from "./suggestionParser";

describe("parseModelResponse", () => {
  it("returns the trimmed full text with no suggestions when no block is present", () => {
    const result = parseModelResponse("  Just a plain conversational reply.  ");
    expect(result).toEqual({ conversationalText: "Just a plain conversational reply.", suggestions: [] });
  });

  it("parses all six suggestion types (Addenda D, E, and I) from a well-formed block", () => {
    const raw = `Here's what I found.

<!-- SHEET_SUGGESTIONS
[
  {"type": "new_memory", "label": "Deadline", "body": "Ships July 10"},
  {"type": "edit_memory", "memoryId": "mem-1", "label": "Deadline", "body": "Ships July 12"},
  {"type": "tone_update", "body": "More casual"},
  {"type": "deactivate_memory", "memoryId": "mem-2", "reason": "No longer relevant"},
  {"type": "reorder_pins", "pinOrder": ["mem-1", "mem-3"]},
  {"type": "conversation_summary_update", "body": "1. User asked about X; I explained Y."}
]
-->`;

    const result = parseModelResponse(raw);
    expect(result.conversationalText).toBe("Here's what I found.");
    expect(result.suggestions).toEqual([
      { type: "new_memory", label: "Deadline", body: "Ships July 10" },
      { type: "edit_memory", memoryId: "mem-1", label: "Deadline", body: "Ships July 12" },
      { type: "tone_update", body: "More casual" },
      { type: "deactivate_memory", memoryId: "mem-2", reason: "No longer relevant" },
      { type: "reorder_pins", pinOrder: ["mem-1", "mem-3"] },
      { type: "conversation_summary_update", body: "1. User asked about X; I explained Y." },
    ]);
  });

  it("treats an empty suggestions array as valid (zero suggestions, not a parse failure)", () => {
    const raw = `No changes needed.\n\n<!-- SHEET_SUGGESTIONS\n[]\n-->`;
    const result = parseModelResponse(raw);
    expect(result).toEqual({ conversationalText: "No changes needed.", suggestions: [] });
  });

  it("discards the whole block on malformed JSON but keeps the preceding text", () => {
    const raw = `Reply text.\n\n<!-- SHEET_SUGGESTIONS\n[ this is not valid json \n-->`;
    const result = parseModelResponse(raw);
    expect(result).toEqual({ conversationalText: "Reply text.", suggestions: [] });
  });

  it("discards the whole block when the JSON payload isn't an array", () => {
    const raw = `Reply text.\n\n<!-- SHEET_SUGGESTIONS\n{"type": "new_memory", "label": "x", "body": "y"}\n-->`;
    const result = parseModelResponse(raw);
    expect(result).toEqual({ conversationalText: "Reply text.", suggestions: [] });
  });

  it("discards the whole block on an unrecognized type, not just the bad element", () => {
    const raw = `Reply text.

<!-- SHEET_SUGGESTIONS
[
  {"type": "new_memory", "label": "Good one", "body": "This one is valid"},
  {"type": "delete_everything", "memoryId": "mem-1"}
]
-->`;
    const result = parseModelResponse(raw);
    expect(result).toEqual({ conversationalText: "Reply text.", suggestions: [] });
  });

  it("discards the whole block when a recognized type is missing a required field", () => {
    const raw = `Reply text.\n\n<!-- SHEET_SUGGESTIONS\n[{"type": "tone_update"}]\n-->`;
    const result = parseModelResponse(raw);
    expect(result).toEqual({ conversationalText: "Reply text.", suggestions: [] });
  });

  it("discards an unterminated block (opened but never closed) and keeps the preceding text", () => {
    const raw = `Reply text.\n\n<!-- SHEET_SUGGESTIONS\n[{"type": "tone_update", "body": "x"}]`;
    const result = parseModelResponse(raw);
    expect(result).toEqual({ conversationalText: "Reply text.", suggestions: [] });
  });

  it("never throws, even on adversarial input", () => {
    expect(() => parseModelResponse("<!-- SHEET_SUGGESTIONS")).not.toThrow();
    expect(() => parseModelResponse("")).not.toThrow();
  });

  describe("compress_conversation", () => {
    it("parses a well-formed compress_conversation suggestion", () => {
      const raw = `Done.\n\n<!-- SHEET_SUGGESTIONS\n[{"type": "compress_conversation", "body": "Condensed.", "turnIds": ["t1", "t2"]}]\n-->`;
      const result = parseModelResponse(raw);
      expect(result.suggestions).toEqual([{ type: "compress_conversation", body: "Condensed.", turnIds: ["t1", "t2"] }]);
    });

    it("discards the whole block when turnIds is missing", () => {
      const raw = `Reply.\n\n<!-- SHEET_SUGGESTIONS\n[{"type": "compress_conversation", "body": "Condensed."}]\n-->`;
      expect(parseModelResponse(raw).suggestions).toEqual([]);
    });

    it("discards the whole block when turnIds isn't an array of strings", () => {
      const raw = `Reply.\n\n<!-- SHEET_SUGGESTIONS\n[{"type": "compress_conversation", "body": "Condensed.", "turnIds": "t1"}]\n-->`;
      expect(parseModelResponse(raw).suggestions).toEqual([]);
    });

    it("accepts an empty turnIds array as structurally valid (a semantic no-op is suggestionAcceptance's concern, not the parser's)", () => {
      const raw = `Reply.\n\n<!-- SHEET_SUGGESTIONS\n[{"type": "compress_conversation", "body": "Condensed.", "turnIds": []}]\n-->`;
      expect(parseModelResponse(raw).suggestions).toEqual([{ type: "compress_conversation", body: "Condensed.", turnIds: [] }]);
    });
  });
});
