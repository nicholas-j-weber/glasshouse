import { describe, expect, it } from "vitest";
import { buildReasoningInstructions, buildSystemPrompt } from "./systemPrompt";
import { serializeSheet } from "./serializer";
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

describe("buildSystemPrompt", () => {
  const sheet = makeSheet();

  it("uses the chat preamble in chat mode and not the sheet-editor preamble", () => {
    const result = buildSystemPrompt(sheet, "chat");
    expect(result).toContain("Respond to the user's message directly and conversationally");
    expect(result).not.toContain("dedicated sheet-editing session");
  });

  it("uses the sheet-editor preamble in sheet_editor mode and not the chat preamble", () => {
    const result = buildSystemPrompt(sheet, "sheet_editor");
    expect(result).toContain("dedicated sheet-editing session");
    expect(result).not.toContain("Respond to the user's message directly and conversationally");
  });

  it("includes the exact serializeSheet output for the given sheet, unmodified", () => {
    const result = buildSystemPrompt(sheet, "chat");
    expect(result).toContain(serializeSheet(sheet));
  });

  it("includes the suggestion instructions and delimiter in both modes", () => {
    for (const mode of ["chat", "sheet_editor"] as const) {
      const result = buildSystemPrompt(sheet, mode);
      expect(result).toContain("SHEET_SUGGESTIONS");
      expect(result).toContain("deactivate_memory");
      expect(result).toContain("reorder_pins");
      expect(result).toContain("conversation_summary_update");
    }
  });

  it("orders parts as preamble, then sheet, then suggestion instructions", () => {
    const result = buildSystemPrompt(sheet, "chat");
    const preambleIndex = result.indexOf("Respond to the user's message");
    const sheetIndex = result.indexOf("## Tone");
    const instructionsIndex = result.indexOf("## Suggesting Sheet Changes");

    expect(preambleIndex).toBeLessThan(sheetIndex);
    expect(sheetIndex).toBeLessThan(instructionsIndex);
  });

  it("makes conversation_summary_update mandatory only in chat mode", () => {
    const chatResult = buildSystemPrompt(sheet, "chat");
    const editorResult = buildSystemPrompt(sheet, "sheet_editor");

    expect(chatResult).toContain("without exception");
    expect(chatResult).toContain("never optional");
    expect(chatResult).toContain("User asked/said");
    // Sheet-editor's own preamble text shouldn't mention it; the suggestion
    // *type* is still listed in the shared instructions (checked above).
    expect(editorResult).not.toContain("without exception");
  });

  it("instructs the model to send only the new entry, not the whole list", () => {
    const result = buildSystemPrompt(sheet, "chat");
    expect(result).toContain("do not repeat or rewrite earlier entries");
    expect(result).toContain("appended automatically");
  });

  it("states the Conversation Summary's temporal ordering explicitly", () => {
    const chatResult = buildSystemPrompt(sheet, "chat");
    const editorResult = buildSystemPrompt(sheet, "sheet_editor");

    expect(chatResult).toContain("the message you are responding to now is always the newest one");
    expect(editorResult).not.toContain("the message you are responding to now is always the newest one");
  });

  it("instructs the model to keep ordinary memories atomic, not a catch-all", () => {
    const result = buildSystemPrompt(sheet, "chat");
    expect(result).toContain("not a catch-all");
  });

  it("instructs the model to use shown memory ids rather than inventing one", () => {
    const result = buildSystemPrompt(sheet, "chat");
    expect(result).toContain("do not guess or invent one");
  });

  it("always lists code_change's format, regardless of content mode", () => {
    expect(buildSystemPrompt(sheet, "chat")).toContain('"type": "code_change"');
    expect(buildSystemPrompt(sheet, "chat", "code")).toContain('"type": "code_change"');
  });

  it("omits the coding-pass addendum by default (prose)", () => {
    expect(buildSystemPrompt(sheet, "chat")).not.toContain("This is a coding pass");
    expect(buildSystemPrompt(sheet, "chat", "prose")).not.toContain("This is a coding pass");
  });

  it("appends the coding-pass addendum, after the mode preamble, when contentMode is code", () => {
    for (const mode of ["chat", "sheet_editor"] as const) {
      const result = buildSystemPrompt(sheet, mode, "code");
      expect(result).toContain("This is a coding pass");
      expect(result).toContain("Never write code anywhere in your conversational reply");
    }
  });

  it("keeps the addendum after the mode preamble and before the serialized sheet", () => {
    const result = buildSystemPrompt(sheet, "chat", "code");
    const addendumIndex = result.indexOf("This is a coding pass");
    const sheetIndex = result.indexOf("## Tone");
    expect(addendumIndex).toBeGreaterThan(-1);
    expect(addendumIndex).toBeLessThan(sheetIndex);
  });

  // Milestone 9: "Confirm active knowledge/skill entries flow into
  // topLevelInstructions" — buildSystemPrompt's output *is*
  // topLevelInstructions for both call paths (runCall's system prompt and
  // runReasoningAgent's topLevelInstructions argument in suggestionSession.ts
  // are the exact same string). No knowledge-specific code exists in this
  // file either; this end-to-end pass confirms serializeSheet's inclusion
  // (verified in serializer.test.ts) survives all the way through, in every
  // mode and content mode.
  it("includes an active knowledge entry's full content, in every mode and content mode", () => {
    const sheetWithKnowledge = makeSheet({
      memories: [makeMemory({ id: "k1", kind: "knowledge", label: "onboarding.md", body: "Step one. Step two." })],
    });
    for (const mode of ["chat", "sheet_editor"] as const) {
      for (const contentMode of ["prose", "code"] as const) {
        const result = buildSystemPrompt(sheetWithKnowledge, mode, contentMode);
        expect(result).toContain("## Memory: onboarding.md (id: k1)\nStep one. Step two.");
      }
    }
  });

  it("buildReasoningInstructions omits the suggestion instructions that buildSystemPrompt includes, keeping the sheet content identical", () => {
    const full = buildSystemPrompt(sheet, "chat");
    const reasoningOnly = buildReasoningInstructions(sheet, "chat");

    expect(full).toContain("SHEET_SUGGESTIONS");
    expect(reasoningOnly).not.toContain("SHEET_SUGGESTIONS");
    expect(reasoningOnly).toContain("## Tone");
    expect(full).toBe(`${reasoningOnly}\n\n` + full.slice(full.indexOf("## Suggesting Sheet Changes")));
  });

  it("excludes an inactive knowledge/skill entry the same way it excludes any inactive memory", () => {
    const result = buildSystemPrompt(
      makeSheet({ memories: [makeMemory({ id: "k1", kind: "skill", label: "stale.md", body: "Old procedure", active: false })] }),
      "chat",
    );
    expect(result).not.toContain("stale.md");
  });
});
