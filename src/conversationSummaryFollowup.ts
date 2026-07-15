import { SUGGESTION_BLOCK_END, SUGGESTION_BLOCK_START } from "./suggestionDelimiter";
import type { ParsedModelResponse } from "./suggestionParser";
import type { ConversationSummaryUpdateSuggestion } from "./types";

// a second, disambiguated stateless call, tried before
// falling back to truncation. Deliberately excludes the
// sheet and the rest of the suggestion menu — summarizing this one exchange
// is the model's only task here, which is far more reliable than hoping it
// shows up as one optional item in a general-purpose reply competing with
// everything else the main preamble asks for.
export const SUMMARY_FOLLOWUP_SYSTEM_PROMPT = `You will be shown one exchange from a conversation: a user's message and an AI assistant's reply to it. Your only task is to summarize this exchange as a single conversation_summary_update suggestion, using this exact format:

${SUGGESTION_BLOCK_START}
[{"type": "conversation_summary_update", "body": "User asked/said: <what the user asked or said>. AI replied: <what the assistant answered>."}]
${SUGGESTION_BLOCK_END}

Output nothing else — no conversational text, no other suggestion types, exactly one array element.`;

export function buildSummaryFollowupUserMessage(userMessage: string, aiReplyText: string): string {
  return `User message: ${userMessage}\n\nAI reply: ${aiReplyText}`;
}

export function extractSingleConversationSummaryUpdate(
  parsed: ParsedModelResponse,
): ConversationSummaryUpdateSuggestion | null {
  const match = parsed.suggestions.find(
    (s): s is ConversationSummaryUpdateSuggestion => s.type === "conversation_summary_update",
  );
  return match ?? null;
}
