import { describe, expect, it } from "vitest";
import { buildRevisionMessage } from "./revise";

describe("buildRevisionMessage", () => {
  it("includes the marker header, the original suggestion, and the user's instruction", () => {
    const message = buildRevisionMessage(
      { type: "new_memory", label: "Deadline", body: "Ships July 10" },
      "Make it shorter",
    );

    expect(message).toContain("[Revising a previous suggestion]");
    expect(message).toContain("## Memory: Deadline");
    expect(message).toContain("Ships July 10");
    expect(message).toContain("Make it shorter");
  });

  it("formats a deactivate_memory suggestion without a memory-block header", () => {
    const message = buildRevisionMessage(
      { type: "deactivate_memory", memoryId: "m1", reason: "stale" },
      "Actually keep it, just reword the reason",
    );
    expect(message).toContain("Deactivate memory m1");
    expect(message).toContain("Actually keep it");
  });
});
