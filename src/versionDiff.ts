import type { Memory, Sheet } from "./types";

// Addendum AQ: status and detail are kept separate (rather than one
// pre-joined string) so the renderer can bold the status word without it
// running straight into a turn's body text, which itself often starts with
// "User asked..." — visually indistinguishable from the status prefix when
// flattened into one string with no punctuation between them.
export interface VersionDiffLine {
  kind: "added" | "edited" | "deleted" | "tone" | "freeform-notes" | "none";
  status: string;
  detail?: string;
}

function memoryMap(memories: Memory[]): Map<string, Memory> {
  return new Map(memories.map((m) => [m.id, m]));
}

// Addendum O: every conversation-turn memory shares the same generic label
// ("Conversation Summary"), so "Added memory <label>" would be identical
// and unhelpful for every turn — use the entry text instead, so version
// history actually distinguishes one turn from another. Addendum AQ: a
// kind: "summary" memory (Addendum AL) shares that same generic label too,
// and the same fix applies for the same reason.
function memoryDiffLabel(memory: Memory): string {
  return memory.kind === "conversation_turn" || memory.kind === "summary" ? memory.body : `"${memory.label}"`;
}

// §4.3: "A rendered diff against its parent, computed and shown in the UI
// (not necessarily stored — can be computed on demand from two snapshots)."
// parent is null only for the very first version (§8.1's skeleton).
export function diffSheets(parent: Sheet | null, sheet: Sheet): VersionDiffLine[] {
  if (parent === null) {
    // "Context," not "sheet" — matches the app's own vocabulary elsewhere
    // (the Context panel, Export/Import Context) rather than the internal
    // Sheet type's name leaking into user-facing text.
    return [{ kind: "added", status: "Initial context" }];
  }

  const lines: VersionDiffLine[] = [];

  if (parent.tone.body !== sheet.tone.body) {
    lines.push({ kind: "tone", status: "Edited Tone" });
  }
  if (parent.freeformNotes !== sheet.freeformNotes) {
    lines.push({ kind: "freeform-notes", status: "Edited Freeform Notes" });
  }

  const parentMemories = memoryMap(parent.memories);
  const currentMemories = memoryMap(sheet.memories);

  for (const [id, memory] of currentMemories) {
    const before = parentMemories.get(id);
    if (!before) {
      lines.push({ kind: "added", status: "Added memory", detail: memoryDiffLabel(memory) });
    } else if (before.label !== memory.label || before.body !== memory.body) {
      lines.push({ kind: "edited", status: "Edited memory", detail: memoryDiffLabel(memory) });
    } else if (before.active !== memory.active) {
      lines.push({
        kind: "edited",
        status: memory.active ? "Reactivated memory" : "Deactivated memory",
        detail: memoryDiffLabel(memory),
      });
    } else if (before.pinRank !== memory.pinRank) {
      lines.push({ kind: "edited", status: "Changed pin for memory", detail: memoryDiffLabel(memory) });
    }
  }

  for (const [id, memory] of parentMemories) {
    if (!currentMemories.has(id)) {
      lines.push({ kind: "deleted", status: "Deleted memory", detail: memoryDiffLabel(memory) });
    }
  }

  if (lines.length === 0) {
    lines.push({ kind: "none", status: "No visible changes" });
  }

  return lines;
}
