import { useDialog } from "./useDialog";
import { VersionHistory } from "./VersionHistory";

// History's own button/modal, split out of SheetPanel.tsx's tab row
// (previously alongside This Chat/Memories, briefly alongside Knowledge
// too before that moved to LibraryModal.tsx). History is fundamentally a
// different kind of thing from Context's This Chat/Memories — what
// happened to the sheet over time, not what's currently active — so it
// gets its own header button (clock emoji) rather than sharing Context's.
export function HistoryModal({ sheetId, onClose }: { sheetId: string; onClose: () => void }) {
  const dialog = useDialog(onClose);

  return (
    <dialog
      className="modal modal--history"
      ref={dialog.ref}
      onClose={dialog.onClose}
      onClick={dialog.onBackdropClick}
      aria-labelledby="history-modal-title"
    >
      <div className="modal-header">
        <h2 id="history-modal-title">History</h2>
        <button type="button" className="modal-close" onClick={dialog.close} aria-label="Close history">
          ×
        </button>
      </div>
      <div className="modal-body">
        <VersionHistory sheetId={sheetId} />
      </div>
    </dialog>
  );
}
