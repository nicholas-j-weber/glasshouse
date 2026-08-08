import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { db } from "./db";
import { JUDGE_INSTRUCTION, loadRunSteps } from "./reasoningAgent";
import type { RunLog, StepRecord } from "./types";

export type ReasoningTraceData = { run: RunLog | null; steps: StepRecord[] };

// spec.md "The Pass" — a reasoning-routed message's audit trail: every
// StepRecord the reasoning agent produced for its RunLog. Fetched fresh each
// time runId changes (and reset to null when it's undefined) — PassTriage.tsx
// mounts this fresh per open rather than keeping it cached across opens, an
// acceptable tradeoff for a local IndexedDB read.
export function useReasoningTrace(runId: string | undefined): ReasoningTraceData | null {
  const [loaded, setLoaded] = useState<ReasoningTraceData | null>(null);

  useEffect(() => {
    if (!runId) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    void Promise.all([db.runs.get(runId), loadRunSteps(runId)]).then(([run, steps]) => {
      if (!cancelled) setLoaded({ run: run ?? null, steps });
    });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return loaded;
}

// Pure renderer — the step list plus its status-suffixed count header, same
// markup the old standalone toggle widget used, minus the toggle itself.
export function ReasoningTraceSteps({ loaded }: { loaded: ReasoningTraceData | null }) {
  if (!loaded) return null;
  return (
    <>
      <p className="sheet-section-caption">
        {loaded.steps.length} step{loaded.steps.length === 1 ? "" : "s"}
        {statusSuffix(loaded.run)}
      </p>
      <ol className="reasoning-trace-steps">
        {loaded.steps.map((step) => (
          <li key={step.stepId} className={`reasoning-trace-step reasoning-trace-step--${step.role}`}>
            <div className="reasoning-trace-step-header">
              <span className="reasoning-trace-step-role">{step.role}</span>
              <span className="reasoning-trace-step-instruction">
                {step.role === "judge" ? judgeStepLabel(step) : step.instruction}
              </span>
            </div>
            <p className="reasoning-trace-step-response">
              {step.role === "judge" ? judgeVerdictNode(step) : step.rawResponse}
            </p>
          </li>
        ))}
      </ol>
    </>
  );
}

function statusSuffix(run: RunLog | null): string {
  if (run?.status === "max_steps_reached") return " (hit max steps)";
  if (run?.status === "error") return " (error)";
  return "";
}

// JUDGE_INSTRUCTION is the literal prompt sent to the model ("Respond with
// ONLY a JSON object of the form {...}") — accurate for audit (it's exactly
// what the model saw, and step.instruction itself is untouched in Dexie
// either way) but meaningless prompt-engineering plumbing to a user reading
// the trace. The structural-completion-check judge step's own instruction
// ("Structural completion check", reasoningAgent.ts) is already
// human-readable and passes through unchanged.
export function judgeStepLabel(step: StepRecord): string {
  return step.instruction === JUDGE_INSTRUCTION ? "Checking whether the reasoning so far is enough to answer" : step.instruction;
}

function parseJudgeVerdict(step: StepRecord): { status: string; reason: string } {
  const status = typeof step.metadata?.status === "string" ? step.metadata.status : "unknown";
  const reason = typeof step.metadata?.reason === "string" ? step.metadata.reason : "";
  return { status, reason };
}

// A judge step's rawResponse is raw model JSON (sometimes markdown-fenced) —
// unreadable and not what actually drives the loop. The parsed verdict
// already lives in metadata (judgeMetadata in reasoningAgent.ts); show that
// instead. rawResponse itself is untouched in Dexie either way, so nothing
// here costs the audit trail — filterSteps/replayStep still see the exact
// original text. Plain-string form, kept separate from judgeVerdictNode
// below for anything that wants the verdict as text rather than markup.
export function judgeVerdictText(step: StepRecord): string {
  const { status, reason } = parseJudgeVerdict(step);
  return reason ? `${status} — ${reason}` : status;
}

// "ready" and "abandon" are the two terminal verdicts — the ones that
// actually change what happens next (the loop stops, one way or the
// other) — unlike "continue", the expected, keep-scrolling case. Bolded +
// capitalized so either one visually pops out of a long list of
// "continue" steps: a run that gave up early is just as worth noticing as
// one that finished cleanly, not just the success case.
export function judgeVerdictNode(step: StepRecord): ReactNode {
  const { status, reason } = parseJudgeVerdict(step);
  const emphasize = status === "ready" || status === "abandon";
  const statusNode = emphasize ? <strong>{status.toUpperCase()}</strong> : status;
  return reason ? (
    <>
      {statusNode} — {reason}
    </>
  ) : (
    statusNode
  );
}
