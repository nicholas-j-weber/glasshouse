import { useDialog } from "./useDialog";

// Replaces the old always-visible Token Estimator banner (SheetPanel.tsx,
// removed) — token count is now purely a background trigger (ChatPane.tsx
// tracks it and decides when to show this), not a persistent stat anyone
// needs to watch. X and "Not now" are functionally identical (both just
// dismiss, handled by onDismiss below) — same shape as WelcomeModal's own
// two-dismissal pattern, just without a permanent-opt-out variant here,
// since this isn't a one-time explanation but a recurring offer.
// "Compress now"'s actual behavior (run immediately vs. open Manage with
// AI for review) is decided by the caller via the Settings auto-run
// toggle, not here — this component only knows "accepted" or "dismissed."
export function CompressionPrompt({ onAccept, onDismiss }: { onAccept: () => void; onDismiss: () => void }) {
  const dialog = useDialog(onDismiss);

  return (
    <dialog
      className="modal"
      ref={dialog.ref}
      onClose={dialog.onClose}
      onClick={dialog.onBackdropClick}
      aria-labelledby="compression-prompt-title"
    >
      <div className="modal-header">
        <h2 id="compression-prompt-title">Context is getting large</h2>
        <button type="button" className="modal-close" onClick={dialog.close} aria-label="Close">
          ×
        </button>
      </div>
      <div className="modal-body">
        <p>Want to condense older conversation turns into a summary and prune stale memories?</p>
      </div>
      <div className="modal-actions">
        <button
          type="button"
          className="modal-action-button"
          onClick={() => {
            onAccept();
            dialog.close();
          }}
        >
          Compress
        </button>
        <button type="button" className="modal-action-button modal-action-button--secondary" onClick={dialog.close}>
          Not now
        </button>
      </div>
    </dialog>
  );
}
