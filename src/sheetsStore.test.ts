import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContextSheetDB } from "./db";
import { createSheet, deleteSheet, ensureActiveSheet, listSheets, renameSheet, switchSheet } from "./sheetsStore";
import { getStoredActiveSheetId } from "./settingsStorage";
import { recordUsage } from "./tokenUsageStore";

let db: ContextSheetDB;

beforeEach(() => {
  db = new ContextSheetDB(`test-${crypto.randomUUID()}`);
  localStorage.clear();
});

describe("ensureActiveSheet", () => {
  it("bootstraps a default sheet when none exist", async () => {
    const id = await ensureActiveSheet(db);
    const sheets = await listSheets(db);

    expect(sheets).toHaveLength(1);
    expect(sheets[0].id).toBe(id);
    expect(sheets[0].name).toBe("Chat 1");
  });

  it("is idempotent — a second call doesn't create another sheet", async () => {
    const first = await ensureActiveSheet(db);
    const second = await ensureActiveSheet(db);
    expect(second).toBe(first);
    expect(await listSheets(db)).toHaveLength(1);
  });

  it("bootstraps exactly one sheet under concurrent invocation (React StrictMode's dev-mode double-effect-invoke)", async () => {
    // Regression test for a real bug caught via live browser testing: two
    // overlapping calls (StrictMode calls this twice back-to-back before
    // the first call's writes land) both saw zero sheets and each created
    // their own "Chat 1" before the in-flight guard was added.
    const [first, second] = await Promise.all([ensureActiveSheet(db), ensureActiveSheet(db)]);
    expect(second).toBe(first);
    expect(await listSheets(db)).toHaveLength(1);
  });

  it("falls back to an existing sheet if the stored active id points at nothing", async () => {
    const id = await createSheet("Real Sheet", db);
    localStorage.setItem("context-sheets:active-sheet-id", "does-not-exist");

    const resolved = await ensureActiveSheet(db);
    expect(resolved).toBe(id);
  });
});

describe("createSheet", () => {
  it("creates a SheetMeta row and a skeleton version, and makes it active", async () => {
    const id = await createSheet("My Project", db);
    const sheets = await listSheets(db);

    expect(sheets.map((s) => s.name)).toContain("My Project");
    expect(await db.head.get(id)).toBeDefined();
    expect(getStoredActiveSheetId()).toBe(id);
  });

  it("gives independent sheets independent version chains", async () => {
    const a = await createSheet("A", db);
    const b = await createSheet("B", db);

    const headA = await db.head.get(a);
    const headB = await db.head.get(b);
    expect(headA?.versionId).not.toBe(headB?.versionId);
  });
});

describe("switchSheet", () => {
  it("updates the active-sheet preference and notifies subscribers", async () => {
    const a = await createSheet("A", db);
    const b = await createSheet("B", db);

    const listener = vi.fn();
    const { subscribeSheetsChanged } = await import("./sheetsSubscription");
    const unsubscribe = subscribeSheetsChanged(listener);

    switchSheet(a);
    expect(getStoredActiveSheetId()).toBe(a);
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    void b;
  });
});

describe("renameSheet", () => {
  it("updates the name without touching the version chain", async () => {
    const id = await createSheet("Old Name", db);
    const before = await db.head.get(id);

    await renameSheet(id, "New Name", db);

    const sheets = await listSheets(db);
    const after = await db.head.get(id);
    expect(sheets.find((s) => s.id === id)?.name).toBe("New Name");
    expect(after?.versionId).toBe(before?.versionId); // unchanged
  });

  it("ignores a blank name", async () => {
    const id = await createSheet("Keep Me", db);
    await renameSheet(id, "   ", db);
    const sheets = await listSheets(db);
    expect(sheets.find((s) => s.id === id)?.name).toBe("Keep Me");
  });
});

describe("deleteSheet", () => {
  it("cascade-deletes versions, head, messages, usage records, and the sheet itself", async () => {
    const id = await createSheet("Doomed", db);
    await db.messages.add({ id: "m1", sheetId: id, mode: "chat", role: "user", text: "hi", createdAt: new Date().toISOString() });
    await recordUsage(id, { inputTokens: 10, outputTokens: 5 }, db);

    await deleteSheet(id, db);

    expect(await db.sheets.get(id)).toBeUndefined();
    expect(await db.head.get(id)).toBeUndefined();
    expect(await db.versions.where("sheetId").equals(id).count()).toBe(0);
    expect(await db.messages.where("sheetId").equals(id).count()).toBe(0);
    expect(await db.usage.where("sheetId").equals(id).count()).toBe(0);
  });

  it("does not touch other sheets' data", async () => {
    const keep = await createSheet("Keep", db);
    const doomed = await createSheet("Doomed", db);

    await deleteSheet(doomed, db);

    expect(await db.sheets.get(keep)).toBeDefined();
    expect(await db.head.get(keep)).toBeDefined();
  });

  it("falls back to another sheet when the active one is deleted", async () => {
    const a = await createSheet("A", db);
    const b = await createSheet("B", db); // B is now active
    void a;

    await deleteSheet(b, db);

    const active = getStoredActiveSheetId();
    expect(active).not.toBe(b);
    expect(await db.sheets.get(active!)).toBeDefined();
  });

  it("auto-creates a fresh default sheet when the last one is deleted", async () => {
    const only = await ensureActiveSheet(db);

    await deleteSheet(only, db);

    const sheets = await listSheets(db);
    expect(sheets).toHaveLength(1);
    expect(sheets[0].id).not.toBe(only);
  });
});
