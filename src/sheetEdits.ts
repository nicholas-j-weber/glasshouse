import type { Memory, Sheet } from "./types";

// Pure Sheet -> Sheet transforms for manual edits (add/edit/delete a
// memory, edit tone/conversation summary, pin/unpin). Each one is applied
// by the caller and then handed to store.createVersion — these functions
// don't touch storage themselves.

// checked before accepting an edit_memory/
// deactivate_memory suggestion, so an unmatched id fails visibly instead of
// silently no-opping while still showing "accepted".
export function memoryExists(sheet: Sheet, memoryId: string): boolean {
  return sheet.memories.some((m) => m.id === memoryId);
}

export function addMemory(sheet: Sheet, label: string, body: string, now: string): Sheet {
  const newMemory: Memory = {
    id: crypto.randomUUID(),
    label,
    body,
    pinRank: null,
    active: true,
    lastModified: now,
    provenance: { source: "manual" },
  };
  return { ...sheet, memories: [...sheet.memories, newMemory] };
}

export function editMemory(sheet: Sheet, memoryId: string, label: string, body: string, now: string): Sheet {
  return {
    ...sheet,
    memories: sheet.memories.map((m) => (m.id === memoryId ? { ...m, label, body, lastModified: now } : m)),
  };
}

export function deleteMemory(sheet: Sheet, memoryId: string): Sheet {
  return { ...sheet, memories: sheet.memories.filter((m) => m.id !== memoryId) };
}

export function nextPinRank(memories: Memory[]): number {
  const pinnedRanks = memories.filter((m) => m.pinRank !== null).map((m) => m.pinRank as number);
  return pinnedRanks.length > 0 ? Math.max(...pinnedRanks) + 1 : 0;
}

// Manual pin/unpin is treated as an immediate, version-worthy edit rather
// than folded into the session-only pin-reorder overlay (sheetOverlay.ts).
// The overlay's exemption is for "reordering pin priority without changing
// content" — reordering among already-pinned memories — which this UI pass
// doesn't implement (no drag-and-drop); assigning/clearing pinned status
// itself is treated as content-changing, matching how label/body edits work.
export function setPinned(sheet: Sheet, memoryId: string, pinned: boolean): Sheet {
  const pinRank = pinned ? nextPinRank(sheet.memories) : null;
  return {
    ...sheet,
    memories: sheet.memories.map((m) => (m.id === memoryId ? { ...m, pinRank } : m)),
  };
}

export function editFreeformNotes(sheet: Sheet, freeformNotes: string): Sheet {
  return { ...sheet, freeformNotes };
}

export function editTone(sheet: Sheet, body: string, now: string): Sheet {
  return { ...sheet, tone: { ...sheet.tone, body, lastModified: now } };
}

// a conversation turn is an ordinary memory with
// kind: "conversation_turn" and pinRank always null (turns are never
// pinned — see 5.1.3's rationale). This is what accepting a
// conversation_summary_update suggestion creates (mirroring how accepting
// new_memory works), and what manual "add a turn" in the sheet panel calls
// too. No number is stored in the body — it's computed at render time
// (serializer.ts's orderConversationTurns), so there's nothing here for the
// caller to track or increment, unlike the retired tracked-counter approach this replaced.
export function addConversationTurn(sheet: Sheet, body: string, now: string): Sheet {
  const newMemory: Memory = {
    id: crypto.randomUUID(),
    label: "Conversation Summary",
    body,
    pinRank: null,
    active: true,
    lastModified: now,
    kind: "conversation_turn",
    provenance: { source: "manual" },
  };
  return { ...sheet, memories: [...sheet.memories, newMemory] };
}
