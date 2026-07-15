import type { Memory, Sheet, SheetSuggestion } from "./types";

export interface SuggestionChangeDisplay {
  title: string;
  before: string | null;
  after: string;
}

function findMemory(sheet: Sheet, id: string): Memory | undefined {
  return sheet.memories.find((m) => m.id === id);
}

function memoryText(label: string, body: string): string {
  return `${label}: ${body}`;
}

// Renders a proposed change as a structured before/after pair for the
// "Manage with AI" modal's review cards — distinct from suggestionDisplay.ts's
// describeSuggestion, which produces one line for the main chat pane's inline
// suggestion list. A suggestion alone doesn't carry its "before" state (e.g.
// edit_memory only has the *proposed* new label/body) — this looks that up
// from the current sheet so the modal can show what's actually changing, not
// just what it's changing to. `before: null` means there's genuinely nothing
// to compare against (a brand-new memory/turn, or a referenced memory that no
// longer exists — the latter is surfaced separately via the suggestion's
// "failed" status, not by this function).
export function describeSuggestionChange(suggestion: SheetSuggestion, sheet: Sheet): SuggestionChangeDisplay {
  switch (suggestion.type) {
    case "new_memory":
      return { title: "New memory", before: null, after: memoryText(suggestion.label, suggestion.body) };

    case "edit_memory": {
      const existing = findMemory(sheet, suggestion.memoryId);
      return {
        title: "Edit memory",
        before: existing ? memoryText(existing.label, existing.body) : null,
        after: memoryText(suggestion.label, suggestion.body),
      };
    }

    case "tone_update":
      return { title: "Tone update", before: sheet.tone.body || null, after: suggestion.body };

    case "deactivate_memory": {
      const existing = findMemory(sheet, suggestion.memoryId);
      return {
        title: "Deactivate memory",
        before: existing ? memoryText(existing.label, existing.body) : null,
        after: `Deactivated — ${suggestion.reason}`,
      };
    }

    case "reorder_pins": {
      const currentOrder = sheet.memories
        .filter((m) => m.pinRank !== null)
        .sort((a, b) => (a.pinRank as number) - (b.pinRank as number))
        .map((m) => m.label);
      const proposedOrder = suggestion.pinOrder.map((id) => findMemory(sheet, id)?.label ?? id);
      return {
        title: "Reorder pins",
        before: currentOrder.length > 0 ? currentOrder.join(" → ") : null,
        after: proposedOrder.join(" → "),
      };
    }

    case "conversation_summary_update":
      return { title: "New conversation turn", before: null, after: suggestion.body };

    case "compress_conversation": {
      const coveredTurns = suggestion.turnIds
        .map((id) => findMemory(sheet, id))
        .filter((m): m is Memory => m !== undefined)
        .map((m) => m.body);
      return {
        title: "Compress conversation turns",
        before: coveredTurns.length > 0 ? coveredTurns.join(" / ") : null,
        after: suggestion.body,
      };
    }
  }
}
