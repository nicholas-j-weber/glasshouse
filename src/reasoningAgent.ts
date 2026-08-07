import Dexie from "dexie";
import type { ContextSheetDB } from "./db";
import { db as defaultDb } from "./db";
import type { RunLog, StepRecord, StepRole } from "./types";

// Port of reasoning-agent's agent.py (spec.md "Reasoning agent"), plus one
// deliberate deviation from a 1:1 port: a "compile" step now sits between
// the reasoning loop and the final answer, turning "compile a final prompt
// and submit it statelessly" into a real, auditable artifact instead of
// just the loop's last automatic iteration. Every step up through compile
// keeps the original no-lossy-summarization property (each prompt is a
// superset of the transcript before it); the final call is the one
// intentional exception — it submits the compiled/distilled prompt (plus an
// optional caller-supplied finalPromptSuffix, e.g. output-format
// instructions the compile step isn't reliably guaranteed to preserve on
// its own), not another transcript dump. Runtime (browser) and persistence
// (Dexie instead of JSONL append) also differ from the Python original.
// Provider-agnostic by design: modelCallFn is an opaque string -> string,
// wired to a real provider in a later milestone.
//
// Not ported for v1 (spec.md "What does not port"): pytest_structural_check
// (Python/subprocess-specific — structuralCheckFn stays a typed extension
// point with nothing wired in by default) and dynamic instruction routing /
// abandon branch-back (still a stretch goal).

export const MODEL_NAME = "stub-model";

export const FIXED_SEQUENCE = [
  "Restate the problem in your own words to confirm understanding.",
  "Generate several candidate approaches.",
  "Evaluate each candidate approach.",
  "Select and justify one approach.",
  "Sanity-check the selection.",
];

export const JUDGE_INSTRUCTION =
  "Assess whether the reasoning transcript above is sufficient to produce " +
  "a final answer. Respond with ONLY a JSON object of the form " +
  '{"status": "continue" | "ready" | "abandon", "reason": "..."} ' +
  "and nothing else.";

export const COMPILE_INSTRUCTION =
  "Given the full transcript above, synthesize everything into the exact, " +
  "self-contained prompt that should be sent to produce the final answer. " +
  "Respond with ONLY that prompt text, nothing else.";

export type ModelCallFn = (prompt: string) => Promise<string>;

export type JudgeStatus = "continue" | "ready" | "abandon";

export interface JudgeVerdict {
  status: JudgeStatus;
  reason: string;
}

// A structural check inspects the transcript and either returns a verdict
// or null to mean "no verdict, defer to the judge call." Domain-specific
// (test suites, solvers, etc.) — no check is required, and none is wired
// in by default.
export type StructuralCheckFn = (transcript: StepRecord[]) => JudgeVerdict | null;

export function buildPrompt(
  problem: string,
  topLevelInstructions: string,
  transcript: StepRecord[],
  currentInstruction: string,
): string {
  const parts = [`PROBLEM:\n${problem}`, `INSTRUCTIONS:\n${topLevelInstructions}`];
  for (const step of transcript) {
    parts.push(
      `--- STEP ${step.stepId} (${step.role}) ---\n` +
        `Instruction: ${step.instruction}\n` +
        `Response: ${step.rawResponse}`,
    );
  }
  parts.push(`CURRENT INSTRUCTION:\n${currentInstruction}`);
  return parts.join("\n\n");
}

// --- observability: the Python spec's load/filter/replay, as Dexie queries.
// Falls out of runSteps' existing indexes ("[runId+stepId], runId, role") —
// no separate query layer.

export function loadRunSteps(runId: string, db: ContextSheetDB = defaultDb): Promise<StepRecord[]> {
  return filterSteps(runId, {}, db);
}

// Filter a run's steps by role and/or an inclusive [start, end] stepId
// range. Ordered by stepId (the compound primary key's ordering).
export function filterSteps(
  runId: string,
  { role, stepIdRange }: { role?: StepRole; stepIdRange?: [number, number] } = {},
  db: ContextSheetDB = defaultDb,
): Promise<StepRecord[]> {
  const [lo, hi] = stepIdRange ?? [Dexie.minKey, Dexie.maxKey];
  const range = db.runSteps.where("[runId+stepId]").between([runId, lo], [runId, hi], true, true);
  return (role === undefined ? range : range.and((s) => s.role === role)).toArray();
}

// Resend the exact prompt for a given run/step to reproduce or test a fix.
export async function replayStep(
  runId: string,
  stepId: number,
  modelCallFn: ModelCallFn,
  db: ContextSheetDB = defaultDb,
): Promise<string> {
  const step = await db.runSteps.get([runId, stepId]);
  if (!step) throw new Error(`no step ${stepId} found in run ${runId}`);
  return modelCallFn(step.prompt);
}

function judgeMetadata(method: string, status: JudgeStatus, reason: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = { method, status, reason };
  if (status === "abandon") {
    // branch-back is a stretch goal — for now, abandon just continues the
    // loop like any other non-ready verdict.
    metadata.treated_as = "continue";
  }
  return metadata;
}

function structuralCheckStep(
  runId: string,
  stepId: number,
  transcript: StepRecord[],
  structuralCheckFn: StructuralCheckFn,
): StepRecord | null {
  const result = structuralCheckFn(transcript);
  if (result === null) return null;
  return {
    runId,
    stepId,
    role: "judge",
    instruction: "Structural completion check",
    prompt: "(no model call — deterministic structural check)",
    rawResponse: JSON.stringify(result),
    timestamp: new Date().toISOString(),
    model: "none",
    metadata: judgeMetadata("structural", result.status, result.reason),
  };
}

// Real models routinely wrap "respond with ONLY JSON" output in a markdown
// code fence anyway (```json ... ```) — strip one before parsing so that
// habit doesn't silently downgrade every verdict to "continue".
function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : text.trim();
}

async function judgeStep(
  runId: string,
  stepId: number,
  problem: string,
  topLevelInstructions: string,
  transcript: StepRecord[],
  modelCallFn: ModelCallFn,
  modelName: string,
): Promise<StepRecord> {
  const prompt = buildPrompt(problem, topLevelInstructions, transcript, JUDGE_INSTRUCTION);
  const rawResponse = await modelCallFn(prompt);

  let status: JudgeStatus = "continue";
  let reason = "";
  try {
    const parsed: unknown = JSON.parse(stripCodeFence(rawResponse));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not a JSON object");
    const verdict = parsed as Partial<JudgeVerdict>;
    status = verdict.status ?? "continue";
    reason = verdict.reason ?? "";
  } catch (e) {
    // Unparseable judge output must not crash the loop — an unreadable
    // verdict is treated as "keep going", and says so in the log.
    status = "continue";
    reason = `unparseable judge response: ${e instanceof Error ? e.message : String(e)}`;
  }

  return {
    runId,
    stepId,
    role: "judge",
    instruction: JUDGE_INSTRUCTION,
    prompt,
    rawResponse,
    timestamp: new Date().toISOString(),
    model: modelName,
    metadata: judgeMetadata("model", status, reason),
  };
}

export interface RunReasoningAgentOptions {
  sheetId: string;
  chatMessageId: string;
  problem: string;
  topLevelInstructions: string;
  modelCallFn: ModelCallFn;
  maxSteps?: number;
  minSteps?: number;
  structuralCheckFn?: StructuralCheckFn;
  // Appended directly to the compiled prompt before the final call —
  // domain-agnostic on this side (just a string tacked on), but lets a
  // caller (e.g. suggestionSession.ts's SUGGESTION_INSTRUCTIONS) guarantee
  // the final answer carries formatting requirements the compile step isn't
  // reliably guaranteed to preserve when it synthesizes its own prompt.
  finalPromptSuffix?: string;
  modelName?: string;
  db?: ContextSheetDB;
}

export async function runReasoningAgent({
  sheetId,
  chatMessageId,
  problem,
  topLevelInstructions,
  modelCallFn,
  maxSteps = 10,
  minSteps = FIXED_SEQUENCE.length,
  structuralCheckFn,
  finalPromptSuffix,
  modelName = MODEL_NAME,
  db = defaultDb,
}: RunReasoningAgentOptions): Promise<RunLog> {
  const run: RunLog = {
    runId: crypto.randomUUID(),
    sheetId,
    chatMessageId,
    originalProblem: problem,
    topLevelInstructions,
    status: "running",
  };
  await db.runs.put(run);

  const steps: StepRecord[] = [];
  // Each record is written the moment it exists, never batched at the end —
  // same "durable even mid-crash" requirement as the JSONL original.
  const persist = async (record: StepRecord) => {
    steps.push(record);
    await db.runSteps.put(record);
  };

  let ready = false;
  for (let stepNum = 0; stepNum < maxSteps; stepNum++) {
    const instruction = FIXED_SEQUENCE[stepNum % FIXED_SEQUENCE.length];
    const prompt = buildPrompt(problem, topLevelInstructions, steps, instruction);
    const response = await modelCallFn(prompt);
    await persist({
      runId: run.runId,
      stepId: steps.length,
      role: "reasoning",
      instruction,
      prompt,
      rawResponse: response,
      timestamp: new Date().toISOString(),
      model: modelName,
    });

    if (stepNum + 1 >= minSteps) {
      const structural = structuralCheckFn
        ? structuralCheckStep(run.runId, steps.length, steps, structuralCheckFn)
        : null;
      const record =
        structural ??
        (await judgeStep(run.runId, steps.length, problem, topLevelInstructions, steps, modelCallFn, modelName));
      await persist(record);
      if (record.metadata?.status === "ready") {
        ready = true;
        break;
      }
    }
  }
  // Python's `for ... else`: falling out of the loop without the judge ever
  // saying "ready" means the hard ceiling capped the run.
  if (!ready) run.status = "max_steps_reached";

  // Compile step: the one deliberate break from "every step's prompt is a
  // superset of the transcript" — its job is to distill the (still fully
  // lossless, still fully audited) transcript above into a standalone
  // prompt. That compiled text, not another transcript dump, is what
  // actually gets submitted as the final call.
  const compilePrompt = buildPrompt(problem, topLevelInstructions, steps, COMPILE_INSTRUCTION);
  const compiledPrompt = await modelCallFn(compilePrompt);
  await persist({
    runId: run.runId,
    stepId: steps.length,
    role: "compile",
    instruction: COMPILE_INSTRUCTION,
    prompt: compilePrompt,
    rawResponse: compiledPrompt,
    timestamp: new Date().toISOString(),
    model: modelName,
  });

  const finalPrompt = finalPromptSuffix ? `${compiledPrompt}\n\n${finalPromptSuffix}` : compiledPrompt;
  const finalResponse = await modelCallFn(finalPrompt);
  await persist({
    runId: run.runId,
    stepId: steps.length,
    role: "final",
    instruction: "Produce final answer",
    prompt: finalPrompt,
    rawResponse: finalResponse,
    timestamp: new Date().toISOString(),
    model: modelName,
  });

  run.finalAnswer = finalResponse;
  // A final answer is produced either way — "max_steps_reached" records
  // *how* the loop ended, it isn't a failure.
  if (run.status === "running") run.status = "completed";
  await db.runs.put(run);
  return run;
}
