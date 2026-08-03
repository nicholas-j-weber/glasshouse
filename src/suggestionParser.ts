import { SUGGESTION_BLOCK_END, SUGGESTION_BLOCK_START } from "./suggestionDelimiter";
import type {
  CodeChangeSuggestion,
  CompressConversationSuggestion,
  ConversationSummaryUpdateSuggestion,
  DeactivateMemorySuggestion,
  EditMemorySuggestion,
  NewMemorySuggestion,
  ReorderPinsSuggestion,
  SheetSuggestion,
  ToneUpdateSuggestion,
} from "./types";

export interface ParsedModelResponse {
  conversationalText: string;
  suggestions: SheetSuggestion[];
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.values(value).every(isString);
}

function validateSuggestion(candidate: unknown): SheetSuggestion | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const c = candidate as Record<string, unknown>;

  switch (c.type) {
    case "new_memory":
      return isString(c.label) && isString(c.body)
        ? ({ type: "new_memory", label: c.label, body: c.body } satisfies NewMemorySuggestion)
        : null;
    case "edit_memory":
      return isString(c.memoryId) && isString(c.label) && isString(c.body)
        ? ({
            type: "edit_memory",
            memoryId: c.memoryId,
            label: c.label,
            body: c.body,
          } satisfies EditMemorySuggestion)
        : null;
    case "tone_update":
      return isString(c.body) ? ({ type: "tone_update", body: c.body } satisfies ToneUpdateSuggestion) : null;
    case "deactivate_memory":
      return isString(c.memoryId) && isString(c.reason)
        ? ({
            type: "deactivate_memory",
            memoryId: c.memoryId,
            reason: c.reason,
          } satisfies DeactivateMemorySuggestion)
        : null;
    case "reorder_pins":
      return isStringArray(c.pinOrder)
        ? ({ type: "reorder_pins", pinOrder: c.pinOrder } satisfies ReorderPinsSuggestion)
        : null;
    case "conversation_summary_update":
      return isString(c.body)
        ? ({ type: "conversation_summary_update", body: c.body } satisfies ConversationSummaryUpdateSuggestion)
        : null;
    case "compress_conversation":
      return isString(c.body) && isStringArray(c.turnIds)
        ? ({ type: "compress_conversation", body: c.body, turnIds: c.turnIds } satisfies CompressConversationSuggestion)
        : null;
    case "code_change": {
      if (!isRecordOfStrings(c.files) || Object.keys(c.files).length === 0) return null;
      if (c.summary !== undefined && !isString(c.summary)) return null;
      return { type: "code_change", files: c.files, summary: c.summary } satisfies CodeChangeSuggestion;
    }
    default:
      return null;
  }
}

// parses a raw model response into conversational
// text plus zero or more structured suggestions. Per 6.2.2, a present-but-
// malformed block — invalid JSON, a non-array payload, or any element with
// an unrecognized type or missing field — is discarded as a whole ("the
// client discards only the suggestion block," not individual elements),
// while the conversational text preceding it is still returned. This is
// never a failed call in the ProviderError sense; losing a malformed suggestion is a
// visible-but-minor degradation, not an error.
export function parseModelResponse(raw: string): ParsedModelResponse {
  const startIndex = raw.indexOf(SUGGESTION_BLOCK_START);
  if (startIndex === -1) {
    return { conversationalText: raw.trim(), suggestions: [] };
  }

  const conversationalText = raw.slice(0, startIndex).trim();
  const afterStart = raw.slice(startIndex + SUGGESTION_BLOCK_START.length);
  const endIndex = afterStart.indexOf(SUGGESTION_BLOCK_END);
  if (endIndex === -1) {
    // Delimiter opened but never closed (e.g. a truncated response) —
    // treated the same as a malformed block: drop it, keep the text before it.
    return { conversationalText, suggestions: [] };
  }

  const jsonText = afterStart.slice(0, endIndex).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { conversationalText, suggestions: [] };
  }

  if (!Array.isArray(parsed)) {
    return { conversationalText, suggestions: [] };
  }

  const suggestions: SheetSuggestion[] = [];
  for (const item of parsed) {
    const validated = validateSuggestion(item);
    if (!validated) {
      return { conversationalText, suggestions: [] };
    }
    suggestions.push(validated);
  }

  return { conversationalText, suggestions };
}
