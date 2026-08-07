import { CodeDiffFiles, useCodeDiff } from "./CodeDiffView";
import { ReasoningTraceSteps, useReasoningTrace } from "./ReasoningTrace";
import type { SessionMessage } from "./suggestionSession";
import { useDialog } from "./useDialog";

// spec.md "The Pass" — one assistant reply's lanes (context sent,
// reasoning trace, code diff), side by side, replacing the old separate
// per-message ReasoningTrace/CodeDiffView toggles. Every assistant message
// gets this trigger, even a plain blackbox text reply with nothing in the
// reasoning-trace pane — that pane still gets an honest empty state rather
// than being hidden. The code diff pane is the exception: it's absent on
// most passes (code_change is only ever legal in "code" contentMode, per
// systemPrompt.ts), so a message with no codeVersionId drops the pane
// entirely instead of showing a near-permanent "No code changes" — the
// other two panes get the freed-up width instead.
export function PassTriage({ message, onClose }: { message: SessionMessage; onClose: () => void }) {
  const dialog = useDialog(onClose);
  const reasoning = useReasoningTrace(message.routingMode === "reasoning" ? message.reasoningRunId : undefined);
  const diffs = useCodeDiff(message.codeVersionId);

  return (
    <dialog
      className="modal modal--pass-triage"
      ref={dialog.ref}
      onClose={dialog.onClose}
      onClick={dialog.onBackdropClick}
      aria-labelledby="pass-triage-title"
    >
      <div className="modal-header">
        <h2 id="pass-triage-title">Pass details</h2>
        <button type="button" className="modal-close" onClick={dialog.close} aria-label="Close pass details">
          ×
        </button>
      </div>
      <div className="modal-body pass-triage-body">
        <section className="sheet-section pass-triage-pane">
          <h2>Context sent</h2>
          {message.contextSnapshot ? (
            <pre className="pass-triage-snapshot">{message.contextSnapshot}</pre>
          ) : (
            <p className="sheet-section-caption">Not captured for this pass.</p>
          )}
        </section>
        <section className="sheet-section pass-triage-pane">
          <h2>Reasoning trace</h2>
          {message.routingMode === "blackbox" ? (
            <p className="sheet-section-caption">Blackbox pass — no reasoning-agent audit trail.</p>
          ) : (
            <ReasoningTraceSteps loaded={reasoning} />
          )}
        </section>
        {message.codeVersionId && (
          <section className="sheet-section pass-triage-pane">
            <h2>Code diff</h2>
            <CodeDiffFiles diffs={diffs} />
          </section>
        )}
      </div>
    </dialog>
  );
}
