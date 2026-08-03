import { describe, expect, it } from "vitest";
import { diffCode } from "./codeDiff";
import type { CodeVersion } from "./types";

function makeVersion(files: Record<string, string>, parentId: string | null = null): CodeVersion {
  return { id: "v1", sheetId: "sheet-1", parentId, createdAt: new Date().toISOString(), chatMessageId: "m1", files };
}

describe("diffCode", () => {
  it("marks every file as added when there's no parent", () => {
    const version = makeVersion({ "a.ts": "one\ntwo\n" });
    const diffs = diffCode(null, version);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("added");
    expect(diffs[0].changes.every((c) => !c.removed)).toBe(true);
  });

  it("marks a file present in the parent but not the version as removed", () => {
    const parent = makeVersion({ "a.ts": "one\n" });
    const version = makeVersion({}, parent.id);

    const diffs = diffCode(parent, version);
    expect(diffs).toEqual([expect.objectContaining({ path: "a.ts", status: "removed" })]);
  });

  it("marks a changed file as modified with real line-level changes", () => {
    const parent = makeVersion({ "a.ts": "one\ntwo\nthree\n" });
    const version = makeVersion({ "a.ts": "one\nTWO\nthree\n" }, parent.id);

    const diffs = diffCode(parent, version);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("modified");
    expect(diffs[0].changes.some((c) => c.added && c.value.includes("TWO"))).toBe(true);
    expect(diffs[0].changes.some((c) => c.removed && c.value.includes("two"))).toBe(true);
  });

  it("omits files that are byte-identical between parent and version", () => {
    const parent = makeVersion({ "a.ts": "unchanged\n", "b.ts": "old\n" });
    const version = makeVersion({ "a.ts": "unchanged\n", "b.ts": "new\n" }, parent.id);

    const diffs = diffCode(parent, version);
    expect(diffs.map((d) => d.path)).toEqual(["b.ts"]);
  });

  it("sorts results by path", () => {
    const parent = makeVersion({});
    const version = makeVersion({ "z.ts": "z", "a.ts": "a" }, parent.id);

    const diffs = diffCode(parent, version);
    expect(diffs.map((d) => d.path)).toEqual(["a.ts", "z.ts"]);
  });
});
