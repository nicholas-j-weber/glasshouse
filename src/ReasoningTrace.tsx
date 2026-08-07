import { useState } from "react";
import { db } from "./db";
import { loadRunSteps } from "./reasoningAgent";
import type { RunLog, StepRecord } from "./types";

// spec.md "The Pass" — a reasoning-routed message's audit trail: every
// StepRecord the reasoning agent produced for its RunLog, rendered as an
// expandable list. Same "N changes" disclosure language as
// SuggestionSessionView's .chat-suggestions-toggle, but lazy — a run's
// steps aren't loaded from Dexie until first expanded, since most messages
// in a long chat transcript are never re-opened. Loaded once and cached in
// local state; collapsing and re-expanding doesn't refetch.
export function ReasoningTrace({ runId }: { runId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState<{ run: RunLog | null; steps: StepRecord[] } | null>(null);

  async function toggle() {
    if (!expanded && !loaded) {
      const [run, steps] = await Promise.all([db.runs.get(runId), loadRunSteps(runId)]);
      setLoaded({ run: run ?? null, steps });
    }
    setExpanded((prev) => !prev);
  }

  return (
    <div className="reasoning-trace">
      <button type="button" className="chat-suggestions-toggle" onClick={() => void toggle()}>
        <span className={`chat-suggestions-caret${expanded ? " chat-suggestions-caret--flipped" : ""}`} aria-hidden="true">
          ⌃
        </span>
        Reasoning trace{loaded ? ` — ${loaded.steps.length} step${loaded.steps.length === 1 ? "" : "s"}${statusSuffix(loaded.run)}` : ""}
      </button>
      {expanded && loaded && (
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
      )}
    </div>
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
