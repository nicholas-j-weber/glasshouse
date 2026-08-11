import { beforeEach, describe, expect, it } from "vitest";
import { ContextSheetDB } from "./db";
import {
  COMPILE_INSTRUCTION,
  FIXED_SEQUENCE,
  JUDGE_INSTRUCTION,
  filterSteps,
  loadRunSteps,
  runReasoningAgent,
  type ModelCallFn,
} from "./reasoningAgent";
import type { StepRecord } from "./types";

// Mirrors agent.py's _demo()/_demo_observability() self-checks, against the
// real Dexie tables (fake-indexeddb) rather than the JSONL log.

// The label every step this helper's runs record is stamped with — passed
// explicitly so the model-name assertions below test "the run's own
// modelName is used", not the value of runReasoningAgent's default.
const RUN_MODEL_NAME = "test-model";

let db: ContextSheetDB;

beforeEach(() => {
  db = new ContextSheetDB(`test-${crypto.randomUUID()}`);
});

function run(
  modelCallFn: ModelCallFn,
  opts: {
    maxSteps?: number;
    minSteps?: number;
    finalPromptSuffix?: string;
    judgeModelCallFn?: ModelCallFn;
    judgeModelName?: string;
  } = {},
) {
  return runReasoningAgent({
    sheetId: "sheet-1",
    chatMessageId: "message-1",
    problem: "What is 2+2?",
    topLevelInstructions: "Answer carefully.",
    modelCallFn,
    modelName: RUN_MODEL_NAME,
    db,
    ...opts,
  });
}

// agent.py's _assert_lossless_transcript: every prior step's instruction and
// response must appear verbatim in every later step's prompt. Excludes
// "final", whose prompt is deliberately the compiled/distilled prompt from
// the compile step, not another transcript dump — the one intentional break
// from this property (see reasoningAgent.ts's compile-step comment).
function expectLosslessTranscript(steps: StepRecord[]): void {
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].role === "final") continue;
    for (const prior of steps.slice(0, i)) {
      expect(steps[i].prompt).toContain(prior.instruction);
      expect(steps[i].prompt).toContain(prior.rawResponse);
    }
  }
}

const judgeSays = (verdict: object): ModelCallFn => async (prompt) =>
  prompt.includes(JUDGE_INSTRUCTION) ? JSON.stringify(verdict) : "reasoning output";

describe("runReasoningAgent", () => {
  it("stops right at min_steps once the judge says ready — not before, not later", async () => {
    const log = await run(judgeSays({ status: "ready", reason: "looks good" }), { maxSteps: 10, minSteps: 2 });

    expect(log.status).toBe("completed");
    expect(log.finalAnswer).toBeTruthy();

    const steps = await loadRunSteps(log.runId, db);
    expect(steps.filter((s) => s.role === "reasoning")).toHaveLength(2);
    const judges = steps.filter((s) => s.role === "judge");
    expect(judges).toHaveLength(1);
    expect(judges[0].metadata?.status).toBe("ready");
    expect(steps.filter((s) => s.role === "final")).toHaveLength(1);
  });

  it("keeps every step's prompt a superset of the transcript before it", async () => {
    const log = await run(
      async (prompt) =>
        prompt.includes(JUDGE_INSTRUCTION)
          ? JSON.stringify({ status: "continue", reason: "not done" })
          : `response-to-${prompt.length}-chars`,
      { maxSteps: 4, minSteps: 2 },
    );

    expectLosslessTranscript(await loadRunSteps(log.runId, db));
  });

  it("caps the loop at max_steps when the judge never says ready, and still answers", async () => {
    const log = await run(judgeSays({ status: "continue", reason: "not done" }), { maxSteps: 4, minSteps: 1 });

    expect(log.status).toBe("max_steps_reached");
    expect(log.finalAnswer).toBeTruthy();

    const steps = await loadRunSteps(log.runId, db);
    expect(steps.filter((s) => s.role === "reasoning")).toHaveLength(4);
    expect(steps.filter((s) => s.role === "final")).toHaveLength(1);
  });

  it("treats unparseable judge output as continue instead of throwing", async () => {
    const log = await run(
      async (prompt) => (prompt.includes(JUDGE_INSTRUCTION) ? "not json" : "reasoning output"),
      { maxSteps: 3, minSteps: 1 },
    );

    expect(log.status).toBe("max_steps_reached");
    const judges = await filterSteps(log.runId, { role: "judge" }, db);
    expect(judges).toHaveLength(3);
    for (const judge of judges) {
      expect(judge.metadata?.status).toBe("continue");
      expect(judge.metadata?.reason).toContain("unparseable");
    }
  });

  it("treats a non-object JSON judge response as unparseable too", async () => {
    const log = await run(async (prompt) => (prompt.includes(JUDGE_INSTRUCTION) ? "5" : "reasoning output"), {
      maxSteps: 2,
      minSteps: 1,
    });

    const judges = await filterSteps(log.runId, { role: "judge" }, db);
    expect(judges[0].metadata?.status).toBe("continue");
    expect(judges[0].metadata?.reason).toContain("unparseable");
  });

  it("parses a judge verdict wrapped in a markdown code fence instead of treating it as unparseable", async () => {
    const log = await run(
      async (prompt) =>
        prompt.includes(JUDGE_INSTRUCTION)
          ? '```json\n{"status": "ready", "reason": "looks good"}\n```'
          : "reasoning output",
      { maxSteps: 10, minSteps: 1 },
    );

    expect(log.status).toBe("completed");
    const judges = await filterSteps(log.runId, { role: "judge" }, db);
    expect(judges).toHaveLength(1);
    expect(judges[0].metadata?.status).toBe("ready");
  });

  it("records abandon as treated_as continue and keeps going", async () => {
    const log = await run(judgeSays({ status: "abandon", reason: "not converging" }), { maxSteps: 2, minSteps: 1 });

    expect(log.status).toBe("max_steps_reached");
    const judges = await filterSteps(log.runId, { role: "judge" }, db);
    expect(judges[0].metadata?.treated_as).toBe("continue");
  });

  it("walks the fixed instruction sequence, wrapping past its end", async () => {
    const log = await run(judgeSays({ status: "continue", reason: "not done" }), { maxSteps: 6, minSteps: 6 });

    const reasoning = await filterSteps(log.runId, { role: "reasoning" }, db);
    expect(reasoning.map((s) => s.instruction)).toEqual([...FIXED_SEQUENCE, FIXED_SEQUENCE[0]]);
  });

  it("defaults minSteps to the full fixed sequence, so the judge isn't consulted until every phase has run once", async () => {
    const log = await run(judgeSays({ status: "ready", reason: "looks good" }), { maxSteps: 10 });

    const steps = await loadRunSteps(log.runId, db);
    expect(steps.filter((s) => s.role === "reasoning")).toHaveLength(FIXED_SEQUENCE.length);
    expect(steps.filter((s) => s.role === "judge")).toHaveLength(1);
  });

  it("submits the compile step's output as the final call's prompt, verbatim — not another transcript dump", async () => {
    const log = await run(
      async (prompt) => {
        // Order matters: once a judge step is in the transcript, its
        // instruction text (JUDGE_INSTRUCTION) reappears verbatim inside
        // later steps' transcript dumps, so the more specific check must
        // run first.
        if (prompt.includes(COMPILE_INSTRUCTION)) return "THE COMPILED PROMPT";
        if (prompt.includes(JUDGE_INSTRUCTION)) return JSON.stringify({ status: "ready", reason: "done" });
        return "reasoning output";
      },
      { maxSteps: 5, minSteps: 1 },
    );

    const steps = await loadRunSteps(log.runId, db);
    const compile = steps.find((s) => s.role === "compile")!;
    const final = steps.find((s) => s.role === "final")!;

    expect(compile.rawResponse).toBe("THE COMPILED PROMPT");
    expect(final.prompt).toBe("THE COMPILED PROMPT");
    expect(compile.prompt).toContain(COMPILE_INSTRUCTION);
  });

  it("appends finalPromptSuffix to the compiled prompt for the final call, and persists that combined prompt", async () => {
    const log = await run(
      async (prompt) => {
        if (prompt.includes(COMPILE_INSTRUCTION)) return "COMPILED";
        if (prompt.includes(JUDGE_INSTRUCTION)) return JSON.stringify({ status: "ready", reason: "done" });
        return "reasoning output";
      },
      { maxSteps: 5, minSteps: 1, finalPromptSuffix: "SUFFIX INSTRUCTIONS" },
    );

    const steps = await loadRunSteps(log.runId, db);
    const final = steps.find((s) => s.role === "final")!;
    expect(final.prompt).toBe("COMPILED\n\nSUFFIX INSTRUCTIONS");
  });

  it("routes the judge call through judgeModelCallFn and records judgeModelName, leaving reasoning/compile/final on the default model", async () => {
    const judgeCalls: string[] = [];
    const defaultCalls: string[] = [];

    const log = await run(
      async (prompt) => {
        defaultCalls.push(prompt);
        return prompt.includes(COMPILE_INSTRUCTION) ? "COMPILED" : "reasoning output";
      },
      {
        maxSteps: 5,
        minSteps: 1,
        judgeModelCallFn: async (prompt) => {
          judgeCalls.push(prompt);
          return JSON.stringify({ status: "ready", reason: "done" });
        },
        judgeModelName: "claude-haiku-4-5-20251001",
      },
    );

    expect(judgeCalls).toHaveLength(1);
    // reasoning (1) + compile (1) + final (1) — the judge call itself never
    // reaches the default modelCallFn. (compile's own prompt legitimately
    // contains JUDGE_INSTRUCTION as transcript history, so this checks call
    // count rather than searching prompt text for it.)
    expect(defaultCalls).toHaveLength(3);

    const steps = await loadRunSteps(log.runId, db);
    const judge = steps.find((s) => s.role === "judge")!;
    expect(judge.model).toBe("claude-haiku-4-5-20251001");
    expect(steps.filter((s) => s.role !== "judge").every((s) => s.model === RUN_MODEL_NAME)).toBe(true);
  });

  it("falls back to modelCallFn/modelName for the judge when judgeModelCallFn is omitted, unchanged from before", async () => {
    const log = await run(judgeSays({ status: "ready", reason: "done" }), { maxSteps: 5, minSteps: 1 });

    const judge = (await loadRunSteps(log.runId, db)).find((s) => s.role === "judge")!;
    expect(judge.model).toBe(RUN_MODEL_NAME);
  });

  it("persists each step as it is produced, not batched at the end", async () => {
    const seenMidRun: number[] = [];
    await run(async (prompt) => {
      seenMidRun.push(await db.runSteps.count());
      return prompt.includes(JUDGE_INSTRUCTION) ? JSON.stringify({ status: "continue", reason: "no" }) : "out";
    }, { maxSteps: 2, minSteps: 2 });

    // Step count visible in the DB grows on every model call — a crash
    // mid-loop still leaves a usable partial trace.
    expect(seenMidRun).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("observability: load / filter / replay", () => {
  it("round-trips through Dexie and replays a step's exact prompt", async () => {
    const log = await run(
      async (prompt) =>
        prompt.includes(JUDGE_INSTRUCTION) ? JSON.stringify({ status: "ready", reason: "done" }) : `response-${prompt.length}`,
      { maxSteps: 5, minSteps: 2 },
    );

    const loaded = await loadRunSteps(log.runId, db);
    expect(loaded.map((s) => s.stepId)).toEqual([0, 1, 2, 3, 4]);
    expect(loaded.map((s) => s.role)).toEqual(["reasoning", "reasoning", "judge", "compile", "final"]);
    expect(loaded.every((s) => s.runId === log.runId)).toBe(true);

    // filter by role
    const judgeOnly = await filterSteps(log.runId, { role: "judge" }, db);
    expect(judgeOnly).toEqual(loaded.filter((s) => s.role === "judge"));

    // filter by stepId range (inclusive both ends)
    const windowed = await filterSteps(log.runId, { stepIdRange: [0, 1] }, db);
    expect(windowed).toEqual(loaded.filter((s) => s.stepId >= 0 && s.stepId <= 1));

    // the run row itself round-trips, with its final answer
    const storedRun = await db.runs.get(log.runId);
    expect(storedRun).toEqual(log);
    expect(storedRun?.finalAnswer).toBe(log.finalAnswer);
  });

  it("scopes queries to one run when several share the database", async () => {
    const ready = judgeSays({ status: "ready", reason: "done" });
    const first = await run(ready, { maxSteps: 5, minSteps: 1 });
    const second = await run(ready, { maxSteps: 5, minSteps: 1 });

    const firstSteps = await loadRunSteps(first.runId, db);
    expect(firstSteps.every((s) => s.runId === first.runId)).toBe(true);
    expect(await db.runSteps.count()).toBe(firstSteps.length * 2);
    expect(await filterSteps(second.runId, { role: "judge" }, db)).toHaveLength(1);
  });
});
