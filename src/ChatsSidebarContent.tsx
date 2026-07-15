import { ManageWithAIPanel } from "./ManageWithAIPanel";
import { SheetSwitcher } from "./SheetSwitcher";
import type { SheetMeta } from "./types";

// extracted verbatim from App.tsx's .chats-sidebar aside so
// the exact same content can be mounted in either the desktop aside or
// the narrow-viewport MobileChatsOverlay — never both at once (App.tsx
// guards the desktop copy with !mobileChatsOpen). Two live instances of
// ManageWithAIPanel at the same time would mean two independent
// useSuggestionSession hooks silently drifting apart, so this being a
// single shared component rendered in exactly one place is load-bearing,
// not just a DRY nicety.
//
// onClose is only passed by the mobile call site — it renders the "←
// Back" button inside the title row. The desktop aside never passes it,
// so its title stays exactly as plain as it's always been.
export function ChatsSidebarContent({
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
  onClose?: () => void;
}) {
  return manageAIOpen ? (
    <ManageWithAIPanel sheetId={activeSheetId} initialDraft={manageAIPrefill} onBack={onManageAIBack} />
  ) : (
    <>
      <h2 className="sidebar-title">
        <span>Chats</span>
        {onClose && (
          <button type="button" className="manage-ai-back" onClick={onClose} aria-label="Back">
            ← Back
          </button>
        )}
      </h2>
      <SheetSwitcher sheets={sheets} activeSheetId={activeSheetId} onCreate={onCreate} />
    </>
  );
}
