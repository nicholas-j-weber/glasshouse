import { useState } from "react";
import "./App.css";
import { ChatHeaderTitle } from "./ChatHeaderTitle";
import { ChatPane } from "./ChatPane";
import { ChatsSidebarContent } from "./ChatsSidebarContent";
import { ContextSidebarContent } from "./ContextSidebarContent";
import { MobileChatsOverlay } from "./MobileChatsOverlay";
import { MobileContextOverlay } from "./MobileContextOverlay";
import { SettingsModal } from "./SettingsModal";
import { useSheets } from "./useSheets";
import { WelcomeModal } from "./WelcomeModal";

function App() {
  // Addendum S: multiple sheets can coexist locally; activeSheetId is
  // undefined only during the brief window before the first sheet exists.
  const { sheets, activeSheetId } = useSheets();
  // Chat-list and details (Tone/Memories/History/etc.) sidebars: both open
  // by default per direct instruction — session-only state, not persisted,
  // so every fresh load starts fully expanded rather than remembering a
  // collapsed state from last time. Toggled via an edge-anchored handle
  // (IDE-style, e.g. VS Code's sidebar collapse arrow) rather than a
  // top-bar button — the handle itself is a sibling of the collapsible
  // aside, not nested inside it, so it stays reachable even when its
  // sidebar is hidden. Collapsed via a CSS class (not conditional
  // rendering) so the panels stay mounted and don't lose any in-progress
  // edits or refetch when toggled back open.
  const [chatsOpen, setChatsOpen] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Which tab the details sidebar shows — the Memories tab itself
  // (SheetPanel) is the only way to switch it now that the header's brain
  // shortcut is gone, but this still needs to live here rather than as
  // local SheetPanel state, since App.tsx also needs to know it to
  // preserve tab selection across the sidebar's own hide/show toggle.
  const [detailsTab, setDetailsTab] = useState<"chat" | "memories" | "history">("chat");
  // Which sheet was just created via "+ New chat" — drives ChatHeaderTitle's
  // one-time auto-edit (drop straight into renaming a brand-new chat rather
  // than requiring a click). Cleared by ChatHeaderTitle itself right after
  // it consumes this, via onAutoEditHandled, so it doesn't retrigger.
  const [justCreatedSheetId, setJustCreatedSheetId] = useState<string | null>(null);
  // §6.3's AI-collaboration surface, now a one-shot review panel (see
  // ManageWithAIPanel) triggered from the Context panel header. Rather than
  // a blocking modal, it temporarily occupies the Chats sidebar column in
  // place of SheetSwitcher, so the chat pane and Context panel stay visible
  // and interactive the whole time — Back restores the normal chat list.
  const [manageAIOpen, setManageAIOpen] = useState(false);
  // Addendum AL: set alongside manageAIOpen when something (currently only
  // the Token Estimator's compression banner) wants Manage with AI to open
  // pre-filled with a starting instruction, rather than the field's normal
  // empty default — still just a pre-fill, not auto-submitted, same "show
  // before sending" posture as Revise with AI's re-aimed field.
  const [manageAIPrefill, setManageAIPrefill] = useState<string | undefined>(undefined);
  // Addendum BN: narrow-viewport (< 1024px, App.css) presentation of Chats
  // and Context as full-screen overlays rather than always-visible
  // sidebars. Default false (unlike chatsOpen/detailsOpen above) so a
  // fresh mobile load shows the chat pane, not an overlay covering it.
  // Mutually exclusive — toggleMobileChats/toggleMobileContext below each
  // close the other before opening themselves.
  const [mobileChatsOpen, setMobileChatsOpen] = useState(false);
  const [mobileContextOpen, setMobileContextOpen] = useState(false);

  function openManageWithAI(prefill?: string) {
    setManageAIPrefill(prefill);
    setManageAIOpen(true);
  }

  function toggleManageAI() {
    if (manageAIOpen) {
      setManageAIOpen(false);
    } else {
      openManageWithAI();
    }
  }

  function toggleMobileChats() {
    if (mobileChatsOpen) {
      setMobileChatsOpen(false);
    } else {
      setMobileContextOpen(false);
      setMobileChatsOpen(true);
    }
  }

  function toggleMobileContext() {
    if (mobileContextOpen) {
      setMobileContextOpen(false);
    } else {
      setMobileChatsOpen(false);
      setMobileContextOpen(true);
    }
  }

  // Addendum BN: "Manage with AI" tapped from inside the mobile Context
  // overlay hands off to the Chats overlay rather than rendering inline —
  // ManageWithAIPanel only ever mounts inside ChatsSidebarContent (desktop
  // parity), so this avoids a second mount path for it.
  function toggleManageAIFromMobileContext() {
    setMobileContextOpen(false);
    setMobileChatsOpen(true);
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
              ACM2<span className="app-header-title-full">: Browser Demo</span>
            </h1>
            <p className="app-header-subtitle">Auditable Context & Memory Methodology</p>
          </div>
        </div>
        <div className="header-icon-buttons">
          <button
            type="button"
            className="mobile-nav-trigger"
            onClick={toggleMobileContext}
            aria-pressed={mobileContextOpen}
            aria-label={mobileContextOpen ? "Close context" : "Open context"}
          >
            Context
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
            title="Settings"
          >
            <span className="icon-emoji">⚙️</span>
          </button>
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
            <ChatPane sheetId={activeSheetId} />
          </main>
          <button
            type="button"
            className="sidebar-handle controls-sidebar-handle"
            onClick={() => setDetailsOpen((open) => !open)}
            aria-label={detailsOpen ? "Hide details sidebar" : "Show details sidebar"}
            title={detailsOpen ? "Hide details" : "Show details"}
          >
            {detailsOpen ? "›" : "‹"}
          </button>
          <aside aria-label="Context" className={`controls-sidebar${detailsOpen ? "" : " controls-sidebar--collapsed"}`}>
            {!mobileContextOpen && (
              <ContextSidebarContent
                sheetId={activeSheetId}
                detailsTab={detailsTab}
                onTabChange={setDetailsTab}
                onOpenManageWithAI={openManageWithAI}
                manageAIOpen={manageAIOpen}
                onToggleManageAI={toggleManageAI}
              />
            )}
          </aside>
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
          {mobileContextOpen && (
            <MobileContextOverlay
              sheetId={activeSheetId}
              detailsTab={detailsTab}
              onTabChange={setDetailsTab}
              onOpenManageWithAI={openManageWithAI}
              manageAIOpen={manageAIOpen}
              onToggleManageAI={toggleManageAIFromMobileContext}
              onClose={() => setMobileContextOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="app-body">Loading…</div>
      )}
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      <WelcomeModal />
    </div>
  );
}

export default App;
