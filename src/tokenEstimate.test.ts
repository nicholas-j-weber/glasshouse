import { describe, expect, it } from "vitest";
import { estimateTokenCount } from "./tokenEstimate";

describe("estimateTokenCount", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("scales roughly with length (longer text -> more estimated tokens)", () => {
    expect(estimateTokenCount("a".repeat(400))).toBeGreaterThan(estimateTokenCount("a".repeat(40)));
  });

  it("never returns a fractional count", () => {
    expect(Number.isInteger(estimateTokenCount("some text of arbitrary length"))).toBe(true);
  });
});
