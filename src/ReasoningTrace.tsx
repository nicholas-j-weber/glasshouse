import { useEffect, useState } from "react";
import { db } from "./db";
import { loadRunSteps } from "./reasoningAgent";
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
              <span className="reasoning-trace-step-instruction">{step.instruction}</span>
            </div>
            <p className="reasoning-trace-step-response">
              {step.role === "judge" ? judgeVerdictText(step) : step.rawResponse}
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

// A judge step's rawResponse is raw model JSON (sometimes markdown-fenced) —
// unreadable and not what actually drives the loop. The parsed verdict
// already lives in metadata (judgeMetadata in reasoningAgent.ts); show that
// instead. rawResponse itself is untouched in Dexie either way, so nothing
// here costs the audit trail — filterSteps/replayStep still see the exact
// original text.
export function judgeVerdictText(step: StepRecord): string {
  const status = typeof step.metadata?.status === "string" ? step.metadata.status : "unknown";
  const reason = typeof step.metadata?.reason === "string" ? step.metadata.reason : "";
  return reason ? `${status} — ${reason}` : status;
}
