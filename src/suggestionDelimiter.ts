// the fixed delimiter marking a SHEET_SUGGESTIONS block.
// Shared between systemPrompt.ts (instructs the model to emit it) and
// suggestionParser.ts (scans for it), so the two can't drift apart.
export const SUGGESTION_BLOCK_START = "<!-- SHEET_SUGGESTIONS";
export const SUGGESTION_BLOCK_END = "-->";
