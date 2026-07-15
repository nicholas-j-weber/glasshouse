import { formatSuggestionAsSourceBlock } from "./suggestionDisplay";
import type { SheetSuggestion } from "./types";

// Addendum E, 3.2: a revision's user message is a synthesized composite
// assembled client-side, not typed verbatim by the user — this is the
// exact shape it specifies.
export function buildRevisionMessage(suggestion: SheetSuggestion, revisionInstruction: string): string {
  return [
    "[Revising a previous suggestion]",
    `Original suggestion: ${formatSuggestionAsSourceBlock(suggestion)}`,
    `User's requested change: ${revisionInstruction}`,
  ].join("\n");
}
