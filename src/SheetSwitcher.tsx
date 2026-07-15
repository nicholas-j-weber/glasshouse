import { useState } from "react";
import { createSheet, deleteSheet, renameSheet, switchSheet } from "./sheetsStore";
import type { SheetMeta } from "./types";

// Addendum S, 8.5: minimal chrome for create/switch/rename/delete. Sheets
// are listed in creation order (useSheets/listSheets already sort that
// way). Called "chats" in UI copy — familiar vocabulary for what's still,
// underneath, a Sheet container (SheetMeta/sheetId throughout the code and
// SPEC.md, unrenamed there — "chat" is already a distinct, existing concept
// in this codebase, the ChatPane/the "chat" call mode, so this is a
// display-label change only, not a rename of the underlying concept).
//
// "+ New chat" no longer asks for a name up front — it creates a chat
// named "New chat" immediately and reports the new id via onCreate, so
// App.tsx can auto-focus the chat header's own rename field (a second,
// deliberately-kept rename entry point — see ChatHeaderTitle) rather than
// making naming a precondition of creating a chat at all.
export function SheetSwitcher({
  sheets,
  activeSheetId,
  onCreate,
}: {
  sheets: SheetMeta[];
  activeSheetId: string;
  onCreate: (id: string) => void;
}) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  function handleCreate() {
    void createSheet("New chat").then(onCreate);
  }

  function startRename(sheet: SheetMeta) {
    setRenamingId(sheet.id);
    setRenameDraft(sheet.name);
  }

  function commitRename(id: string) {
    const trimmed = renameDraft.trim();
    if (trimmed) void renameSheet(id, trimmed);
    setRenamingId(null);
  }

  function handleDelete(sheet: SheetMeta) {
    // Addendum S, 8.5: genuinely irreversible — cascade-deletes the whole
    // version history and chat log for this sheet — confirm before acting.
    const confirmed = window.confirm(
      `Delete "${sheet.name}"? This permanently deletes its full history and chat log and cannot be undone.`,
    );
    if (confirmed) void deleteSheet(sheet.id);
  }

  return (
    <div className="sheet-switcher">
      <ul className="sheet-switcher-list">
        {sheets.map((sheet) => (
          <li
            key={sheet.id}
            className={`sheet-switcher-item${sheet.id === activeSheetId ? " sheet-switcher-item--active" : ""}`}
          >
            {renamingId === sheet.id ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  commitRename(sheet.id);
                }}
              >
                <input
                  type="text"
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(sheet.id)}
                />
              </form>
            ) : (
              <button type="button" className="sheet-switcher-name" onClick={() => switchSheet(sheet.id)}>
                {sheet.name}
              </button>
            )}
            <span className="sheet-switcher-actions">
              <button
                type="button"
                className="icon-button"
                onClick={() => startRename(sheet)}
                aria-label={`Rename ${sheet.name}`}
                title="Rename"
              >
                <span className="icon-emoji">📝</span>
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => handleDelete(sheet)}
                aria-label={`Delete ${sheet.name}`}
                title="Delete"
              >
                <span className="icon-emoji">🗑️</span>
              </button>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className="sheet-switcher-new" onClick={handleCreate}>
        + New chat
      </button>
    </div>
  );
}
