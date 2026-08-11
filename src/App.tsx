import { useEffect, useRef, useState } from "react";
import "./App.css";
import { ChatHeaderTitle } from "./ChatHeaderTitle";
import { ChatPane } from "./ChatPane";
import { ChatsSidebarContent } from "./ChatsSidebarContent";
import { ContextOverlay } from "./ContextOverlay";
import { HistoryModal } from "./HistoryModal";
import { LibraryModal } from "./LibraryModal";
import { MobileChatsOverlay } from "./MobileChatsOverlay";
import { SettingsModal } from "./SettingsModal";
import type { SheetPanelTab } from "./SheetPanel";
import { useEscapeKey } from "./useEscapeKey";
import { useSheets } from "./useSheets";
import { WelcomeModal } from "./WelcomeModal";

const NARROW_VIEWPORT_QUERY = "(max-width: 1023px)";

function App() {
  // multiple sheets can coexist locally; activeSheetId is
  // undefined only during the brief window before the first sheet exists.
  const { sheets, activeSheetId } = useSheets();
  // Chats sidebar: open by default per direct instruction — session-only
  // state, not persisted, so every fresh load starts fully expanded rather
  // than remembering a collapsed state from last time. Toggled via an
  // edge-anchored handle (IDE-style, e.g. VS Code's sidebar collapse
  // arrow) rather than a top-bar button — the handle itself is a sibling
  // of the collapsible aside, not nested inside it, so it stays reachable
  // even when its sidebar is hidden. Collapsed via a CSS class (not
  // conditional rendering) so the panel stays mounted and doesn't lose any
  // in-progress edits or refetch when toggled back open. Context used to
  // have the same treatment (detailsOpen/controls-sidebar) — it's a
  // button/overlay now instead (contextOpen below), same posture as
  // Library/History/Settings, so there's nothing left to collapse there.
  const [chatsOpen, setChatsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Knowledge/Skills, moved out of SheetPanel.tsx's tab row — global,
  // occasional/setup-time concerns, not per-chat ones like This Chat/
  // Memories, so they get their own header button rather than sharing
  // Context's tab row.
  const [libraryOpen, setLibraryOpen] = useState(false);
  // History — what happened to the sheet over time, a different kind of
  // thing from Context's "what's currently active" — gets its own header
  // button/modal too, rather than living inside Context's tab row.
  const [historyOpen, setHistoryOpen] = useState(false);
  // Context's own overlay, open at every viewport width now (previously
  // mobile-only — see mobileContextOpen's old comment in git history).
  const [contextOpen, setContextOpen] = useState(false);
  // Which tab the Context overlay shows — SheetPanel itself is the only
  // way to switch it once open, but this still needs to live here rather
  // than as local SheetPanel state, since it should persist across the
  // overlay's own close/reopen.
  const [detailsTab, setDetailsTab] = useState<SheetPanelTab>("chat");
  // Which sheet was just created via "+ New chat" — drives ChatHeaderTitle's
  // one-time auto-edit (drop straight into renaming a brand-new chat rather
  // than requiring a click). Cleared by ChatHeaderTitle itself right after
  // it consumes this, via onAutoEditHandled, so it doesn't retrigger.
  const [justCreatedSheetId, setJustCreatedSheetId] = useState<string | null>(null);
  // The AI-collaboration surface, a one-shot review panel (see
  // ManageWithAIPanel) triggered from the Context overlay. Rather than a
  // blocking modal, it temporarily occupies the Chats sidebar column in
  // place of SheetSwitcher, so the chat pane stays visible and interactive
  // the whole time — Back restores the normal chat list.
  const [manageAIOpen, setManageAIOpen] = useState(false);
  // set alongside manageAIOpen when something (currently only
  // the compression prompt) wants Manage with AI to open pre-filled with a
  // starting instruction, rather than the field's normal empty default —
  // still just a pre-fill, not auto-submitted, same "show before sending"
  // posture as Revise with AI's re-aimed field.
  const [manageAIPrefill, setManageAIPrefill] = useState<string | undefined>(undefined);
  // narrow-viewport (< 1024px, App.css) presentation of Chats as a
  // full-screen overlay rather than an always-visible sidebar. Default
  // false so a fresh mobile load shows the chat pane, not an overlay
  // covering it.
  const [mobileChatsOpen, setMobileChatsOpen] = useState(false);
  // Context/History/Library/Settings collapse into a single ☰ menu below
  // App.css's 1024px breakpoint — .header-menu-trigger is the only one of
  // the two visible at a given width (base rule hides it, the media query
  // flips it on and hides the plain button row instead), same "one thing
  // hidden by default, media query turns it on" shape as .mobile-nav-trigger.
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);

  useEscapeKey(() => setHeaderMenuOpen(false), headerMenuOpen);

  // Click-outside-to-close — the only floating (non-modal) panel in this
  // app, so the only place this is needed; every other dismissible surface
  // is either a native <dialog> (backdrop click handled by useDialog) or a
  // full-screen overlay (nothing "outside" to click). Listens on the
  // capture phase's bubble-complete 'click' rather than 'mousedown' so a
  // click on the trigger button itself (which toggles the menu in its own
  // onClick) isn't immediately re-closed by this handler seeing the same
  // click — both run on the same event, but the ref check below already
  // excludes clicks inside the trigger/menu regardless of order.
  useEffect(() => {
    if (!headerMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) {
        setHeaderMenuOpen(false);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [headerMenuOpen]);

  function openManageWithAI(prefill?: string) {
    setManageAIPrefill(prefill);
    setManageAIOpen(true);
  }

  // Mutually exclusive with Context on a narrow viewport — both render as
  // a full-screen .modal-overlay there (App.css's 1024px breakpoint), and
  // Context is reachable at every width now (unlike before, when it was
  // gated to the same breakpoint and this exclusion came for free), so it
  // needs an explicit close here rather than staying implicitly safe.
  function toggleMobileChats() {
    if (mobileChatsOpen) {
      setMobileChatsOpen(false);
    } else {
      setContextOpen(false);
      setMobileChatsOpen(true);
    }
  }

  function toggleContext() {
    if (contextOpen) {
      setContextOpen(false);
    } else {
      setMobileChatsOpen(false);
      setContextOpen(true);
    }
  }

  // Manage with AI only ever mounts inside ChatsSidebarContent (desktop
  // parity) — reachable from the Context overlay by closing Context and,
  // on a narrow viewport where the persistent Chats sidebar is itself
  // CSS-hidden (App.css's 1024px breakpoint), also opening the Chats
  // overlay so there's actually somewhere for it to render. A plain
  // matchMedia check here (not app-wide state) since this is a one-off
  // decision at click time, not something the UI needs to react to
  // continuously — Context's trigger is reachable at every width now
  // (unlike before, when this whole handoff was only ever reachable from
  // inside the already-mobile-only Context overlay to begin with).
  function openManageWithAIFromContext() {
    setContextOpen(false);
    if (window.matchMedia(NARROW_VIEWPORT_QUERY).matches) {
      setMobileChatsOpen(true);
    }
    openManageWithAI();
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-left">
          <button
            type="button"
            className="mobile-nav-trigger"
            onClick={toggleMobileChats}
            aria-pressed={mobileChatsOpen}
            aria-label={mobileChatsOpen ? "Close chats" : "Open chats"}
            title="Chats"
          >
            <span className="icon-emoji" aria-hidden="true">💬</span>
          </button>
          <div className="app-header-titles">
            <h1>
              Glasshouse<span className="app-header-title-full">: Browser Demo</span>
            </h1>
          </div>
        </div>
        <div className="header-icon-buttons" ref={headerMenuRef}>
          <button
            type="button"
            className="header-menu-trigger"
            onClick={() => setHeaderMenuOpen((open) => !open)}
            aria-expanded={headerMenuOpen}
            aria-label={headerMenuOpen ? "Close menu" : "Open menu"}
          >
            <span aria-hidden="true">☰</span>
          </button>
          <div className={`header-menu${headerMenuOpen ? " header-menu--open" : ""}`}>
            <button
              type="button"
              className="context-trigger"
              onClick={() => {
                toggleContext();
                setHeaderMenuOpen(false);
              }}
              disabled={!activeSheetId}
              aria-pressed={contextOpen}
              aria-label={contextOpen ? "Close context" : "Open context"}
            >
              Context
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setHistoryOpen(true);
                setHeaderMenuOpen(false);
              }}
              disabled={!activeSheetId}
              aria-label="History"
              title="History"
            >
              <span className="icon-emoji">🕐</span>
              <span className="header-menu-item-label">History</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setLibraryOpen(true);
                setHeaderMenuOpen(false);
              }}
              disabled={!activeSheetId}
              aria-label="Library"
              title="Library"
            >
              <span className="icon-emoji">📚</span>
              <span className="header-menu-item-label">Library</span>
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => {
                setSettingsOpen(true);
                setHeaderMenuOpen(false);
              }}
              aria-label="Settings"
              title="Settings"
            >
              <span className="icon-emoji">⚙️</span>
              <span className="header-menu-item-label">Settings</span>
            </button>
          </div>
        </div>
      </header>
      {activeSheetId ? (
        <div className="app-body">
          <aside aria-label="Chats" className={`chats-sidebar${chatsOpen ? "" : " chats-sidebar--collapsed"}`}>
            {!mobileChatsOpen && (
              <ChatsSidebarContent
                manageAIOpen={manageAIOpen}
                sheets={sheets}
                activeSheetId={activeSheetId}
                onCreate={setJustCreatedSheetId}
                manageAIPrefill={manageAIPrefill}
                onManageAIBack={() => setManageAIOpen(false)}
              />
            )}
          </aside>
          <button
            type="button"
            className="sidebar-handle chats-sidebar-handle"
            onClick={() => setChatsOpen((open) => !open)}
            aria-label={chatsOpen ? "Hide chats sidebar" : "Show chats sidebar"}
            title={chatsOpen ? "Hide chats" : "Show chats"}
          >
            {chatsOpen ? "‹" : "›"}
          </button>
          <main className="chat-column">
            <div className="chat-header">
              <ChatHeaderTitle
                sheetId={activeSheetId}
                name={sheets.find((s) => s.id === activeSheetId)?.name ?? ""}
                autoEdit={activeSheetId === justCreatedSheetId}
                onAutoEditHandled={() => setJustCreatedSheetId(null)}
              />
            </div>
            <ChatPane sheetId={activeSheetId} onOpenManageWithAI={openManageWithAI} />
          </main>
          {mobileChatsOpen && (
            <MobileChatsOverlay
              manageAIOpen={manageAIOpen}
              sheets={sheets}
              activeSheetId={activeSheetId}
              onCreate={setJustCreatedSheetId}
              manageAIPrefill={manageAIPrefill}
              onManageAIBack={() => setManageAIOpen(false)}
              onClose={() => setMobileChatsOpen(false)}
            />
          )}
          {contextOpen && (
            <ContextOverlay
              sheetId={activeSheetId}
              detailsTab={detailsTab}
              onTabChange={setDetailsTab}
              manageAIOpen={manageAIOpen}
              onToggleManageAI={openManageWithAIFromContext}
              onClose={() => setContextOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="app-body">Loading…</div>
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      {historyOpen && activeSheetId && <HistoryModal sheetId={activeSheetId} onClose={() => setHistoryOpen(false)} />}
      {libraryOpen && <LibraryModal onClose={() => setLibraryOpen(false)} />}
      <WelcomeModal />
    </div>
  );
}

export default App;
