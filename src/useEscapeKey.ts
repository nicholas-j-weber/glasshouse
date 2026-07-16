import { useEffect } from "react";

// Sibling to useModalFocus.ts's shared focus-trap hook — the other
// per-modal concern (SettingsModal, ManageWithAIPanel, MobileChatsOverlay,
// MobileContextOverlay) that was independently hand-rolled four times
// before this existed. `active` defaults to true; MobileChatsOverlay
// passes `!manageAIOpen` so its own listener stays silent while
// ManageWithAIPanel's nested Escape listener (stepping back to the Chats
// list) is the one that should fire instead — one keypress should only
// ever step back one level.
export function useEscapeKey(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onEscape();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onEscape, active]);
}
