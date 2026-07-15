import { describe, expect, it } from "vitest";
import { orderConversationTurns, orderSummaries, serializeSheet } from "./serializer";
import type { Memory, Sheet } from "./types";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? "id",
    label: overrides.label ?? "Label",
    body: overrides.body ?? "Body",
    pinRank: overrides.pinRank ?? null,
    active: overrides.active ?? true,
    lastModified: overrides.lastModified ?? "2026-01-01T00:00:00.000Z",
    provenance: overrides.provenance ?? { source: "manual" },
    kind: overrides.kind,
  };
}

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    tone: overrides.tone ?? makeMemory({ id: "tone", label: "Tone", body: "Clear and direct." }),
    memories: overrides.memories ?? [],
    freeformNotes: overrides.freeformNotes ?? "",
  };
}

function turn(overrides: Partial<Memory> = {}): Memory {
  return makeMemory({ label: "Conversation Summary", kind: "conversation_turn", pinRank: null, ...overrides });
}

function summary(overrides: Partial<Memory> = {}): Memory {
  return makeMemory({ label: "Conversation Summary", kind: "summary", pinRank: null, ...overrides });
}

describe("serializeSheet", () => {
  it("always includes Tone, even on an otherwise-empty skeleton sheet", () => {
    const result = serializeSheet(makeSheet());
    expect(result).toContain("## Tone\nClear and direct.");
  });

  it("omits Freeform Notes when empty", () => {
    const result = serializeSheet(makeSheet({ freeformNotes: "" }));
    expect(result).not.toContain("Freeform Notes");
  });

  it("never omits Conversation Summary — shows a labeled example when there are no turns", () => {
    const result = serializeSheet(makeSheet());
    expect(result).toContain("## Conversation Summary");
    expect(result).toContain("No entries yet");
    expect(result).toContain('e.g. "1. User asked/said: ... AI replied: ..."');
  });

  it("includes Conversation Summary between Tone and Pinned Memories when turns are present", () => {
    const result = serializeSheet(
      makeSheet({
        memories: [
          turn({ id: "cs1", body: "User asked about X; I explained Y.", lastModified: "2026-01-01T00:00:00.000Z" }),
          makeMemory({ id: "m1", label: "Pinned fact", pinRank: 0 }),
        ],
      }),
    );
    const toneIndex = result.indexOf("## Tone");
    const summaryIndex = result.indexOf("## Conversation Summary");
    const memoryIndex = result.indexOf("## Memory: Pinned fact");

    expect(summaryIndex).toBeGreaterThan(toneIndex);
    expect(summaryIndex).toBeLessThan(memoryIndex);
    expect(result).toContain("1. User asked about X; I explained Y. (id: cs1)");
  });

  it("orders conversation turns chronologically (ascending), independent of pinRank", () => {
    const result = serializeSheet(
      makeSheet({
        memories: [
          turn({ id: "second", body: "Second turn", lastModified: "2026-06-01T00:00:00.000Z" }),
          turn({ id: "first", body: "First turn", lastModified: "2026-01-01T00:00:00.000Z" }),
        ],
      }),
    );
    expect(result).toContain("## Conversation Summary\n1. First turn (id: first)\n2. Second turn (id: second)");
  });

  it("excludes inactive conversation turns from the serialized block but keeps active ones numbered correctly", () => {
    const result = serializeSheet(
      makeSheet({
        memories: [
          turn({ id: "t1", body: "Turn one", lastModified: "2026-01-01T00:00:00.000Z" }),
          turn({ id: "t2", body: "Turn two (inactive)", lastModified: "2026-02-01T00:00:00.000Z", active: false }),
          turn({ id: "t3", body: "Turn three", lastModified: "2026-03-01T00:00:00.000Z" }),
        ],
      }),
    );
    expect(result).toContain("1. Turn one (id: t1)");
    expect(result).toContain("2. Turn three (id: t3)");
    expect(result).not.toContain("Turn two");
  });

  it("excludes conversation-turn memories from the ordinary Memory blocks section", () => {
    const result = serializeSheet(
      makeSheet({
        memories: [turn({ id: "t1", body: "A turn" }), makeMemory({ id: "m1", label: "Ordinary fact" })],
      }),
    );
    expect(result).not.toContain("## Memory: Conversation Summary");
    expect(result).toContain("## Memory: Ordinary fact");
  });

  it("includes Freeform Notes when non-empty, after Tone in the expected section order", () => {
    const result = serializeSheet(makeSheet({ freeformNotes: "Loose scratch note." }));
    const toneIndex = result.indexOf("## Tone");
    const notesIndex = result.indexOf("## Freeform Notes");

    expect(notesIndex).toBeGreaterThanOrEqual(0);
    expect(toneIndex).toBeLessThan(notesIndex);
  });

  it("orders pinned memories by ascending pinRank (lower = higher priority)", () => {
    const low = makeMemory({ id: "low", label: "Low priority pin", pinRank: 5 });
    const high = makeMemory({ id: "high", label: "High priority pin", pinRank: 1 });
    const result = serializeSheet(makeSheet({ memories: [low, high] }));

    expect(result.indexOf("High priority pin")).toBeLessThan(result.indexOf("Low priority pin"));
  });

  it("orders unpinned memories most-recently-modified-first", () => {
    const older = makeMemory({ id: "older", label: "Older", lastModified: "2026-01-01T00:00:00.000Z" });
    const newer = makeMemory({ id: "newer", label: "Newer", lastModified: "2026-06-01T00:00:00.000Z" });
    const result = serializeSheet(makeSheet({ memories: [older, newer] }));

    expect(result.indexOf("Newer")).toBeLessThan(result.indexOf("Older"));
  });

  it("places all pinned memories before all unpinned memories", () => {
    const pinned = makeMemory({ id: "pinned", label: "Pinned", pinRank: 1 });
    const unpinned = makeMemory({
      id: "unpinned",
      label: "Unpinned",
      pinRank: null,
      lastModified: "2026-12-01T00:00:00.000Z",
    });
    const result = serializeSheet(makeSheet({ memories: [unpinned, pinned] }));

    expect(result.indexOf("Pinned")).toBeLessThan(result.indexOf("Unpinned"));
  });

  it("excludes inactive memories entirely", () => {
    const active = makeMemory({ id: "active", label: "Active memory" });
    const inactive = makeMemory({ id: "inactive", label: "Inactive memory", active: false });
    const result = serializeSheet(makeSheet({ memories: [active, inactive] }));

    expect(result).toContain("Active memory");
    expect(result).not.toContain("Inactive memory");
  });

  it("includes the memory's id in its block", () => {
    const memory = makeMemory({ id: "mem-abc-123", label: "Deadline", body: "July 10" });
    const result = serializeSheet(makeSheet({ memories: [memory] }));

    expect(result).toContain("## Memory: Deadline (id: mem-abc-123)\nJuly 10");
  });

  describe("kind: summary", () => {
    it("renders an active summary ahead of the numbered turn list, in its own [Summary] line", () => {
      const result = serializeSheet(
        makeSheet({
          memories: [
            summary({ id: "s1", body: "Digest of earlier turns.", lastModified: "2026-03-01T00:00:00.000Z" }),
            turn({ id: "t1", body: "A still-active turn", lastModified: "2026-04-01T00:00:00.000Z" }),
          ],
        }),
      );
      expect(result).toContain(
        "## Conversation Summary\n[Summary]: Digest of earlier turns. (id: s1)\n1. A still-active turn (id: t1)",
      );
    });

    it("doesn't renumber the remaining turns — numbering reflects position among active turns only", () => {
      const result = serializeSheet(
        makeSheet({
          memories: [
            summary({ id: "s1", body: "Digest" }),
            turn({ id: "t1", body: "First remaining turn", lastModified: "2026-01-01T00:00:00.000Z" }),
            turn({ id: "t2", body: "Second remaining turn", lastModified: "2026-02-01T00:00:00.000Z" }),
          ],
        }),
      );
      expect(result).toContain("1. First remaining turn (id: t1)");
      expect(result).toContain("2. Second remaining turn (id: t2)");
    });

    it("excludes an inactive summary from serialization, same as inactive turns/memories", () => {
      const result = serializeSheet(makeSheet({ memories: [summary({ id: "s1", body: "Hidden", active: false })] }));
      expect(result).not.toContain("Hidden");
    });

    it("still shows the empty-conversation placeholder when there are zero active summaries and zero active turns", () => {
      const result = serializeSheet(makeSheet({ memories: [summary({ active: false })] }));
      expect(result).toContain("No entries yet");
    });

    it("does NOT show the empty placeholder when a summary exists but every turn it replaced is now inactive", () => {
      const result = serializeSheet(
        makeSheet({
          memories: [summary({ id: "s1", body: "Digest" }), turn({ id: "t1", body: "Compressed away", active: false })],
        }),
      );
      expect(result).not.toContain("No entries yet");
      expect(result).toContain("[Summary]: Digest (id: s1)");
    });

    it("excludes summary-kind memories from the ordinary Memory blocks section", () => {
      const result = serializeSheet(
        makeSheet({ memories: [summary({ id: "s1", body: "A digest" }), makeMemory({ id: "m1", label: "Ordinary fact" })] }),
      );
      expect(result).not.toContain("## Memory: Conversation Summary");
      expect(result).toContain("## Memory: Ordinary fact");
    });
  });
});

describe("orderConversationTurns", () => {
  it("returns only kind: conversation_turn memories, chronologically ascending", () => {
    const memories = [
      turn({ id: "b", body: "B", lastModified: "2026-02-01T00:00:00.000Z" }),
      makeMemory({ id: "ordinary" }),
      turn({ id: "a", body: "A", lastModified: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(orderConversationTurns(memories).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("includes inactive turns (excluded from calls, not from the sheet view)", () => {
    const memories = [turn({ id: "inactive-turn", active: false })];
    expect(orderConversationTurns(memories).map((m) => m.id)).toEqual(["inactive-turn"]);
  });

  it("doesn't pick up summary-kind memories", () => {
    const memories = [summary({ id: "s1" })];
    expect(orderConversationTurns(memories)).toEqual([]);
  });
});

describe("orderSummaries", () => {
  it("returns only kind: summary memories, chronologically ascending", () => {
    const memories = [
      summary({ id: "b", lastModified: "2026-02-01T00:00:00.000Z" }),
      turn({ id: "ordinary-turn" }),
      summary({ id: "a", lastModified: "2026-01-01T00:00:00.000Z" }),
    ];
    expect(orderSummaries(memories).map((m) => m.id)).toEqual(["a", "b"]);
  });

  it("includes inactive summaries (excluded from calls, not from the sheet view)", () => {
    const memories = [summary({ id: "inactive-summary", active: false })];
    expect(orderSummaries(memories).map((m) => m.id)).toEqual(["inactive-summary"]);
  });
});
