import { ContextSidebarContent } from "./ContextSidebarContent";
import type { SheetPanelTab } from "./SheetPanel";
import { useEscapeKey } from "./useEscapeKey";
import { useModalFocus } from "./useModalFocus";

// narrow-viewport presentation of Context, mirroring
// MobileChatsOverlay. Escape here is unconditional — unlike the Chats
// overlay, ManageWithAIPanel never renders inside this one (opening
// Manage with AI from here hands off to the Chats overlay instead, see
// App.tsx's toggleManageAIFromMobileContext), so there's no nested
// Escape listener to defer to.
export function MobileContextOverlay({
  sheetId,
  detailsTab,
  onTabChange,
  onOpenManageWithAI,
  manageAIOpen,
  onToggleManageAI,
  onClose,
}: {
  sheetId: string;
  detailsTab: SheetPanelTab;
  onTabChange: (tab: SheetPanelTab) => void;
  onOpenManageWithAI: (prefill?: string) => void;
  manageAIOpen: boolean;
  onToggleManageAI: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalFocus<HTMLDivElement>(true);
  useEscapeKey(onClose);

  return (
    <div className="modal-overlay mobile-overlay">
      <div
        className="mobile-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Context"
      >
        <ContextSidebarContent
          sheetId={sheetId}
          detailsTab={detailsTab}
          onTabChange={onTabChange}
          onOpenManageWithAI={onOpenManageWithAI}
          manageAIOpen={manageAIOpen}
          onToggleManageAI={onToggleManageAI}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
