import { useEffect } from "react";
import { ChatsSidebarContent } from "./ChatsSidebarContent";
import type { SheetMeta } from "./types";
import { useModalFocus } from "./useModalFocus";

// Addendum BN: the narrow-viewport (< 1024px, App.css) presentation of
// Chats — a full-screen overlay reusing .modal-overlay's existing
// backdrop, rather than trying to make the desktop .chats-sidebar column
// itself stretch via a media query. No onClick on .modal-overlay here:
// unlike Settings/Welcome (centered dialogs with visible backdrop around
// their edges), .mobile-panel fills 100% of the overlay, so there's no
// clickable backdrop gap left — dismissal is the Back button, re-tapping
// the header trigger, or Escape only.
export function MobileChatsOverlay({
  manageAIOpen,
  sheets,
  activeSheetId,
  onCreate,
  manageAIPrefill,
  onManageAIBack,
  onClose,
}: {
  manageAIOpen: boolean;
  sheets: SheetMeta[];
  activeSheetId: string;
  onCreate: (id: string) => void;
  manageAIPrefill?: string;
  onManageAIBack: () => void;
  onClose: () => void;
}) {
  const panelRef = useModalFocus<HTMLDivElement>(true);

  // Guarded on !manageAIOpen: ManageWithAIPanel (rendered inside
  // ChatsSidebarContent when manageAIOpen is true) already has its own
  // document-level Escape listener that steps back to the Chats list
  // (onManageAIBack). Without this guard, both listeners would fire on
  // the same keypress and Escape would skip past the Chats list straight
  // to closing this whole overlay — one press should only ever step back
  // one level.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !manageAIOpen) onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, manageAIOpen]);

  return (
    <div className="modal-overlay mobile-overlay">
      <div
        className="mobile-panel"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={manageAIOpen ? "Manage with AI" : "Chats"}
      >
        <ChatsSidebarContent
          manageAIOpen={manageAIOpen}
          sheets={sheets}
          activeSheetId={activeSheetId}
          onCreate={onCreate}
          manageAIPrefill={manageAIPrefill}
          onManageAIBack={onManageAIBack}
          onClose={onClose}
        />
      </div>
    </div>
  );
}
