import { beforeEach, describe, expect, it } from "vitest";
import { createCodeVersion, getCodeHeadVersion } from "./codeStore";
import { ContextSheetDB } from "./db";

let db: ContextSheetDB;

beforeEach(() => {
  db = new ContextSheetDB(`test-${crypto.randomUUID()}`);
});

describe("createCodeVersion / getCodeHeadVersion", () => {
  it("has no head until the first version is created", async () => {
    expect(await getCodeHeadVersion("sheet-1", db)).toBeUndefined();
  });

  it("creates a root version (parentId null) and makes it head", async () => {
    const version = await createCodeVersion({ "a.ts": "one" }, "message-1", "sheet-1", db);

    expect(version.parentId).toBeNull();
    expect(await getCodeHeadVersion("sheet-1", db)).toEqual(version);
  });

  it("chains a second version off the current head and advances head to it", async () => {
    const first = await createCodeVersion({ "a.ts": "one" }, "message-1", "sheet-1", db);
    const second = await createCodeVersion({ "a.ts": "two" }, "message-2", "sheet-1", db);

    expect(second.parentId).toBe(first.id);
    expect(await getCodeHeadVersion("sheet-1", db)).toEqual(second);
  });

  it("gives independent sheets independent code chains", async () => {
    const a = await createCodeVersion({ "a.ts": "one" }, "message-1", "sheet-a", db);
    const b = await createCodeVersion({ "b.ts": "one" }, "message-2", "sheet-b", db);

    expect(await getCodeHeadVersion("sheet-a", db)).toEqual(a);
    expect(await getCodeHeadVersion("sheet-b", db)).toEqual(b);
  });
});
