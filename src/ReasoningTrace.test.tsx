import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { judgeStepLabel, judgeVerdictNode, judgeVerdictText } from "./ReasoningTrace";
import { JUDGE_INSTRUCTION } from "./reasoningAgent";
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

describe("judgeVerdictNode", () => {
  it("bolds and capitalizes a ready verdict", () => {
    const html = renderToStaticMarkup(<>{judgeVerdictNode(makeJudgeStep({ method: "model", status: "ready", reason: "looks good" }))}</>);
    expect(html).toBe("<strong>READY</strong> — looks good");
  });

  it("bolds and capitalizes an abandon verdict", () => {
    const html = renderToStaticMarkup(<>{judgeVerdictNode(makeJudgeStep({ method: "model", status: "abandon", reason: "stuck" }))}</>);
    expect(html).toBe("<strong>ABANDON</strong> — stuck");
  });

  it("leaves a continue verdict plain, unbolded", () => {
    const html = renderToStaticMarkup(<>{judgeVerdictNode(makeJudgeStep({ method: "model", status: "continue", reason: "" }))}</>);
    expect(html).toBe("continue");
  });
});

describe("judgeStepLabel", () => {
  it("replaces the raw JSON-mentioning judge instruction with a plain-language label", () => {
    const step = { ...makeJudgeStep(), instruction: JUDGE_INSTRUCTION };
    expect(judgeStepLabel(step)).toBe("Checking whether the reasoning so far is enough to answer");
  });

  it("passes through any other instruction (e.g. the structural check's) unchanged", () => {
    const step = { ...makeJudgeStep(), instruction: "Structural completion check" };
    expect(judgeStepLabel(step)).toBe("Structural completion check");
  });
});
