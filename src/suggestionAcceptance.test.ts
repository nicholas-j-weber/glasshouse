import { describe, expect, it } from "vitest";
import { resolveAttribution, resolveContentChange } from "./suggestionAcceptance";
import type { Memory, Sheet } from "./types";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: crypto.randomUUID(),
    label: "L",
    body: "B",
    pinRank: null,
    active: true,
    lastModified: "2026-01-01T00:00:00.000Z",
    provenance: { source: "manual" },
    ...overrides,
  };
}

function makeSheet(memories: Memory[] = []): Sheet {
  return {
    tone: makeMemory({ label: "Tone", body: "Clear and direct." }),
    memories,
    freeformNotes: "",
  };
}

const NOW = "2026-06-01T00:00:00.000Z";
const PROVENANCE = { source: "ai_suggested" as const, chatMessageId: "msg-1" };

describe("resolveAttribution", () => {
  it("returns manual_edit/manual for a fallback suggestion, regardless of mode", () => {
    const result = resolveAttribution(true, "chat", "msg-1", "excerpt");
    expect(result.attribution).toEqual({ kind: "manual_edit" });
    expect(result.provenance.source).toBe("manual");
  });

  it("returns ai_suggestion_accepted/ai_suggested with chatMessageId for chat mode", () => {
    const result = resolveAttribution(false, "chat", "msg-1", "excerpt");
    expect(result.attribution).toEqual({ kind: "ai_suggestion_accepted", chatMessageId: "msg-1" });
    expect(result.provenance).toEqual({ source: "ai_suggested", chatMessageId: "msg-1", sourceExcerpt: "excerpt" });
  });

  it("returns sheet_editor_session/ai_suggested with sheetEditorSessionId for sheet_editor mode", () => {
    const result = resolveAttribution(undefined, "sheet_editor", "msg-2", undefined);
    expect(result.attribution).toEqual({ kind: "sheet_editor_session", sheetEditorSessionId: "msg-2" });
    expect(result.provenance).toEqual({ source: "ai_suggested", sheetEditorSessionId: "msg-2", sourceExcerpt: undefined });
  });
});

describe("resolveContentChange", () => {
  it("new_memory always targets the global pool", () => {
    const local = makeSheet();
    const global = makeSheet();
    const result = resolveContentChange({ type: "new_memory", label: "L", body: "B" }, local, global, PROVENANCE, NOW);

    expect(result?.chain).toBe("global");
    expect(result?.sheet.memories).toHaveLength(1);
    expect(result?.sheet.memories[0]).toMatchObject({ label: "L", body: "B", provenance: PROVENANCE });
  });

  it("tone_update always targets the local sheet", () => {
    const local = makeSheet();
    const global = makeSheet();
    const result = resolveContentChange({ type: "tone_update", body: "Be terser" }, local, global, PROVENANCE, NOW);

    expect(result?.chain).toBe("local");
    expect(result?.sheet.tone.body).toBe("Be terser");
  });

  it("conversation_summary_update always targets the local sheet as a tagged turn", () => {
    const local = makeSheet();
    const global = makeSheet();
    const result = resolveContentChange(
      { type: "conversation_summary_update", body: "turn text" },
      local,
      global,
      PROVENANCE,
      NOW,
    );

    expect(result?.chain).toBe("local");
    expect(result?.sheet.memories[0]).toMatchObject({ kind: "conversation_turn", body: "turn text" });
  });

  it("edit_memory routes to local when the id is a local conversation turn", () => {
    const turn = makeMemory({ kind: "conversation_turn", body: "old" });
    const local = makeSheet([turn]);
    const global = makeSheet();
    const result = resolveContentChange(
      { type: "edit_memory", memoryId: turn.id, label: "L", body: "new" },
      local,
      global,
      PROVENANCE,
      NOW,
    );

    expect(result?.chain).toBe("local");
    expect(result?.sheet.memories[0].body).toBe("new");
  });

  it("edit_memory routes to global when the id is an ordinary global memory", () => {
    const fact = makeMemory({ body: "old fact" });
    const local = makeSheet();
    const global = makeSheet([fact]);
    const result = resolveContentChange(
      { type: "edit_memory", memoryId: fact.id, label: "L", body: "new fact" },
      local,
      global,
      PROVENANCE,
      NOW,
    );

    expect(result?.chain).toBe("global");
    expect(result?.sheet.memories[0].body).toBe("new fact");
  });

  it("edit_memory returns null when the id exists in neither pool", () => {
    const result = resolveContentChange(
      { type: "edit_memory", memoryId: "does-not-exist", label: "L", body: "new" },
      makeSheet(),
      makeSheet(),
      PROVENANCE,
      NOW,
    );

    expect(result).toBeNull();
  });

  it("edit_memory treats a stray non-turn memory in local storage as unreachable, matching mergeMemoryPools' filter", () => {
    // Per the "no migration" decision: a legacy ordinary memory left in
    // local storage is invisible everywhere else too — this must stay
    // consistent, not silently editable through a back door.
    const strayLocalOrdinary = makeMemory({ body: "old" }); // no kind: not a conversation turn
    const local = makeSheet([strayLocalOrdinary]);
    const global = makeSheet();
    const result = resolveContentChange(
      { type: "edit_memory", memoryId: strayLocalOrdinary.id, label: "L", body: "new" },
      local,
      global,
      PROVENANCE,
      NOW,
    );

    expect(result).toBeNull();
  });

  describe("compress_conversation", () => {
    it("adds a kind: summary memory and deactivates the named turns, atomically, on the local chain", () => {
      const t1 = makeMemory({ kind: "conversation_turn", body: "Turn one", lastModified: "2026-01-01T00:00:00.000Z" });
      const t2 = makeMemory({ kind: "conversation_turn", body: "Turn two", lastModified: "2026-02-01T00:00:00.000Z" });
      const local = makeSheet([t1, t2]);
      const global = makeSheet();

      const result = resolveContentChange(
        { type: "compress_conversation", body: "Condensed.", turnIds: [t1.id, t2.id] },
        local,
        global,
        PROVENANCE,
        NOW,
      );

      expect(result?.chain).toBe("local");
      const summary = result?.sheet.memories.find((m) => m.kind === "summary");
      expect(summary).toMatchObject({ body: "Condensed.", active: true, pinRank: null, provenance: PROVENANCE });
      expect(result?.sheet.memories.find((m) => m.id === t1.id)).toMatchObject({ active: false });
      expect(result?.sheet.memories.find((m) => m.id === t2.id)).toMatchObject({ active: false });
    });

    it("also matches and deactivates an existing summary named in turnIds, not just conversation_turns", () => {
      const priorSummary = makeMemory({ kind: "summary", body: "Old digest", lastModified: "2026-01-01T00:00:00.000Z" });
      const t1 = makeMemory({ kind: "conversation_turn", body: "New turn", lastModified: "2026-02-01T00:00:00.000Z" });
      const local = makeSheet([priorSummary, t1]);

      const result = resolveContentChange(
        { type: "compress_conversation", body: "Bigger merged digest.", turnIds: [priorSummary.id, t1.id] },
        local,
        makeSheet(),
        PROVENANCE,
        NOW,
      );

      expect(result?.sheet.memories.find((m) => m.id === priorSummary.id)).toMatchObject({ active: false });
      expect(result?.sheet.memories.find((m) => m.id === t1.id)).toMatchObject({ active: false });
      const newSummaries = result?.sheet.memories.filter((m) => m.kind === "summary" && m.active);
      expect(newSummaries).toHaveLength(1);
      expect(newSummaries?.[0]).toMatchObject({ body: "Bigger merged digest." });
    });

    it("succeeds on a turnIds list containing only an existing summary's id, with no plain turns at all", () => {
      const priorSummary = makeMemory({ kind: "summary", body: "Old digest" });
      const local = makeSheet([priorSummary]);

      const result = resolveContentChange(
        { type: "compress_conversation", body: "Re-condensed.", turnIds: [priorSummary.id] },
        local,
        makeSheet(),
        PROVENANCE,
        NOW,
      );

      expect(result?.sheet.memories.find((m) => m.id === priorSummary.id)).toMatchObject({ active: false });
    });

    it("doesn't touch lastModified on the deactivated turns — they keep their original chronological position", () => {
      const t1 = makeMemory({ kind: "conversation_turn", body: "Turn one", lastModified: "2026-01-01T00:00:00.000Z" });
      const local = makeSheet([t1]);
      const result = resolveContentChange(
        { type: "compress_conversation", body: "Condensed.", turnIds: [t1.id] },
        local,
        makeSheet(),
        PROVENANCE,
        NOW,
      );

      expect(result?.sheet.memories.find((m) => m.id === t1.id)?.lastModified).toBe("2026-01-01T00:00:00.000Z");
    });

    it("proceeds with whichever turnIds match when some are stale, rather than failing the whole batch", () => {
      const t1 = makeMemory({ kind: "conversation_turn", body: "Turn one" });
      const local = makeSheet([t1]);
      const result = resolveContentChange(
        { type: "compress_conversation", body: "Condensed.", turnIds: [t1.id, "does-not-exist"] },
        local,
        makeSheet(),
        PROVENANCE,
        NOW,
      );

      expect(result?.sheet.memories.find((m) => m.id === t1.id)).toMatchObject({ active: false });
      expect(result?.sheet.memories.find((m) => m.kind === "summary")).toMatchObject({ body: "Condensed." });
    });

    it("returns null (fails visibly) when none of the named turnIds match an existing turn", () => {
      const result = resolveContentChange(
        { type: "compress_conversation", body: "Condensed.", turnIds: ["ghost-1", "ghost-2"] },
        makeSheet(),
        makeSheet(),
        PROVENANCE,
        NOW,
      );

      expect(result).toBeNull();
    });

    it("won't match an ordinary (non-turn) memory even if a turnId happens to collide with its id", () => {
      const ordinary = makeMemory({ body: "Not a turn" }); // no kind
      const local = makeSheet([ordinary]);
      const result = resolveContentChange(
        { type: "compress_conversation", body: "Condensed.", turnIds: [ordinary.id] },
        local,
        makeSheet(),
        PROVENANCE,
        NOW,
      );

      expect(result).toBeNull();
    });
  });
});
