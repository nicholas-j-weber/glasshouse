import type { SuggestionToast } from "./suggestionSession";

// the correction window for chat mode's auto-applied
// suggestions — a fixed-position, non-blocking stack (doesn't interrupt
// typing/reading the chat the way a modal or inline review card would),
// stays up for a few seconds, offers Undo while it's showing for anything
// that was actually applied. Once it's gone, correction goes through
// History or direct editing in Memories/This Chat, same as everything else
// in this app already works — this isn't a second, parallel undo system,
// just a short-lived shortcut to the same one.
export function ToastStack({
  toasts,
  onDismiss,
  onUndo,
}: {
  toasts: SuggestionToast[];
  onDismiss: (id: string) => void;
  onUndo: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span className="toast-text">{toast.text}</span>
          <div className="toast-actions">
            {toast.undo && (
              <button type="button" className="toast-undo" onClick={() => onUndo(toast.id)} aria-label="Undo" title="Undo">
                ↩️
              </button>
            )}
            <button type="button" className="toast-dismiss" onClick={() => onDismiss(toast.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
