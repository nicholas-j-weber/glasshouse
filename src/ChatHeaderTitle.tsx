import { useEffect, useState } from "react";
import { renameSheet } from "./sheetsStore";

// The chat header's own rename affordance — a second entry
// point, kept deliberately alongside the Chats sidebar's pencil icon: the
// sidebar can rename any chat, this can only rename the one currently
// open, and it's the one that gets auto-focused right after a brand-new
// chat is created (autoEdit, driven by App.tsx tracking which sheetId that
// was), dropping the user straight into renaming it with the default name
// ("New chat") pre-selected, ready to be typed over.
export function ChatHeaderTitle({
  sheetId,
  name,
  autoEdit,
  onAutoEditHandled,
}: {
  sheetId: string;
  name: string;
  autoEdit: boolean;
  onAutoEditHandled: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  // Fires once when autoEdit turns on (App.tsx clears it right after via
  // onAutoEditHandled, so this doesn't retrigger on every render — deps
  // deliberately exclude name/onAutoEditHandled, only autoEdit's own
  // transition should start editing).
  useEffect(() => {
    if (!autoEdit) return;
    setDraft(name);
    setEditing(true);
    onAutoEditHandled();
  }, [autoEdit]);

  function commit() {
    const trimmed = draft.trim();
    if (trimmed) void renameSheet(sheetId, trimmed);
    setEditing(false);
  }

  function cancel() {
    setDraft(name);
    setEditing(false);
  }

  if (editing) {
    return (
      <form
        className="chat-header-title-form"
        onSubmit={(e) => {
          e.preventDefault();
          commit();
        }}
      >
        <input
          type="text"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
        />
      </form>
    );
  }

  return (
    <div className="chat-header-title-row">
      <h2 className="chat-header-title">{name}</h2>
      <button
        type="button"
        className="icon-button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        aria-label={`Rename ${name}`}
        title="Rename"
      >
        <span className="icon-emoji">📝</span>
      </button>
    </div>
  );
}
