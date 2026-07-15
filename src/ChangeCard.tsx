import { useState } from "react";
import { describeSuggestionChange } from "./suggestionChangeDisplay";
import type { PersistedDisplaySuggestion, Sheet } from "./types";

// Addendum D: a still-undecided suggestion's before/after diff plus
// Accept/Reject/Revise-with-AI — identical regardless of which surface
// produced it. Originally ManageWithAIPanel-only (sheet_editor mode always
// reviews manually); Addendum AA reuses it for chat mode too, but only for
// the pending/failed suggestions left behind when a user has switched chat
// mode's auto-apply setting off (Addendum Z's toast/auto-apply path never
// renders this — its suggestions resolve to "accepted"/"failed" before
// they're ever shown).
export function ChangeCard({
  display,
  sheet,
  onAccept,
  onReject,
  onStartRevision,
  onEditBody,
  revising,
}: {
  display: PersistedDisplaySuggestion;
  sheet: Sheet;
  onAccept: () => void;
  onReject: () => void;
  onStartRevision: () => void;
  onEditBody: (body: string) => void;
  revising: boolean;
}) {
  // Addendum AB: a direct hand-edit of the suggestion's own body, distinct
  // from Revise with AI (which re-asks the model). Only offered for
  // conversation_summary_update and (Addendum AL) compress_conversation —
  // both are plain condensed-text bodies where a quick wording tweak is
  // common enough to want a shortcut that skips a whole extra call, unlike
  // new_memory/edit_memory's label+body or tone_update's more consequential
  // body. Local-only state; nothing here is a version until Accept is
  // actually clicked afterward.
  const [editing, setEditing] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");
  const showEditButton = display.suggestion.type === "conversation_summary_update" || display.suggestion.type === "compress_conversation";

  function startEdit() {
    // Re-checked with its own narrowable condition rather than reusing the
    // showEditButton boolean above — TypeScript can't carry a type-guard
    // through a boolean variable, only through a literal comparison here.
    if (display.suggestion.type !== "conversation_summary_update" && display.suggestion.type !== "compress_conversation") return;
    setBodyDraft(display.suggestion.body);
    setEditing(true);
  }

  const change = describeSuggestionChange(display.suggestion, sheet);

  if (editing) {
    return (
      <div className="change-card">
        <div className="change-card-header">
          <span className="change-card-title">{change.title}</span>
        </div>
        <textarea value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} rows={2} />
        <div className="suggestion-actions">
          <button
            type="button"
            onClick={() => {
              onEditBody(bodyDraft);
              setEditing(false);
            }}
          >
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`change-card${revising ? " change-card--revising" : ""}`}>
      <div className="change-card-header">
        <span className="change-card-title">{change.title}</span>
        {/* Only "failed" ever reaches here — pending/failed are the only
            statuses a caller should be passing to this component at all. */}
        {display.status === "failed" && (
          <span className="suggestion-status suggestion-status--failed">
            memory not found — it may have been deleted since this was proposed
          </span>
        )}
      </div>
      {change.before && <p className="change-card-before">{change.before}</p>}
      <p className="change-card-after">{change.after}</p>
      {display.status === "pending" && (
        <div className="suggestion-actions">
          <button type="button" onClick={onAccept} aria-label="Accept" title="Accept" disabled={revising}>
            ✅
          </button>
          <button type="button" onClick={onReject} aria-label="Reject" title="Reject" disabled={revising}>
            ❌
          </button>
          {showEditButton && (
            <button type="button" className="icon-button" onClick={startEdit} aria-label="Edit" title="Edit" disabled={revising}>
              <span className="icon-emoji">📝</span>
            </button>
          )}
          {/* Addendum AB: with Edit added, a card with showEditButton now
              has four controls — this empty, zero-width spacer claims the
              rest of the current line (flex-basis: 100%) so Revise with AI
              wraps onto its own line, without stretching the button itself
              to fill that line the way giving the button its own flex-basis
              would. Its width stays intrinsic, same as its three-control
              counterpart. */}
          {showEditButton && <span className="suggestion-actions-break" aria-hidden="true" />}
          <button type="button" className="revise-with-ai-button" onClick={onStartRevision} disabled={revising}>
            Revise with AI
          </button>
        </div>
      )}
      {display.status === "failed" && (
        // No Accept here — there's nothing to accept (the suggestion's
        // target no longer exists) — but still needs some way to leave the
        // list without revising, hence Reject as a plain dismiss.
        <div className="suggestion-actions">
          <button type="button" onClick={onReject} aria-label="Reject" title="Dismiss" disabled={revising}>
            ❌
          </button>
          <button type="button" className="revise-with-ai-button" onClick={onStartRevision} disabled={revising}>
            Revise with AI
          </button>
        </div>
      )}
      {revising && <p className="change-card-revising-hint">Revising — answer above.</p>}
    </div>
  );
}
