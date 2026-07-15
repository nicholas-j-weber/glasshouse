import { describe, expect, it } from "vitest";
import { diffSheets } from "./versionDiff";
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

describe("diffSheets", () => {
  it("reports 'Initial context' when there is no parent", () => {
    expect(diffSheets(null, makeSheet())).toEqual([{ kind: "added", status: "Initial context" }]);
  });

  it("reports no visible changes for two identical sheets", () => {
    const sheet = makeSheet({ freeformNotes: "same" });
    expect(diffSheets(sheet, sheet)).toEqual([{ kind: "none", status: "No visible changes" }]);
  });

  it("detects Tone and Freeform Notes edits independently", () => {
    const parent = makeSheet({ freeformNotes: "old notes" });
    const sheet = makeSheet({
      tone: makeMemory({ id: "tone", label: "Tone", body: "New tone" }),
      freeformNotes: "new notes",
    });
    const statuses = diffSheets(parent, sheet).map((l) => l.status);
    expect(statuses).toContain("Edited Tone");
    expect(statuses).toContain("Edited Freeform Notes");
  });

  it("shows a conversation turn's body, not its generic label, as the detail (Addendum O)", () => {
    const parent = makeSheet();
    const sheet = makeSheet({
      memories: [
        makeMemory({
          id: "turn1",
          label: "Conversation Summary",
          body: "User asked about X; I explained Y.",
          kind: "conversation_turn",
        }),
      ],
    });
    expect(diffSheets(parent, sheet)).toEqual([
      { kind: "added", status: "Added memory", detail: "User asked about X; I explained Y." },
    ]);
  });

  it("shows a summary's body, not its generic label, as the detail (Addendum AQ)", () => {
    const parent = makeSheet();
    const sheet = makeSheet({
      memories: [
        makeMemory({
          id: "summary1",
          label: "Conversation Summary",
          body: "Condensed digest of earlier turns.",
          kind: "summary",
        }),
      ],
    });
    expect(diffSheets(parent, sheet)).toEqual([
      { kind: "added", status: "Added memory", detail: "Condensed digest of earlier turns." },
    ]);
  });

  it("detects an added memory", () => {
    const parent = makeSheet();
    const sheet = makeSheet({ memories: [makeMemory({ id: "m1", label: "New one" })] });
    expect(diffSheets(parent, sheet)).toEqual([{ kind: "added", status: "Added memory", detail: '"New one"' }]);
  });

  it("detects a deleted memory", () => {
    const parent = makeSheet({ memories: [makeMemory({ id: "m1", label: "Gone" })] });
    const sheet = makeSheet();
    expect(diffSheets(parent, sheet)).toEqual([{ kind: "deleted", status: "Deleted memory", detail: '"Gone"' }]);
  });

  it("detects a label/body edit on an existing memory", () => {
    const parent = makeSheet({ memories: [makeMemory({ id: "m1", label: "Old", body: "Old body" })] });
    const sheet = makeSheet({ memories: [makeMemory({ id: "m1", label: "New", body: "Old body" })] });
    expect(diffSheets(parent, sheet)).toEqual([{ kind: "edited", status: "Edited memory", detail: '"New"' }]);
  });

  it("distinguishes deactivation from reactivation", () => {
    const parent = makeSheet({ memories: [makeMemory({ id: "m1", label: "M", active: true })] });
    const sheet = makeSheet({ memories: [makeMemory({ id: "m1", label: "M", active: false })] });
    expect(diffSheets(parent, sheet)).toEqual([{ kind: "edited", status: "Deactivated memory", detail: '"M"' }]);
  });

  it("detects a pin change when nothing else changed", () => {
    const parent = makeSheet({ memories: [makeMemory({ id: "m1", label: "M", pinRank: null })] });
    const sheet = makeSheet({ memories: [makeMemory({ id: "m1", label: "M", pinRank: 0 })] });
    expect(diffSheets(parent, sheet)).toEqual([
      { kind: "edited", status: "Changed pin for memory", detail: '"M"' },
    ]);
  });
});
