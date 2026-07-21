import { useEffect, useRef } from "react";

// Wires a native <dialog> up to the "open modally as soon as it mounts,
// tell the caller once it's actually closed" shape shared by SettingsModal
// and WelcomeModal. <dialog> shown via showModal() already gives the focus
// trap, initial focus placement, and focus-restore-on-close for free — the
// previous hand-rolled useModalFocus/useEscapeKey pair (still used by the
// two mobile overlays, which can't move to <dialog>: see MobileChatsOverlay's
// comment) existed only to fake that. Every dismissal (Escape, a click
// outside the dialog's own box, or a caller button calling close()) routes
// through the dialog's real close() so native focus restoration always
// runs; onClose only ever fires from the dialog's own 'close' event, never
// called directly, so there's exactly one path notifying the caller no
// matter how the dialog actually closed.
export function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  function close() {
    ref.current?.close();
  }

  function onBackdropClick(e: React.MouseEvent<HTMLDialogElement>) {
    const rect = ref.current!.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (!inside) close();
  }

  return { ref, close, onClose, onBackdropClick };
}
