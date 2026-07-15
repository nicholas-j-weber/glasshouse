import { beforeEach, describe, expect, it } from "vitest";
import { ContextSheetDB } from "./db";
import { loadMessages, saveMessage } from "./messagesStore";
import type { SessionMessage } from "./suggestionSession";

let db: ContextSheetDB;

beforeEach(() => {
  db = new ContextSheetDB(`test-${crypto.randomUUID()}`);
});

function makeMessage(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: crypto.randomUUID(),
    mode: "chat",
    role: "user",
    text: "hello",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("saveMessage / loadMessages", () => {
  it("persists a message scoped to a sheet and loads it back", async () => {
    const message = makeMessage({ text: "What is AI?" });
    await saveMessage("sheet-1", message, db);

    const loaded = await loadMessages("sheet-1", "chat", db);
    expect(loaded).toEqual([message]);
  });

  it("keeps messages from different sheets separate", async () => {
    await saveMessage("sheet-1", makeMessage({ text: "for sheet 1" }), db);
    await saveMessage("sheet-2", makeMessage({ text: "for sheet 2" }), db);

    const sheet1 = await loadMessages("sheet-1", "chat", db);
    const sheet2 = await loadMessages("sheet-2", "chat", db);

    expect(sheet1).toHaveLength(1);
    expect(sheet1[0].text).toBe("for sheet 1");
    expect(sheet2).toHaveLength(1);
    expect(sheet2[0].text).toBe("for sheet 2");
  });

  it("keeps messages from different modes separate, even on the same sheet", async () => {
    // ChatPane ("chat") and ManageWithAIPanel ("sheet_editor") previously
    // shared one undifferentiated per-sheet log — a pending suggestion from
    // one leaked into the other's view. This is the regression test for that.
    await saveMessage("sheet-1", makeMessage({ mode: "chat", text: "chat message" }), db);
    await saveMessage("sheet-1", makeMessage({ mode: "sheet_editor", text: "sheet editor instruction" }), db);

    const chatMessages = await loadMessages("sheet-1", "chat", db);
    const sheetEditorMessages = await loadMessages("sheet-1", "sheet_editor", db);

    expect(chatMessages).toHaveLength(1);
    expect(chatMessages[0].text).toBe("chat message");
    expect(sheetEditorMessages).toHaveLength(1);
    expect(sheetEditorMessages[0].text).toBe("sheet editor instruction");
  });

  it("returns messages ordered by createdAt", async () => {
    const first = makeMessage({ text: "first", createdAt: "2026-01-01T00:00:00.000Z" });
    const second = makeMessage({ text: "second", createdAt: "2026-01-02T00:00:00.000Z" });

    // Save out of order to prove sorting, not insertion order, governs.
    await saveMessage("sheet-1", second, db);
    await saveMessage("sheet-1", first, db);

    const loaded = await loadMessages("sheet-1", "chat", db);
    expect(loaded.map((m) => m.text)).toEqual(["first", "second"]);
  });

  it("upserts: saving the same message id again updates it in place, preserving createdAt", async () => {
    const message = makeMessage({
      text: "reply",
      suggestions: [{ suggestion: { type: "tone_update", body: "be terser" }, status: "pending" }],
    });
    await saveMessage("sheet-1", message, db);

    const updated: SessionMessage = {
      ...message,
      suggestions: [{ suggestion: { type: "tone_update", body: "be terser" }, status: "accepted" }],
    };
    await saveMessage("sheet-1", updated, db);

    const loaded = await loadMessages("sheet-1", "chat", db);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].suggestions?.[0].status).toBe("accepted");
    expect(loaded[0].createdAt).toBe(message.createdAt);
  });

  it("round-trips isFallback/isFollowUp markers on suggestions", async () => {
    const message = makeMessage({
      role: "assistant",
      text: "reply",
      suggestions: [
        { suggestion: { type: "conversation_summary_update", body: "..." }, status: "pending", isFallback: true },
      ],
    });
    await saveMessage("sheet-1", message, db);

    const loaded = await loadMessages("sheet-1", "chat", db);
    expect(loaded[0].suggestions?.[0].isFallback).toBe(true);
  });
});
