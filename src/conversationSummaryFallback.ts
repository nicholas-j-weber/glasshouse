import type { ParsedModelResponse } from "./suggestionParser";
import type { ConversationSummaryUpdateSuggestion } from "./types";

const EXCERPT_LENGTH = 100;

function truncate(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_LENGTH ? `${trimmed.slice(0, EXCERPT_LENGTH)}…` : trimmed;
}

export function hasConversationSummaryUpdate(parsed: ParsedModelResponse): boolean {
  return parsed.suggestions.some((s) => s.type === "conversation_summary_update");
}

// a client-synthesized fallback for when the model
// doesn't propose the mandatory conversation_summary_update
// itself — truncation, not summarization, since there's no model-authored
// compression to draw on when this path fires at all. Deliberately honest
// about being a lower-quality stand-in rather than pretending to be an
// AI-authored summary it isn't.
export function buildFallbackConversationSummaryUpdate(
  userMessage: string,
  aiReplyText: string,
): ConversationSummaryUpdateSuggestion {
  return {
    type: "conversation_summary_update",
    body: `User asked/said: ${truncate(userMessage)} AI replied: ${truncate(aiReplyText)}`,
  };
}
