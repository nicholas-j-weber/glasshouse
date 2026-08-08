import { SheetPanel, type SheetPanelTab } from "./SheetPanel";
import { useEscapeKey } from "./useEscapeKey";
import { useModalFocus } from "./useModalFocus";

// Context's own overlay — a button/overlay at every viewport width now
// (this used to be mobile-only, with a persistent always-visible sidebar
// on desktop; App.tsx's own history has the reasoning for dropping that).
// Hand-rolled overlay rather than a native <dialog>, same as Chats' still-
// mobile-only MobileChatsOverlay: native <dialog> can't reproduce this
// app-body-scoped, header-avoiding positioning (App.css's .context-overlay
// rule + .app-body's position: relative anchor), so this stays a plain
// .modal-overlay div with its own hand-rolled focus trap/Escape handling.
export function ContextOverlay({
  sheetId,
  detailsTab,
  onTabChange,
  manageAIOpen,
  onToggleManageAI,
  onClose,
}: {
  sheetId: string;
  detailsTab: SheetPanelTab;
  onTabChange: (tab: SheetPanelTab) => void;
  manageAIOpen: boolean;
  onToggleManageAI: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalFocus<HTMLDivElement>(true);
  useEscapeKey(onClose);

  return (
    <div className="modal-overlay context-overlay">
      <div className="mobile-panel" ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Context">
        <h2 className="sidebar-title">
          <span>Context</span>
          <span className="sidebar-title-actions">
            <button
              type="button"
              className={`manage-ai-trigger${manageAIOpen ? " manage-ai-trigger--active" : ""}`}
              onClick={onToggleManageAI}
              aria-pressed={manageAIOpen}
            >
              Manage with AI
            </button>
            <button type="button" className="manage-ai-back" onClick={onClose} aria-label="Back">
              ← Back
            </button>
          </span>
        </h2>
        <SheetPanel sheetId={sheetId} activeTab={detailsTab} onTabChange={onTabChange} />
      </div>
    </div>
  );
}
