import { beforeEach, describe, expect, it } from "vitest";
import { ContextSheetDB } from "./db";
import { getTotalUsage, recordUsage } from "./tokenUsageStore";

let db: ContextSheetDB;

beforeEach(() => {
  db = new ContextSheetDB(`test-${crypto.randomUUID()}`);
});

describe("getTotalUsage", () => {
  it("returns zero for a sheet with no recorded usage", async () => {
    const total = await getTotalUsage("sheet-1", db);
    expect(total).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("sums multiple recorded calls for a sheet", async () => {
    await recordUsage("sheet-1", { inputTokens: 100, outputTokens: 20 }, db);
    await recordUsage("sheet-1", { inputTokens: 150, outputTokens: 30 }, db);
    await recordUsage("sheet-1", { inputTokens: 50, outputTokens: 10 }, db);

    const total = await getTotalUsage("sheet-1", db);
    expect(total).toEqual({ inputTokens: 300, outputTokens: 60 });
  });

  it("keeps different sheets' usage independent", async () => {
    await recordUsage("sheet-1", { inputTokens: 100, outputTokens: 20 }, db);
    await recordUsage("sheet-2", { inputTokens: 999, outputTokens: 999 }, db);

    const total = await getTotalUsage("sheet-1", db);
    expect(total).toEqual({ inputTokens: 100, outputTokens: 20 });
  });

  it("counts a disambiguated-follow-up-style call the same as any other recorded call", async () => {
    // Addendum V: the point of decoupling usage from messages — a call that
    // never produces its own visible chat message still has a real cost.
    await recordUsage("sheet-1", { inputTokens: 40, outputTokens: 15 }, db);
    const total = await getTotalUsage("sheet-1", db);
    expect(total).toEqual({ inputTokens: 40, outputTokens: 15 });
  });
});
