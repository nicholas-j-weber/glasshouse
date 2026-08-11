import { useRef, useState, type ReactNode } from "react";
import { GLOBAL_MEMORIES_SHEET_ID } from "./globalMemories";
import { MemoryRow } from "./MemoryRow";
import { orderMemoriesForDisplay } from "./serializer";
import { editChain, toggleMemoryActive } from "./chainEdits";
import { addKnowledgeMemory, deleteMemory, editMemory, setPinned } from "./sheetEdits";
import { applyOverlay } from "./sheetOverlay";
import { setOverlay as setSharedOverlay } from "./sheetOverlayStore";
import { useDialog } from "./useDialog";
import { useHeadVersion } from "./useHeadVersion";
import { useSheetOverlay } from "./useSheetOverlay";
import type { Memory, Sheet } from "./types";

// The two tabs differ only in which Memory.kind they list and the prose
// describing it — everything else (search box, module list, upload form) is
// identical, so they're driven off this table rather than written out twice.
const LIBRARY_TABS = [
  {
    id: "knowledge",
    kind: "knowledge",
    label: "Knowledge",
    caption:
      "Reference material — facts and documentation the AI should be able to draw on, not step-by-step instructions (see Skills). Import by uploading a .txt/.md file: its content becomes plain, inspectable text right in the entry — not an opaque index or embedding — landing immediately, no review step.",
  },
  {
    id: "skills",
    kind: "skill",
    label: "Skills",
    caption:
      "Step-by-step procedures — ordered or branching instructions for how to do something, not reference facts (see Knowledge). Import by uploading a .txt/.md file: its content becomes plain, inspectable text right in the entry — not an opaque index or embedding — landing immediately, no review step.",
  },
] as const;

type LibraryTab = (typeof LIBRARY_TABS)[number]["id"];

// Knowledge/Skills, moved out of SheetPanel.tsx's tab row into their own
// modal (spec.md "Knowledge & Skills") — occasional/setup-time concerns,
// unlike This Chat/Memories/History which stay in the always-visible
// sidebar. Knowledge/skill entries are global-pool only (never local-chain,
// unlike ordinary memories) — mergeMemoryPools restricts local-chain
// memories to conversation_turn/summary, so this only ever needs the global
// head, not a merge of two chains like SheetPanel does. Not sheet-scoped at
// all, unlike History (which stayed in SheetPanel since it's per-chat) —
// so this modal takes no sheetId.
export function LibraryModal({ onClose }: { onClose: () => void }) {
  const dialog = useDialog(onClose);
  const globalHead = useHeadVersion(GLOBAL_MEMORIES_SHEET_ID);
  const overlay = useSheetOverlay();
  const [activeTab, setActiveTab] = useState<LibraryTab>("knowledge");
  // Knowledge/skill entries are global-pool, not sheet-scoped — the same
  // search term staying live across a sheet switch is correct here, not
  // stale state (mirrors SheetPanel's own knowledgeSearch, moved here).
  // Shared across both tabs — each tab filters its own kind by this text.
  const [librarySearch, setLibrarySearch] = useState("");

  // The <dialog> element itself has to render even while loading — useDialog's
  // showModal() effect needs something to call on mount — so the shell is
  // written once here and both states fill in its body.
  function shell(body: ReactNode) {
    return (
      <dialog className="modal modal--library" ref={dialog.ref} onClose={dialog.onClose} onClick={dialog.onBackdropClick} aria-labelledby="library-modal-title">
        <div className="modal-header">
          <h2 id="library-modal-title">Library</h2>
          <button type="button" className="modal-close" onClick={dialog.close} aria-label="Close library">
            ×
          </button>
        </div>
        {body}
      </dialog>
    );
  }

  if (!globalHead) return shell(<div className="modal-body">Loading…</div>);

  const sheet = applyOverlay(globalHead.sheet, overlay);

  // Every write here targets the global chain — knowledge/skill entries only
  // ever live there (mergeMemoryPools restricts the local chain to
  // conversation turns and summaries), so unlike SheetPanel there's no
  // per-memory routing to do.
  const editGlobal = (edit: (sheet: Sheet) => Sheet) => editChain(GLOBAL_MEMORIES_SHEET_ID, overlay, edit);

  const handleTogglePin = (memory: Memory) => editGlobal((s) => setPinned(s, memory.id, memory.pinRank === null));
  const handleDelete = (memory: Memory) => editGlobal((s) => deleteMemory(s, memory.id));
  const handleEditMemory = (memory: Memory, label: string, body: string) =>
    editGlobal((s) => editMemory(s, memory.id, label, body, new Date().toISOString()));

  // spec.md "Knowledge & Skills" — "an uploaded file becomes a Memory...
  // landing as a new global-chain version directly — no accept/reject, same
  // as whole-sheet import today." No overlay, no pending review: commits
  // immediately.
  const handleUploadKnowledge = (kind: "knowledge" | "skill", filename: string, content: string) =>
    editGlobal((s) => addKnowledgeMemory(s, kind, filename, content, new Date().toISOString()));

  // Bulk-toggles every entry sharing one moduleId at once (spec.md
  // "Modules") — same session-only overlay mechanism toggleMemoryActive
  // uses for a single memory, written for every id in the module.
  function handleToggleModuleActive(entries: Memory[]) {
    const nextActive = !entries.every((m) => m.active);
    setSharedOverlay((prev) => {
      const activeOverrides = { ...prev.activeOverrides };
      for (const entry of entries) activeOverrides[entry.id] = nextActive;
      return { ...prev, activeOverrides };
    });
  }

  // Grouped by moduleId (spec.md "Modules"). Uploads within a tab are fixed
  // to that tab's kind — the tab itself is already the explicit choice, so
  // there's no per-entry kind picker.
  const librarySearchQuery = librarySearch.trim().toLowerCase();
  function modulesForKind(kind: "knowledge" | "skill") {
    const entries = orderMemoriesForDisplay(sheet.memories.filter((m) => m.kind === kind)).filter(
      (m) =>
        librarySearchQuery.length === 0 ||
        m.label.toLowerCase().includes(librarySearchQuery) ||
        m.body.toLowerCase().includes(librarySearchQuery),
    );
    const groups = new Map<string, Memory[]>();
    for (const memory of entries) {
      const key = memory.moduleId ?? memory.id;
      groups.set(key, [...(groups.get(key) ?? []), memory]);
    }
    return [...groups.entries()].map(([moduleId, moduleEntries]) => ({ moduleId, entries: moduleEntries }));
  }

  return shell(
    <>
      <div className="sheet-panel-tabs">
        {LIBRARY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`sheet-panel-tab${activeTab === tab.id ? " sheet-panel-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="modal-body">
        {/* Both tabs stay mounted (CSS-hidden, not conditionally rendered),
            same reason SheetPanel does it: switching tabs must never discard
            an in-progress edit. */}
        {LIBRARY_TABS.map((tab) => (
          <div
            key={tab.id}
            className={`sheet-panel-tab-content${activeTab === tab.id ? "" : " sheet-panel-tab-content--hidden"}`}
          >
            <section className="sheet-section">
              <p className="sheet-section-caption">{tab.caption}</p>
              <div className="inline-field">
                <input
                  type="search"
                  className="inline-field-input"
                  aria-label={`Search ${tab.label.toLowerCase()}`}
                  placeholder="Search label or body…"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                />
              </div>
              <ul className="memory-list">
                {modulesForKind(tab.kind).map(({ moduleId, entries }) => (
                  <KnowledgeModule
                    key={moduleId}
                    moduleId={moduleId}
                    entries={entries}
                    onToggleModuleActive={() => handleToggleModuleActive(entries)}
                    onToggleActive={toggleMemoryActive}
                    onTogglePin={handleTogglePin}
                    onDelete={handleDelete}
                    onEdit={handleEditMemory}
                  />
                ))}
              </ul>
              <UploadKnowledgeForm kind={tab.kind} onUpload={handleUploadKnowledge} />
            </section>
          </div>
        ))}
      </div>
    </>,
  );
}

// spec.md "Modules" — one uploaded file's entries (in v1, always exactly
// one — addKnowledgeMemory never splits a file), grouped under a header
// with a bulk active checkbox. Entries themselves are still plain
// MemoryRows (individually toggleable/editable/deletable too) — the module
// header adds a coarser control on top, it doesn't replace the per-entry one.
function KnowledgeModule({
  moduleId,
  entries,
  onToggleModuleActive,
  onToggleActive,
  onTogglePin,
  onDelete,
  onEdit,
}: {
  moduleId: string;
  entries: Memory[];
  onToggleModuleActive: () => void;
  onToggleActive: (memory: Memory) => void;
  onTogglePin: (memory: Memory) => void;
  onDelete: (memory: Memory) => void;
  onEdit: (memory: Memory, label: string, body: string) => void;
}) {
  const allActive = entries.every((m) => m.active);

  return (
    <li className="knowledge-module">
      <div className="knowledge-module-header">
        <label className="memory-toggle">
          <input type="checkbox" checked={allActive} onChange={onToggleModuleActive} />
          {moduleId}
        </label>
        <span className="knowledge-module-count">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"}
        </span>
      </div>
      <ul className="memory-list knowledge-module-entries">
        {entries.map((memory) => (
          <MemoryRow
            key={memory.id}
            memory={memory}
            onToggleActive={() => onToggleActive(memory)}
            onTogglePin={() => onTogglePin(memory)}
            onDelete={() => onDelete(memory)}
            onEdit={(label, body) => onEdit(memory, label, body)}
          />
        ))}
      </ul>
    </li>
  );
}

// spec.md "Acceptance: file upload, not chat suggestions" — same hidden-
// input-triggered-by-a-visible-button pattern as ExportImportControls'
// Import Context. Kind is fixed by which tab this form renders in (no
// picker needed anymore — the Knowledge/Skills tabs themselves are the
// explicit choice, same "toggle, not heuristic" posture as
// routingMode/contentMode elsewhere). Uploading commits immediately (no
// pending/preview state); the only local state here is the in-flight/error
// UI around that.
function UploadKnowledgeForm({
  kind,
  onUpload,
}: {
  kind: "knowledge" | "skill";
  onUpload: (kind: "knowledge" | "skill", filename: string, content: string) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const content = await file.text();
      await onUpload(kind, file.name, content);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="knowledge-upload-form">
      <button
        type="button"
        className="knowledge-upload-button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? "Uploading…" : "Upload file"}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // allow re-uploading the same filename later
          if (file) void handleFile(file);
        }}
      />
      {error && <p className="export-import-error">{error}</p>}
    </div>
  );
}
