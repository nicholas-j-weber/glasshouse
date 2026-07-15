import type { Memory, Sheet } from "./types";

// §5.1/§5.3: turns Sheet content into the delimited plain-text sections
// that make up part 2 of the system prompt (Addendum F, 3.3). Mode-agnostic
// and pure — knows nothing about preambles, suggestion instructions, or
// which surface (chat pane vs. sheet-editor) is about to send it.

// Addendum H, 5.3.2: the id is shown so the model can reference it in
// edit_memory/deactivate_memory suggestions (Addendum E 6.2.3 already
// assumed this was possible; it wasn't, until now).
function renderMemoryBlock(memory: Memory): string {
  return `## Memory: ${memory.label} (id: ${memory.id})\n${memory.body}`;
}

// §5.1's ordering rule (pinned by ascending rank, then unpinned by
// most-recently-modified-first) — exported separately from the active
// filter below, since the sheet panel needs the same order for *display*
// but must still show inactive memories (§2: "Inactive memories remain
// visible in the sheet but are excluded from the next API call").
// Addendum O: callers must pre-filter out kind: "conversation_turn"
// memories before calling this — those are ordered by orderConversationTurns
// instead, never by pinRank/recency.
export function orderMemoriesForDisplay(memories: Memory[]): Memory[] {
  const pinned = memories
    .filter((m) => m.pinRank !== null)
    .sort((a, b) => (a.pinRank as number) - (b.pinRank as number));

  const unpinned = memories
    .filter((m) => m.pinRank === null)
    .sort((a, b) => b.lastModified.localeCompare(a.lastModified));

  return [...pinned, ...unpinned];
}

// Addendum O, 5.1.3: conversation turns are ordered by their own
// lastModified, ascending (chronological) — the opposite direction from
// ordinary unpinned memories, and independent of pinRank entirely. This is
// what lets turns and ordinary memories share one array without their sort
// rules colliding. Returns all turns, active and inactive (§2: inactive
// stays visible in the sheet, just excluded from calls) — callers filter
// by .active themselves for serialization purposes.
export function orderConversationTurns(memories: Memory[]): Memory[] {
  return memories
    .filter((m) => m.kind === "conversation_turn")
    .sort((a, b) => a.lastModified.localeCompare(b.lastModified));
}

// Addendum AL: same chronological-by-lastModified rule as
// orderConversationTurns, kept as its own function (not folded into that
// one) since the two render into visually and semantically distinct
// sections — a digest covering many turns isn't itself one more turn.
export function orderSummaries(memories: Memory[]): Memory[] {
  return memories.filter((m) => m.kind === "summary").sort((a, b) => a.lastModified.localeCompare(b.lastModified));
}

function ordinaryMemories(memories: Memory[]): Memory[] {
  return memories.filter((m) => m.kind !== "conversation_turn" && m.kind !== "summary");
}

function orderedActiveMemories(memories: Memory[]): Memory[] {
  return orderMemoriesForDisplay(ordinaryMemories(memories).filter((m) => m.active));
}

// Addendum P (revises Addendum O 5.1.3's "omitted when empty" rule): the
// section is never omitted. Live testing found the mandatory
// conversation_summary_update (Addendum K) was reliably skipped exactly
// when this section was empty — the abstract preamble instruction alone
// wasn't a reliable enough anchor. A concrete example line, in the same
// format Addendum K already specifies, fixes it (confirmed by manually
// seeding a placeholder entry, which restored compliance).
const EMPTY_CONVERSATION_SUMMARY_PLACEHOLDER =
  '(No entries yet — your first conversation_summary_update will start the list, e.g. "1. User asked/said: ... AI replied: ...")';

// Addendum O, 5.1.3: renders the computed Conversation Summary block — a
// numbered list where the numbers are derived from sorted position, never
// stored (Addendum L's tracked counter is retired). Each line shows its
// memory id (same convention as renderMemoryBlock, Addendum H 5.3.2) so
// edit_memory/deactivate_memory can actually target a turn — without this,
// Addendum O's "emergent capability" claim would be unexercisable, since
// the model would have no id to reference.
//
// Addendum AL: active summaries render first, ahead of the numbered turns
// — a summary represents "everything condensed up to here," so it reads
// naturally as a prefix to whatever's still individually tracked after it.
// Turn numbers stay exactly as before (position within the still-active
// turns, nothing to do with how many summaries precede them) — compressing
// turns 1-8 into a summary just shrinks the active-turns array those
// numbers are computed from, it doesn't renumber anything.
function renderConversationSummaryBlock(memories: Memory[]): string {
  const activeSummaries = orderSummaries(memories).filter((m) => m.active);
  const activeTurns = orderConversationTurns(memories).filter((m) => m.active);
  if (activeSummaries.length === 0 && activeTurns.length === 0) {
    return `## Conversation Summary\n${EMPTY_CONVERSATION_SUMMARY_PLACEHOLDER}`;
  }

  const summaryLines = activeSummaries.map((memory) => `[Summary]: ${memory.body} (id: ${memory.id})`);
  const turnLines = activeTurns.map((memory, index) => `${index + 1}. ${memory.body} (id: ${memory.id})`);
  return `## Conversation Summary\n${[...summaryLines, ...turnLines].join("\n")}`;
}

export function serializeSheet(sheet: Sheet): string {
  const sections: string[] = [];

  // Tone (§6.4) is always active and always present; its section is never omitted.
  sections.push(`## Tone\n${sheet.tone.body}`);

  sections.push(renderConversationSummaryBlock(sheet.memories));

  for (const memory of orderedActiveMemories(sheet.memories)) {
    sections.push(renderMemoryBlock(memory));
  }

  if (sheet.freeformNotes.trim().length > 0) {
    sections.push(`## Freeform Notes\n${sheet.freeformNotes}`);
  }

  return sections.join("\n\n");
}
