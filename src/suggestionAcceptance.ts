import { memoryExists } from "./sheetEdits";
import type { CallMode } from "./systemPrompt";
import type {
  CompressConversationSuggestion,
  ConversationSummaryUpdateSuggestion,
  EditMemorySuggestion,
  Memory,
  NewMemorySuggestion,
  Provenance,
  Sheet,
  ToneUpdateSuggestion,
  VersionAttribution,
} from "./types";

// Pure logic for what accepting a suggestion produces, extracted out of
// suggestionSession.ts's handleAccept so the two concerns — "what does this
// suggestion resolve to" and "orchestrate the call/state around applying
// it" — are independently readable and independently testable. No React,
// no store, no side effects: everything here is a plain function from
// current state + a suggestion to the resulting Sheet(s).

export interface ResolvedAttribution {
  attribution: VersionAttribution;
  provenance: Provenance;
}

// Addendum Q, 6.2.16: a fallback entry wasn't genuinely proposed by the
// model, so attributing it as ai_suggestion_accepted/ai_suggested would
// misrepresent its origin — recorded as a manual edit instead, the same
// category §4.1 already uses for direct manual edits, since the *decision*
// to add it was the user's even though the *text* wasn't authored by the
// model.
//
// Addendum Z: autoApplied distinguishes a version created without a manual
// accept click (chat mode's auto-apply-with-toast/undo) from one the user
// explicitly clicked Accept on — both are still genuinely AI-suggested
// content (provenance.source stays "ai_suggested" either way), but History
// should be able to say *how* a version came to exist, not just that it
// did. Defaults to false so every existing call site (including
// sheet_editor mode, which never auto-applies) is unaffected.
export function resolveAttribution(
  isFallback: boolean | undefined,
  mode: CallMode,
  messageId: string,
  sourceExcerpt: string | undefined,
  autoApplied = false,
): ResolvedAttribution {
  if (isFallback) {
    return {
      attribution: { kind: "manual_edit" },
      provenance: {
        source: "manual",
        sourceExcerpt: "Client-generated fallback — the model did not propose a conversation summary update for this exchange.",
      },
    };
  }
  if (autoApplied) {
    return {
      attribution: { kind: "ai_suggestion_auto_applied", chatMessageId: messageId },
      provenance: { source: "ai_suggested", chatMessageId: messageId, sourceExcerpt },
    };
  }
  return mode === "chat"
    ? {
        attribution: { kind: "ai_suggestion_accepted", chatMessageId: messageId },
        provenance: { source: "ai_suggested", chatMessageId: messageId, sourceExcerpt },
      }
    : {
        attribution: { kind: "sheet_editor_session", sheetEditorSessionId: messageId },
        provenance: { source: "ai_suggested", sheetEditorSessionId: messageId, sourceExcerpt },
      };
}

// Addendum T, 4.5: which independent version chain a content-changing
// suggestion's result belongs to. Overlay-only types (deactivate_memory,
// reorder_pins) never reach this — they never touch a chain at all (§4.2).
export type MemoryChain = "local" | "global";

export interface ResolvedContentChange {
  chain: MemoryChain;
  sheet: Sheet;
}

// The suggestion types that produce a version (as opposed to
// deactivate_memory/reorder_pins, which are overlay-only).
export type ContentChangeSuggestion =
  | NewMemorySuggestion
  | EditMemorySuggestion
  | ToneUpdateSuggestion
  | ConversationSummaryUpdateSuggestion
  | CompressConversationSuggestion;

function withEditedMemory(sheet: Sheet, suggestion: EditMemorySuggestion, now: string): Sheet {
  return {
    ...sheet,
    memories: sheet.memories.map((m) =>
      m.id === suggestion.memoryId ? { ...m, label: suggestion.label, body: suggestion.body, lastModified: now } : m,
    ),
  };
}

// Resolves an accepted content-changing suggestion into the Sheet it
// produces and which chain that Sheet belongs to. Returns null only for
// edit_memory targeting an id in neither pool (Addendum H, 6.2.7: the
// caller surfaces this as "failed", not a silent no-op) — every other
// suggestion type always has a fixed target and can't fail this way.
export function resolveContentChange(
  suggestion: ContentChangeSuggestion,
  localSheet: Sheet,
  globalSheet: Sheet,
  provenance: Provenance,
  now: string,
): ResolvedContentChange | null {
  switch (suggestion.type) {
    case "new_memory": {
      // Addendum T: an ordinary memory always targets the global pool.
      const newMemory: Memory = {
        id: crypto.randomUUID(),
        label: suggestion.label,
        body: suggestion.body,
        pinRank: null,
        active: true,
        lastModified: now,
        provenance,
      };
      return { chain: "global", sheet: { ...globalSheet, memories: [...globalSheet.memories, newMemory] } };
    }
    case "tone_update":
      // Tone always targets the local (per-sheet) chain.
      return {
        chain: "local",
        sheet: { ...localSheet, tone: { ...localSheet.tone, body: suggestion.body, lastModified: now } },
      };
    case "conversation_summary_update": {
      // Addendum O, 6.2.15: creates a new Memory with kind:
      // "conversation_turn", mirroring new_memory — the number shown to the
      // model/user is computed at render time (serializer.ts), never
      // stored. Addendum T: conversation turns stay in the local chain.
      const newTurn: Memory = {
        id: crypto.randomUUID(),
        label: "Conversation Summary",
        body: suggestion.body,
        pinRank: null,
        active: true,
        lastModified: now,
        kind: "conversation_turn",
        provenance,
      };
      return { chain: "local", sheet: { ...localSheet, memories: [...localSheet.memories, newTurn] } };
    }
    case "compress_conversation": {
      // Addendum AL, Addendum H-style: fail visibly (null) rather than
      // silently adding a "summary" of nothing if every named turnId has
      // already vanished (deleted, or from a stale/earlier state of the
      // sheet) — same posture edit_memory already has for an unmatched id.
      // A partial match (some turnIds gone, some not) still proceeds with
      // whichever are found; there's no established precedent in this app
      // for rejecting a whole batch over one stale id in it.
      //
      // Addendum AS: matches "summary" turnIds too, not just
      // "conversation_turn" — without this, an *existing* summary could
      // never itself be folded into a new, larger one, so repeated
      // compression over a long conversation only ever caught turns added
      // since the last pass, leaving every prior summary permanently
      // stranded and accumulating instead of consolidating. The new
      // summary this produces is a fresh Memory with its own id (never the
      // same id as anything it supersedes), so there's no risk of a
      // summary naming itself.
      const isCompressible = (m: Memory) => m.kind === "conversation_turn" || m.kind === "summary";
      const turnIdSet = new Set(suggestion.turnIds);
      const matchedAny = localSheet.memories.some((m) => turnIdSet.has(m.id) && isCompressible(m));
      if (!matchedAny) return null;

      const newSummary: Memory = {
        id: crypto.randomUUID(),
        label: "Conversation Summary",
        body: suggestion.body,
        pinRank: null,
        active: true,
        lastModified: now,
        kind: "summary",
        provenance,
      };
      // lastModified is deliberately left untouched on the deactivated
      // turns — flipping it to `now` would shift them to the *front* of
      // orderConversationTurns' chronological sort, misrepresenting when
      // they actually happened. Only active changes; they stay exactly
      // where they were, just dimmed (§2: inactive stays visible, excluded
      // from calls) — never deleted, same visible-and-reversible posture
      // as every other deactivation in this app.
      const updatedMemories = localSheet.memories.map((m) =>
        turnIdSet.has(m.id) && isCompressible(m) ? { ...m, active: false } : m,
      );
      return { chain: "local", sheet: { ...localSheet, memories: [...updatedMemories, newSummary] } };
    }
    case "edit_memory": {
      // Addendum T: could target either pool — Addendum O's "emergent
      // capability" of editing a conversation turn by id still works, so
      // route by checking which pool actually contains the id. A local
      // match requires kind === "conversation_turn", matching
      // globalMemories.ts's mergeMemoryPools filter — a stray legacy
      // ordinary memory left in local storage (Addendum T's "no migration"
      // decision) stays exactly as invisible/unreachable here as it is
      // everywhere else post-Addendum-T.
      const targetInLocal = localSheet.memories.find(
        (m) => m.id === suggestion.memoryId && m.kind === "conversation_turn",
      );
      if (targetInLocal) {
        return { chain: "local", sheet: withEditedMemory(localSheet, suggestion, now) };
      }
      if (memoryExists(globalSheet, suggestion.memoryId)) {
        return { chain: "global", sheet: withEditedMemory(globalSheet, suggestion, now) };
      }
      return null;
    }
  }
}
