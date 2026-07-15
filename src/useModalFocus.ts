import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Shared by every modal-like surface (SettingsModal, WelcomeModal,
// MobileChatsOverlay, MobileContextOverlay) — confirmed live via Playwright
// that none of them moved focus on open, trapped it while open, or restored
// it on close before this hook existed: opening Settings left focus sitting
// on the gear button, Tab escaped into the dimmed chat behind it within a
// few presses, and closing it dropped focus onto <body> rather than back on
// the button that opened it. One hook instead of four hand-rolled copies,
// so all four stay in sync if the pattern ever needs to change.
//
// Takes `open` rather than relying on mount/unmount — SettingsModal and the
// two mobile overlays are only ever mounted while open (so mount/unmount
// would work for them), but WelcomeModal stays mounted for the whole
// session and just renders null internally once dismissed, so "did the
// effect's dependency change" is the only signal that works for all four
// uniformly.
export function useModalFocus<T extends HTMLElement>(open: boolean) {
  const panelRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return panelRef;
}
