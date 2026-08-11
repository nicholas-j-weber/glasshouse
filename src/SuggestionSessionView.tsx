import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MarkdownText } from "./MarkdownText";
import { PassTriage } from "./PassTriage";
import { ToastStack } from "./Toast";
import type { SessionMessage, SuggestionSession } from "./suggestionSession";
import { getRevisingContext } from "./suggestionSession";
import type { Sheet } from "./types";

// The chat pane's rendering. ManageWithAIPanel uses the same
// underlying useSuggestionSession hook but its own one-shot, non-chat
// rendering instead of this component.
//
// Chat mode auto-applies every suggestion the instant it's received
// (surfaced via the toast stack below, with a short Undo window). Used to
// also render an inline "N changes" record of what got applied under
// every reply — removed: with the mandatory conversation_summary_update
// firing on every turn, that record was never actually optional (always
// at least 1), and everything in it is already visible in Context and
// each pass's own snapshot in Pass Triage, so it was pure repetition, not
// a real signal. Nothing about applying/undoing changed — toasts (with
// their own Undo window) are still how an applied change announces
// itself, and Context/History still hold the real, permanent record.
export function SuggestionSessionView({
  session,
  sheet,
  inputPlaceholder,
}: {
  session: SuggestionSession;
  sheet: Sheet | null;
  inputPlaceholder: string;
}) {
  const {
    messages,
    draft,
    setDraft,
    isSending,
    routingMode,
    setRoutingMode,
    handleSend,
    revising,
    revisionDraft,
    setRevisionDraft,
    cancelRevision,
    handleRevisionSubmit,
    toasts,
    dismissToast,
    undoToast,
  } = session;

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [triageMessage, setTriageMessage] = useState<SessionMessage | null>(null);

  // Same "jump focus the moment a card's Revise is clicked" behavior as
  // ManageWithAIPanel — typing the follow-up shouldn't need a second click.
  useEffect(() => {
    if (revising) inputRef.current?.focus();
  }, [revising]);

  // auto-scroll .chat-messages to the bottom whenever a new
  // message actually lands, rather than leaving it wherever it happened to
  // be scrolled while the new content appends off-screen below. Scoped to
  // *length increasing* specifically (not just "messages changed") — a
  // suggestion's status flipping (accept/reject/edit) replaces the array
  // reference too, but that's an in-place update to a message already on
  // screen (the one whose card was just clicked), not new content to bring
  // into view, so it shouldn't yank the scroll position around.
  //
  // No "was the user already near the bottom" gate, deliberately: unlike a
  // multi-user chat where someone else's message can land while you're
  // reading old history, every length increase here — sending, an
  // auto/manual reply landing, a revision's follow-up, or a sheet's full
  // history loading in on open — is the direct result of an action the
  // current user themselves just took (or a chat they just opened), so
  // there's no "someone else's content interrupting you" case to guard
  // against.
  const messagesRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(0);

  useLayoutEffect(() => {
    const el = messagesRef.current;
    if (el && messages.length > prevMessageCountRef.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevMessageCountRef.current = messages.length;
  }, [messages]);

  const { revisingMessage, revisingTitle } = getRevisingContext(messages, revising, sheet);

  return (
    <div className="chat-pane">
      <div className="chat-messages" ref={messagesRef}>
        {messages.map((message) => (
          <div key={message.id} className={`chat-message chat-message--${message.role}`}>
            {/* spec.md "Routing: reasoning vs. blackbox" — blackbox isn't
                hidden, it's labeled honestly as unaudited. Only assistant
                messages are "passes" (spec.md "The Pass"); user/error
                messages carry routingMode too but have nothing to audit. */}
            {message.role === "assistant" && message.routingMode === "blackbox" && (
              <span className="routing-badge routing-badge--blackbox" title="Routed direct — no reasoning-agent audit trail">
                Blackbox
              </span>
            )}
            {message.role === "assistant" ? <MarkdownText text={message.text} /> : <p>{message.text}</p>}
            {message.role === "assistant" && (
              <button type="button" className="pass-triage-trigger" onClick={() => setTriageMessage(message)}>
                <span aria-hidden="true">🔍</span> Inspect pass
              </button>
            )}
          </div>
        ))}
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} onUndo={undoToast} />
      {triageMessage && <PassTriage message={triageMessage} onClose={() => setTriageMessage(null)} />}
      {/* spec.md "Routing: reasoning vs. blackbox" — a per-message toggle,
          not a heuristic. "Reasoning" routes the send through
          reasoningAgent.ts's fixed-sequence loop (auditable per-message via
          the "Inspect pass" trigger's PassTriage modal); "Blackbox" is a
          direct call, labeled honestly via the Blackbox badge. Disabled
          mid-send so a pass is always tagged with the routing that actually
          produced it, not one flipped after the call already started. */}
      <div className="segmented-toggle" role="radiogroup" aria-label="Message routing">
        <button
          type="button"
          role="radio"
          aria-checked={routingMode === "blackbox"}
          className={`segmented-toggle-option${routingMode === "blackbox" ? " segmented-toggle-option--active" : ""}`}
          onClick={() => setRoutingMode("blackbox")}
          disabled={isSending}
        >
          Blackbox
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={routingMode === "reasoning"}
          className={`segmented-toggle-option${routingMode === "reasoning" ? " segmented-toggle-option--active" : ""}`}
          onClick={() => setRoutingMode("reasoning")}
          disabled={isSending}
        >
          Reasoning
        </button>
      </div>
      <form
        className="chat-input-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (revising && revisingMessage) {
            void handleRevisionSubmit(revisingMessage, revising.index);
          } else {
            void handleSend();
          }
        }}
      >
        <textarea
          ref={inputRef}
          aria-label={revising ? "Describe how this change should be revised" : "Chat message"}
          value={revising ? revisionDraft : draft}
          onChange={(e) => (revising ? setRevisionDraft(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (revising && revisingMessage) void handleRevisionSubmit(revisingMessage, revising.index);
              else void handleSend();
            }
          }}
          placeholder={revising ? `How should this change?${revisingTitle ? ` — ${revisingTitle}` : ""}` : inputPlaceholder}
          disabled={isSending}
        />
        {revising ? (
          <>
            <button type="submit" className="chat-send chat-send--revising" disabled={isSending || revisionDraft.trim().length === 0}>
              {isSending ? "Sending..." : "Send"}
            </button>
            <button type="button" className="chat-revise-cancel" onClick={cancelRevision} aria-label="Cancel" title="Cancel">
              ×
            </button>
          </>
        ) : (
          <button type="submit" className="chat-send" disabled={isSending || draft.trim().length === 0}>
            {isSending ? "Sending..." : "Send"}
          </button>
        )}
      </form>
    </div>
  );
}
