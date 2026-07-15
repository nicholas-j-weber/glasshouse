import { useEffect, useRef, useState } from "react";
import { ChangeCard } from "./ChangeCard";
import { GLOBAL_MEMORIES_SHEET_ID, mergeMemoryPools } from "./globalMemories";
import { MarkdownText } from "./MarkdownText";
import { applyOverlay } from "./sheetOverlay";
import { describeSuggestionChange } from "./suggestionChangeDisplay";
import type { SessionMessage } from "./suggestionSession";
import { useSuggestionSession } from "./suggestionSession";
import { useHeadVersion } from "./useHeadVersion";
import { useSheetOverlay } from "./useSheetOverlay";
import type { Sheet } from "./types";

// §6.3's AI-collaboration surface, reimagined as a one-shot review panel
// instead of a back-and-forth embedded chat (the previous SheetEditor.tsx,
// now removed): the user describes a restructuring in one instruction, gets
// back a set of proposed changes shown as before/after cards, and
// accepts/rejects/revises each — no ongoing conversation, no transcript.
// Reuses useSuggestionSession's "sheet_editor" mode entirely unchanged
// (SHEET_EDITOR_PREAMBLE was already written for exactly this — "not a
// conversation," "minimal or no conversational text" — so nothing about the
// underlying call/accept/reject/revise mechanics needed to change, only
// the rendering).
//
// Was originally a centered modal (ManageWithAIModal) with a dimmed
// backdrop blocking the rest of the page — which defeated the actual goal
// (referencing the live chat and Context panel while using it). Now it
// temporarily occupies the Chats column instead (App.tsx swaps it in for
// SheetSwitcher), so the chat pane and Context panel both stay visible and
// interactive the whole time; Back returns the column to showing chats.
//
// Once Context was visible alongside this panel instead of hidden behind
// it, its persisted-forever change cards (same IndexedDB-backed history the
// real chat transcript uses) started looking redundant with it — an
// accepted card's "after" duplicates what the Context panel already shows
// live, and its "before" duplicates what History already shows, with a
// real diff and revert. So ResponseBlock only ever renders undecided
// (pending/failed) cards — the moment one's accepted, rejected, or revised,
// it disappears rather than sticking around with a status badge. This
// panel was already documented as "no transcript" above; this makes that
// true in practice, not just in the messages filter that drops the user's
// own instructions.
//
// Revise used to be its own inline form on each card — but it's really
// just another instruction call (identical mechanics to the main field,
// per Addendum D), auto-scoped to one prior suggestion instead of
// freeform. Rather than two parallel input mechanisms that do almost the
// same thing, clicking a card's Revise now re-aims the *same* top field at
// that suggestion: the label swaps to "How should this change?", the field
// binds to revisionDraft instead of draft, and Go is replaced by a button
// that reads Send once there's something typed, Cancel otherwise (Addendum
// AF — one button doing double duty, not Send and Cancel shown together).
// The card itself just shows which one is currently targeted, rather than
// growing its own form. (The chat pane's inline revise, same underlying
// hook in "chat" mode, deliberately keeps its own separate form — there's
// no equivalent "main restructuring field" mid-conversation to route
// through there.)
export function ManageWithAIPanel({
  sheetId,
  initialDraft,
  onBack,
}: {
  sheetId: string;
  // Addendum AL: set by App.tsx when something (currently only the Token
  // Estimator's compression banner) wants this panel to open pre-filled
  // with a starting instruction — the field's normal empty default
  // otherwise. Still just a pre-fill, not auto-submitted; the user reviews
  // or edits it like any other instruction before clicking Go.
  initialDraft?: string;
  onBack: () => void;
}) {
  const session = useSuggestionSession("sheet_editor", sheetId);
  const localHead = useHeadVersion(sheetId);
  const globalHead = useHeadVersion(GLOBAL_MEMORIES_SHEET_ID);
  const overlay = useSheetOverlay();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Error and "no changes needed" responses have no suggestion of their own
  // to accept/reject, so unlike a change card (which vanishes once decided)
  // or a note alongside cards (which vanishes once all of those are
  // decided), they had no way to ever leave the panel — they just piled up
  // across a session. Plain local state, not persisted: this panel remounts
  // fresh every time it's opened (App.tsx conditionally mounts it), which
  // already clears this the same way the rest of the panel is ephemeral.
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  function dismissMessage(id: string) {
    setDismissedIds((prev) => new Set(prev).add(id));
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onBack();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onBack]);

  const {
    draft,
    setDraft,
    isSending,
    handleSend,
    handleAccept,
    handleReject,
    revising,
    revisionDraft,
    setRevisionDraft,
    startRevision,
    cancelRevision,
    handleRevisionSubmit,
    editSuggestionBody,
  } = session;

  // Addendum AL: applies the compression banner's (or anything else's)
  // pre-filled instruction once, right after this panel mounts — runs
  // exactly once per mount since this panel is conditionally rendered by
  // App.tsx (a fresh instance every time it's opened, never reused across
  // opens), so there's no risk of a stale initialDraft re-applying itself
  // over something the user has already started typing.
  useEffect(() => {
    if (initialDraft) setDraft(initialDraft);
    // Deliberately empty deps — once per mount only, see comment above.
  }, []);

  // Jump focus to the (now re-aimed) field the moment a card's Revise is
  // clicked, so typing the follow-up doesn't need a second click.
  useEffect(() => {
    if (revising) inputRef.current?.focus();
  }, [revising]);

  // Filters out the user's own instruction messages — this view only ever
  // shows the AI's side (errors, notes, and change cards), never a
  // transcript of what was typed, since that's the whole point of not being
  // a chat — and now also anything manually dismissed above.
  const responses = session.messages.filter((m) => m.role !== "user" && !dismissedIds.has(m.id));

  const sheet = localHead && globalHead ? applyOverlay(mergeMemoryPools(localHead.sheet, globalHead.sheet), overlay) : null;

  // A short reference to what's being revised, so the label stays
  // meaningful even if the target card has scrolled out of view (the panel
  // body is one shared scroll region — the field isn't sticky above it).
  const revisingMessage = revising ? session.messages.find((m) => m.id === revising.messageId) : undefined;
  const revisingDisplay = revising ? revisingMessage?.suggestions?.[revising.index] : undefined;
  const revisingTitle = sheet && revisingDisplay ? describeSuggestionChange(revisingDisplay.suggestion, sheet).title : null;

  return (
    <div className="manage-ai-panel">
      {/* Same title-bar treatment as "Chats"/"Context" (.sidebar-title) so
          this reads as a natural occupant of the same column, not a
          different kind of surface. */}
      <h2 className="sidebar-title">
        <span>Manage with AI</span>
        <button type="button" className="manage-ai-back" onClick={onBack} aria-label="Back">
          ← Back
        </button>
      </h2>
      <div className="manage-ai-panel-body">
        <p className="manage-ai-label">
          {revising
            ? `How should this change?${revisingTitle ? ` — ${revisingTitle}` : ""}`
            : "Describe how you want your context restructured — e.g. merge duplicate memories, prune stale ones, adjust tone, reorder pins."}
        </p>
        <form
          className="manage-ai-input-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (revising && revisingMessage) {
              // Guards the case where the button is currently showing as
              // Cancel (nothing typed, or already sending) — a submit could
              // only reach here via a keyboard Enter in that state, since
              // the rendered button itself is type="button" then, not
              // type="submit".
              if (revisionDraft.trim().length > 0 && !isSending) {
                void handleRevisionSubmit(revisingMessage, revising.index);
              }
            } else {
              void handleSend();
            }
          }}
        >
          <div className="inline-field">
            <textarea
              ref={inputRef}
              className="inline-field-input"
              aria-label={revising ? "Describe how this change should be revised" : "Describe how you want your context restructured"}
              value={revising ? revisionDraft : draft}
              onChange={(e) => (revising ? setRevisionDraft(e.target.value) : setDraft(e.target.value))}
              disabled={isSending}
              rows={4}
            />
            {revising ? (
              revisionDraft.trim().length > 0 && !isSending ? (
                <button type="submit" className="inline-field-button manage-ai-send" aria-label="Send" title="Send">
                  Send
                </button>
              ) : (
                <button
                  type="button"
                  className="inline-field-button manage-ai-cancel"
                  onClick={cancelRevision}
                  aria-label="Cancel"
                  title="Cancel"
                >
                  Cancel
                </button>
              )
            ) : (
              <button type="submit" className="inline-field-button manage-ai-go" disabled={isSending || draft.trim().length === 0}>
                {isSending ? "Thinking…" : "Go"}
              </button>
            )}
          </div>
        </form>

        <div className="manage-ai-changes">
          {responses.length === 0 && (
            <p className="manage-ai-empty">Nothing proposed yet.</p>
          )}
          {sheet &&
            responses.map((message) => (
              <ResponseBlock
                key={message.id}
                message={message}
                sheet={sheet}
                onAccept={(index) => handleAccept(message, index)}
                onReject={(index) => handleReject(message, index)}
                onStartRevision={(index) => startRevision(message.id, index)}
                onEditBody={(index, body) => editSuggestionBody(message, index, body)}
                onDismiss={() => dismissMessage(message.id)}
                revisingIndex={revising?.messageId === message.id ? revising.index : null}
              />
            ))}
        </div>
      </div>
    </div>
  );
}

function ResponseBlock({
  message,
  sheet,
  onAccept,
  onReject,
  onStartRevision,
  onEditBody,
  onDismiss,
  revisingIndex,
}: {
  message: SessionMessage;
  sheet: Sheet;
  onAccept: (index: number) => void;
  onReject: (index: number) => void;
  onStartRevision: (index: number) => void;
  onEditBody: (index: number, body: string) => void;
  onDismiss: () => void;
  revisingIndex: number | null;
}) {
  if (message.role === "error") {
    return (
      <p className="manage-ai-error">
        <span className="manage-ai-error-text">{message.text}</span>
        <button type="button" className="manage-ai-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </p>
    );
  }

  if (!message.suggestions || message.suggestions.length === 0) {
    // §6.3.1 explicitly allows "no changes are warranted" as a valid reply.
    // Neither branch here has a suggestion of its own to accept/reject, so
    // — unlike a change card or a note that disappears alongside its now-
    // resolved cards — nothing else would ever make this go away.
    return (
      <div className="manage-ai-empty">
        {message.text ? <MarkdownText text={message.text} /> : <p>No changes suggested.</p>}
        <button type="button" className="manage-ai-dismiss" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
    );
  }

  // Unlike the chat pane (a real transcript, where past accept/reject/
  // revise decisions stay visible with a status badge), this panel isn't
  // one (see the file-level comment) — once a card's decision is made,
  // there's a better place to review it than a stale card here: an
  // accepted change becomes a version, and History already shows a real
  // diff plus offers revert; a rejected one left nothing behind worth
  // remembering. So only still-pending suggestions render here at all
  // ("failed" counts as pending a decision too — it just doesn't offer
  // Accept, since there's nothing to accept). Indices are preserved from
  // the original array (not the filtered one) since onAccept/onReject/
  // onStartRevision all address a suggestion by its real position in
  // message.suggestions.
  const undecided = message.suggestions
    .map((display, index) => ({ display, index }))
    .filter(({ display }) => display.status === "pending" || display.status === "failed");

  if (undecided.length === 0) return null; // every card in this response has been resolved

  return (
    <div className="manage-ai-response">
      {message.text && (
        <div className="manage-ai-note">
          <MarkdownText text={message.text} />
        </div>
      )}
      {undecided.map(({ display, index }) => (
        <ChangeCard
          key={`${message.id}-${index}`}
          display={display}
          sheet={sheet}
          onAccept={() => onAccept(index)}
          onReject={() => onReject(index)}
          onStartRevision={() => onStartRevision(index)}
          onEditBody={(body) => onEditBody(index, body)}
          revising={revisingIndex === index}
        />
      ))}
    </div>
  );
}
