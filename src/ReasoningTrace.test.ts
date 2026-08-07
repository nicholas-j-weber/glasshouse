import { describe, expect, it } from "vitest";
import { judgeVerdictText } from "./ReasoningTrace";
import type { StepRecord } from "./types";

function makeJudgeStep(metadata?: StepRecord["metadata"]): StepRecord {
  return {
    runId: "run-1",
    stepId: 0,
    role: "judge",
    instruction: "judge",
    prompt: "prompt",
    rawResponse: '```json\n{"status": "ready", "reason": "looks good"}\n```',
    timestamp: new Date().toISOString(),
    model: "stub-model",
    metadata,
  };
}

describe("judgeVerdictText", () => {
  it("renders the parsed status and reason, not the raw (possibly fenced) JSON", () => {
    expect(judgeVerdictText(makeJudgeStep({ method: "model", status: "ready", reason: "looks good" }))).toBe(
      "ready — looks good",
    );
  });

  it("omits the dash when reason is empty", () => {
    expect(judgeVerdictText(makeJudgeStep({ method: "model", status: "continue", reason: "" }))).toBe("continue");
  });

  it("falls back to 'unknown' when metadata is missing entirely", () => {
    expect(judgeVerdictText(makeJudgeStep(undefined))).toBe("unknown");
  });
});
