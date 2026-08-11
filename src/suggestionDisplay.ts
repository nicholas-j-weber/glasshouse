import type { SheetSuggestion } from "./types";

// "the original suggestion... serialized the same way a
// Memory block would be." new_memory/edit_memory/tone_update map naturally
// onto that (`## Memory: <label>` / `## Tone` shape); the two
// overlay-only suggestion types (deactivate_memory, reorder_pins) predate this
// wording and have no memory-block analog, so they get a plain descriptive
// line instead.
export function formatSuggestionAsSourceBlock(suggestion: SheetSuggestion): string {
  switch (suggestion.type) {
    case "new_memory":
    case "edit_memory":
      return `## Memory: ${suggestion.label}\n${suggestion.body}`;
    case "tone_update":
      return `## Tone\n${suggestion.body}`;
    case "deactivate_memory":
      return `Deactivate memory ${suggestion.memoryId}: ${suggestion.reason}`;
    case "reorder_pins":
      return `Reorder pins: ${suggestion.pinOrder.join(", ")}`;
    case "conversation_summary_update":
      return `## Conversation Summary\n${suggestion.body}`;
    case "compress_conversation":
      return `## Conversation Summary (compressed, replacing turns: ${suggestion.turnIds.join(", ")})\n${suggestion.body}`;
  }
}
