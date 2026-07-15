import { describe, expect, it } from "vitest";
import { buildSummaryFollowupUserMessage, extractSingleConversationSummaryUpdate } from "./conversationSummaryFollowup";
import type { ParsedModelResponse } from "./suggestionParser";

function parsed(suggestions: ParsedModelResponse["suggestions"] = []): ParsedModelResponse {
  return { conversationalText: "", suggestions };
}

describe("buildSummaryFollowupUserMessage", () => {
  it("includes both the user message and the AI reply", () => {
    const result = buildSummaryFollowupUserMessage("What is AI?", "AI is...");
    expect(result).toBe("User message: What is AI?\n\nAI reply: AI is...");
  });
});

describe("extractSingleConversationSummaryUpdate", () => {
  it("returns null when there are no suggestions", () => {
    expect(extractSingleConversationSummaryUpdate(parsed())).toBeNull();
  });

  it("returns null when suggestions exist but none is conversation_summary_update", () => {
    expect(extractSingleConversationSummaryUpdate(parsed([{ type: "new_memory", label: "L", body: "B" }]))).toBeNull();
  });

  it("returns the conversation_summary_update when present", () => {
    const suggestion = { type: "conversation_summary_update" as const, body: "an entry" };
    expect(extractSingleConversationSummaryUpdate(parsed([suggestion]))).toEqual(suggestion);
  });

  it("returns the conversation_summary_update even when other suggestions precede it", () => {
    const suggestion = { type: "conversation_summary_update" as const, body: "an entry" };
    expect(
      extractSingleConversationSummaryUpdate(parsed([{ type: "new_memory", label: "L", body: "B" }, suggestion])),
    ).toEqual(suggestion);
  });
});
