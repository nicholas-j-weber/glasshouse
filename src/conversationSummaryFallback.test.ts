import { describe, expect, it } from "vitest";
import { buildFallbackConversationSummaryUpdate, hasConversationSummaryUpdate } from "./conversationSummaryFallback";
import type { ParsedModelResponse } from "./suggestionParser";

function parsed(suggestions: ParsedModelResponse["suggestions"] = []): ParsedModelResponse {
  return { conversationalText: "reply", suggestions };
}

describe("hasConversationSummaryUpdate", () => {
  it("returns false when there are no suggestions at all", () => {
    expect(hasConversationSummaryUpdate(parsed())).toBe(false);
  });

  it("returns false when suggestions exist but none is conversation_summary_update", () => {
    expect(hasConversationSummaryUpdate(parsed([{ type: "new_memory", label: "L", body: "B" }]))).toBe(false);
  });

  it("returns true when a conversation_summary_update is present among others", () => {
    expect(
      hasConversationSummaryUpdate(
        parsed([
          { type: "new_memory", label: "L", body: "B" },
          { type: "conversation_summary_update", body: "an entry" },
        ]),
      ),
    ).toBe(true);
  });
});

describe("buildFallbackConversationSummaryUpdate", () => {
  it("builds a conversation_summary_update in the expected format", () => {
    const result = buildFallbackConversationSummaryUpdate("What is AI?", "AI is...");
    expect(result).toEqual({
      type: "conversation_summary_update",
      body: "User asked/said: What is AI? AI replied: AI is...",
    });
  });

  it("truncates long text with an ellipsis rather than including it in full", () => {
    const longMessage = "a".repeat(200);
    const result = buildFallbackConversationSummaryUpdate(longMessage, "short reply");
    expect(result.body).toContain("…");
    expect(result.body.length).toBeLessThan(longMessage.length);
  });

  it("trims surrounding whitespace before truncating", () => {
    const result = buildFallbackConversationSummaryUpdate("  padded question  ", "  padded reply  ");
    expect(result.body).toBe("User asked/said: padded question AI replied: padded reply");
  });
});
