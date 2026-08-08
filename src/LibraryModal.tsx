import { useRef, useState } from "react";
import { GLOBAL_MEMORIES_SHEET_ID } from "./globalMemories";
import { MemoryRow } from "./MemoryRow";
import { orderMemoriesForDisplay } from "./serializer";
import { addKnowledgeMemory, deleteMemory, editMemory, setPinned } from "./sheetEdits";
import { applyOverlay } from "./sheetOverlay";
import { setOverlay as setSharedOverlay, resetOverlay } from "./sheetOverlayStore";
import { createVersion, ensureInitialized } from "./store";
import { useDialog } from "./useDialog";
import { useHeadVersion } from "./useHeadVersion";
import { useSheetOverlay } from "./useSheetOverlay";
import type { Memory, Sheet } from "./types";

type LibraryTab = "knowledge" | "skills";

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

  if (!globalHead) {
    return (
      <dialog className="modal modal--library" ref={dialog.ref} onClose={dialog.onClose} onClick={dialog.onBackdropClick} aria-labelledby="library-modal-title">
        <div className="modal-header">
          <h2 id="library-modal-title">Library</h2>
          <button type="button" className="modal-close" onClick={dialog.close} aria-label="Close library">
            ×
          </button>
        </div>
        <div className="modal-body">Loading…</div>
      </dialog>
    );
  }

  const sheet = applyOverlay(globalHead.sheet, overlay);

  async function commitGlobal(newSheet: Sheet) {
    await createVersion(newSheet, { kind: "manual_edit" }, GLOBAL_MEMORIES_SHEET_ID);
    resetOverlay();
  }

  async function withCurrentGlobalSheet(): Promise<Sheet> {
    const currentHead = await ensureInitialized(GLOBAL_MEMORIES_SHEET_ID);
    return applyOverlay(currentHead.sheet, overlay);
  }

  function handleToggleActive(memory: Memory) {
    setSharedOverlay((prev) => ({
      ...prev,
      activeOverrides: { ...prev.activeOverrides, [memory.id]: !memory.active },
    }));
  }

  async function handleTogglePin(memory: Memory) {
    const base = await withCurrentGlobalSheet();
    await commitGlobal(setPinned(base, memory.id, memory.pinRank === null));
  }

  async function handleDelete(memory: Memory) {
    const base = await withCurrentGlobalSheet();
    await commitGlobal(deleteMemory(base, memory.id));
  }

  async function handleEditMemory(memory: Memory, label: string, body: string) {
    const base = await withCurrentGlobalSheet();
    await commitGlobal(editMemory(base, memory.id, label, body, new Date().toISOString()));
  }

  // spec.md "Knowledge & Skills" — "an uploaded file becomes a Memory...
  // landing as a new global-chain version directly — no accept/reject, same
  // as whole-sheet import today." No overlay, no pending review: commits
  // immediately.
  async function handleUploadKnowledge(kind: "knowledge" | "skill", filename: string, content: string) {
    const base = await withCurrentGlobalSheet();
    await commitGlobal(addKnowledgeMemory(base, kind, filename, content, new Date().toISOString()));
  }

  // Bulk-toggles every entry sharing one moduleId at once (spec.md
  // "Modules") — same session-only overlay mechanism handleToggleActive
  // uses for a single memory, written for every id in the module.
  function handleToggleModuleActive(entries: Memory[]) {
    const nextActive = !entries.every((m) => m.active);
    setSharedOverlay((prev) => {
      const activeOverrides = { ...prev.activeOverrides };
      for (const entry of entries) activeOverrides[entry.id] = nextActive;
      return { ...prev, activeOverrides };
    });
  }

  // One kind per tab now (Knowledge vs. Skills), rather than one merged
  // "Knowledge" list with a per-entry kind picker — the tab itself already
  // says which kind you're looking at, so uploads within a tab are fixed to
  // that kind (see UploadKnowledgeForm's kind prop below).
  const librarySearchQuery = librarySearch.trim().toLowerCase();
  function modulesForKind(kind: "knowledge" | "skill") {
    const entries = orderMemoriesForDisplay(sheet.memories.filter((m) => m.kind === kind)).filter(
      (m) =>
        librarySearchQuery.length === 0 ||
        m.label.toLowerCase().includes(librarySearchQuery) ||
        m.body.toLowerCase().includes(librarySearchQuery),
    );
    // Grouped by moduleId (spec.md "Modules").
    const groups = new Map<string, Memory[]>();
    for (const memory of entries) {
      const key = memory.moduleId ?? memory.id;
      groups.set(key, [...(groups.get(key) ?? []), memory]);
    }
    return [...groups.entries()].map(([moduleId, moduleEntries]) => ({ moduleId, entries: moduleEntries }));
  }
  const knowledgeModules = modulesForKind("knowledge");
  const skillModules = modulesForKind("skill");

  return (
    <dialog className="modal modal--library" ref={dialog.ref} onClose={dialog.onClose} onClick={dialog.onBackdropClick} aria-labelledby="library-modal-title">
      <div className="modal-header">
        <h2 id="library-modal-title">Library</h2>
        <button type="button" className="modal-close" onClick={dialog.close} aria-label="Close library">
          ×
        </button>
      </div>

      <div className="sheet-panel-tabs">
        <button
          type="button"
          className={`sheet-panel-tab${activeTab === "knowledge" ? " sheet-panel-tab--active" : ""}`}
          onClick={() => setActiveTab("knowledge")}
        >
          Knowledge
        </button>
        <button
          type="button"
          className={`sheet-panel-tab${activeTab === "skills" ? " sheet-panel-tab--active" : ""}`}
          onClick={() => setActiveTab("skills")}
        >
          Skills
        </button>
      </div>

      <div className="modal-body">
        <div className={`sheet-panel-tab-content${activeTab === "knowledge" ? "" : " sheet-panel-tab-content--hidden"}`}>
          <section className="sheet-section">
            <p className="sheet-section-caption">
              Reference material — facts and documentation the AI should be able to draw on, not step-by-step
              instructions (see Skills). Import by uploading a .txt/.md file: its content becomes plain,
              inspectable text right in the entry — not an opaque index or embedding — landing immediately, no
              review step.
            </p>
            <div className="inline-field">
              <input
                type="search"
                className="inline-field-input"
                aria-label="Search knowledge"
                placeholder="Search label or body…"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
              />
            </div>
            <ul className="memory-list">
              {knowledgeModules.map(({ moduleId, entries }) => (
                <KnowledgeModule
                  key={moduleId}
                  moduleId={moduleId}
                  entries={entries}
                  onToggleModuleActive={() => handleToggleModuleActive(entries)}
                  onToggleActive={(memory) => handleToggleActive(memory)}
                  onTogglePin={(memory) => handleTogglePin(memory)}
                  onDelete={(memory) => handleDelete(memory)}
                  onEdit={(memory, label, body) => handleEditMemory(memory, label, body)}
                />
              ))}
            </ul>
            <UploadKnowledgeForm kind="knowledge" onUpload={handleUploadKnowledge} />
          </section>
        </div>

        <div className={`sheet-panel-tab-content${activeTab === "skills" ? "" : " sheet-panel-tab-content--hidden"}`}>
          <section className="sheet-section">
            <p className="sheet-section-caption">
              Step-by-step procedures — ordered or branching instructions for how to do something, not reference
              facts (see Knowledge). Import by uploading a .txt/.md file: its content becomes plain, inspectable
              text right in the entry — not an opaque index or embedding — landing immediately, no review step.
            </p>
            <div className="inline-field">
              <input
                type="search"
                className="inline-field-input"
                aria-label="Search skills"
                placeholder="Search label or body…"
                value={librarySearch}
                onChange={(e) => setLibrarySearch(e.target.value)}
              />
            </div>
            <ul className="memory-list">
              {skillModules.map(({ moduleId, entries }) => (
                <KnowledgeModule
                  key={moduleId}
                  moduleId={moduleId}
                  entries={entries}
                  onToggleModuleActive={() => handleToggleModuleActive(entries)}
                  onToggleActive={(memory) => handleToggleActive(memory)}
                  onTogglePin={(memory) => handleTogglePin(memory)}
                  onDelete={(memory) => handleDelete(memory)}
                  onEdit={(memory, label, body) => handleEditMemory(memory, label, body)}
                />
              ))}
            </ul>
            <UploadKnowledgeForm kind="skill" onUpload={handleUploadKnowledge} />
          </section>
        </div>
      </div>
    </dialog>
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
