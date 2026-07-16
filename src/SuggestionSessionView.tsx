import { useEffect, useLayoutEffect, useRef } from "react";
import { ChangeCard } from "./ChangeCard";
import { MarkdownText } from "./MarkdownText";
import { getStoredCollapseSuggestionsByDefault } from "./settingsStorage";
import { ToastStack } from "./Toast";
import { describeSuggestion } from "./suggestionDisplay";
import type { DisplaySuggestion, SessionMessage, SuggestionSession } from "./suggestionSession";
import { getRevisingContext } from "./suggestionSession";
import { useCollapsedOverrides } from "./useCollapsedOverrides";
import type { Sheet } from "./types";

// The chat pane's rendering. ManageWithAIPanel uses the same
// underlying useSuggestionSession hook but its own one-shot, non-chat
// rendering instead of this component.
//
// chat mode auto-applies every suggestion the instant it's
// received (surfaced via the toast stack below, with a short Undo window)
// rather than showing a pending review card. That's a
// setting rather than the only option: with it off, a message's
// suggestions stay pending until manually accepted/rejected/revised —
// exactly ManageWithAIPanel's ChangeCard, reused here rather than rebuilt.
// SessionMessage.autoApplied (set once, at creation) is what each message
// remembers about which mode produced it — a mid-conversation toggle only
// affects messages sent after it, not ones already in the transcript.
//
// every message's suggestions block sits behind a "N changes"
// disclosure toggle — conversation/memory updates otherwise made the chat
// quite tall as a conversation grew. Starts expanded by default (unless
// Settings' collapse-by-default toggle is on); any message can still be
// collapsed/expanded individually regardless of that default.
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
    toasts,
    dismissToast,
    undoToast,
  } = session;

  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  // per-message override for the "N changes" disclosure below,
  // falling back to the live global default — flipping the setting should
  // visibly affect messages already on screen, not just future ones (see
  // settingsStorage.ts's comment on why that's different from
  // autoApplied).
  const { isCollapsed: isMessageOverrideCollapsed, toggle: toggleSuggestionsCollapsed } = useCollapsedOverrides<SessionMessage>(
    getStoredCollapseSuggestionsByDefault,
  );

  function isSuggestionsCollapsed(message: SessionMessage): boolean {
    // Never hide the one message whose card is actively being revised —
    // collapsing it mid-revision would strand the "Revising — answer
    // above" hint with nothing visible to attach it to.
    if (revising?.messageId === message.id) return false;
    return isMessageOverrideCollapsed(message);
  }

  const { revisingMessage, revisingTitle } = getRevisingContext(messages, revising, sheet);

  return (
    <div className="chat-pane">
      <div className="chat-messages" ref={messagesRef}>
        {messages.map((message) => (
          <div key={message.id} className={`chat-message chat-message--${message.role}`}>
            {message.role === "assistant" ? <MarkdownText text={message.text} /> : <p>{message.text}</p>}
            {message.suggestions && message.suggestions.length > 0 && (
              <div className="chat-suggestions-block">
                <button
                  type="button"
                  className="chat-suggestions-toggle"
                  onClick={() => toggleSuggestionsCollapsed(message)}
                >
                  <span
                    className={`chat-suggestions-caret${isSuggestionsCollapsed(message) ? "" : " chat-suggestions-caret--flipped"}`}
                    aria-hidden="true"
                  >
                    ⌃
                  </span>
                  {message.suggestions.length} change{message.suggestions.length === 1 ? "" : "s"}
                </button>
                {!isSuggestionsCollapsed(message) && (
                  <MessageSuggestions
                    message={message}
                    sheet={sheet}
                    revisingIndex={revising?.messageId === message.id ? revising.index : null}
                    onAccept={(index) => handleAccept(message, index)}
                    onReject={(index) => handleReject(message, index)}
                    onStartRevision={(index) => startRevision(message.id, index)}
                    onEditBody={(index, body) => editSuggestionBody(message, index, body)}
                  />
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <ToastStack toasts={toasts} onDismiss={dismissToast} onUndo={undoToast} />
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

function MessageSuggestions({
  message,
  sheet,
  revisingIndex,
  onAccept,
  onReject,
  onStartRevision,
  onEditBody,
}: {
  message: SessionMessage;
  sheet: Sheet | null;
  revisingIndex: number | null;
  onAccept: (index: number) => void;
  onReject: (index: number) => void;
  onStartRevision: (index: number) => void;
  onEditBody: (index: number, body: string) => void;
}) {
  const suggestions = message.suggestions ?? [];

  // Every suggestion here already resolved (auto-applied) before this
  // ever rendered, so it's always a plain, non-interactive record — what
  // got applied, or failed to. Also the fallback for an older message
  // saved before the autoApplied field existed (it's undefined there) or
  // one from a mode this view never handles interactively.
  if (message.autoApplied !== false) {
    return (
      <ul className="chat-applied-list">
        {suggestions.map((display, index) => (
          <li key={`${display.suggestion.type}-${index}`} className={display.status === "failed" ? "chat-applied-item--failed" : undefined}>
            <ResolvedSuggestionLine display={display} />
          </li>
        ))}
      </ul>
    );
  }

  // auto-apply off: same split ManageWithAIPanel's
  // ResponseBlock already does — undecided (pending/failed) suggestions
  // are still-interactive ChangeCards, everything else (accepted/
  // rejected/revised) is a plain historical line, same as the auto-apply
  // list above. Unlike ManageWithAIPanel, resolved ones stay visible here
  // rather than disappearing — this is a real transcript, not a one-shot
  // review panel.
  const undecided = suggestions.map((display, index) => ({ display, index })).filter(({ display }) => display.status === "pending" || display.status === "failed");
  const resolved = suggestions.map((display, index) => ({ display, index })).filter(({ display }) => display.status !== "pending" && display.status !== "failed");

  return (
    <>
      {sheet && undecided.length > 0 && (
        <div className="chat-pending-cards">
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
      )}
      {resolved.length > 0 && (
        <ul className="chat-applied-list">
          {resolved.map(({ display }, i) => (
            <li key={`${display.suggestion.type}-${i}`} className={display.status === "failed" ? "chat-applied-item--failed" : undefined}>
              <ResolvedSuggestionLine display={display} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ResolvedSuggestionLine({ display }: { display: DisplaySuggestion }) {
  if (display.status === "failed") {
    return <>Couldn't apply a suggested change — its target may have been deleted since it was proposed.</>;
  }
  const description = describeSuggestion(display.suggestion);
  return (
    <>
      {display.status === "rejected" ? `Rejected: ${description}` : display.status === "revised" ? `Revised: ${description}` : description}
      {display.isFallback && <span className="suggestion-fallback-marker"> (auto-generated — model didn't propose one)</span>}
      {display.isFollowUp && <span className="suggestion-followup-marker"> (requested via a follow-up call)</span>}
    </>
  );
}
