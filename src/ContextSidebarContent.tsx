import { SheetPanel } from "./SheetPanel";

// Addendum BN: extracted verbatim from App.tsx's .controls-sidebar aside,
// same reasoning as ChatsSidebarContent — a single shared component
// mounted in exactly one of (desktop aside, MobileContextOverlay) at a
// time, never both.
//
// The existing "Context" title + "Manage with AI" trigger get wrapped in
// a new .sidebar-title-actions group alongside the optional mobile-only
// Back button, so .sidebar-title's existing space-between still reads as
// (title) ↔ (actions) — two children — whether or not Back is present.
export function ContextSidebarContent({
  sheetId,
  detailsTab,
  onTabChange,
  onOpenManageWithAI,
  manageAIOpen,
  onToggleManageAI,
  onClose,
}: {
  sheetId: string;
  detailsTab: "chat" | "memories" | "history";
  onTabChange: (tab: "chat" | "memories" | "history") => void;
  onOpenManageWithAI: (prefill?: string) => void;
  manageAIOpen: boolean;
  onToggleManageAI: () => void;
  onClose?: () => void;
}) {
  return (
    <>
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
          {onClose && (
            <button type="button" className="manage-ai-back" onClick={onClose} aria-label="Back">
              ← Back
            </button>
          )}
        </span>
      </h2>
      <SheetPanel sheetId={sheetId} activeTab={detailsTab} onTabChange={onTabChange} onOpenManageWithAI={onOpenManageWithAI} />
    </>
  );
}
