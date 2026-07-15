import type { Sheet } from "./types";

// §4.2 (active/inactive toggles) + Addendum A 4.2.1 (pin reorders): both are
// lightweight, instantly-reversible session state, never stamped into a
// Version on their own. They're folded into whichever version is created
// next (Addendum A 4.2.1) and discarded — not carried back — on revert
// (§4.4; no revert UI exists yet, so that path isn't wired here).
//
// Addendum C's Memory.active is a required field on every stored Sheet
// snapshot, which is the only way to reconcile "not version-stamped" (§4.2)
// with every Version needing *some* boolean there: a toggle lives here,
// outside the version chain, until a real content change bakes the current
// overlay into the next snapshot.
export interface PendingOverlay {
  // memoryId -> the active value the user has toggled it to this session.
  // A map (not a one-directional "deactivated" list) because a manual
  // toggle in the sheet panel can go either way, unlike a deactivate_memory
  // suggestion, which only ever asks to turn one off.
  activeOverrides: Record<string, boolean>;
  pinReorder: string[] | null; // Memory ids in new relative order, or null if none pending
}

export const EMPTY_OVERLAY: PendingOverlay = { activeOverrides: {}, pinReorder: null };

// Applies pending session state on top of a stored sheet — used both to
// serialize/display "the sheet right now" and, when a new version is about
// to be created, to bake the overlay into that version's snapshot.
export function applyOverlay(sheet: Sheet, overlay: PendingOverlay): Sheet {
  const hasActiveOverrides = Object.keys(overlay.activeOverrides).length > 0;
  if (!hasActiveOverrides && overlay.pinReorder === null) {
    return sheet;
  }

  const pinOrderIndex = new Map((overlay.pinReorder ?? []).map((id, index) => [id, index]));

  const memories = sheet.memories.map((memory) => {
    let updated = memory;
    if (memory.id in overlay.activeOverrides) {
      updated = { ...updated, active: overlay.activeOverrides[memory.id] };
    }
    if (pinOrderIndex.has(memory.id)) {
      // Addendum E 6.2.4: "Memory IDs omitted from pinOrder keep their
      // current pinRank" — only listed ids get reassigned, to their index
      // in the requested order.
      updated = { ...updated, pinRank: pinOrderIndex.get(memory.id) as number };
    }
    return updated;
  });

  return { ...sheet, memories };
}
