import { useState } from "react";
import type { Memory } from "./types";

// Shared by SheetPanel.tsx's Memories tab and LibraryModal.tsx's Knowledge
// tab (via KnowledgeModule) — one row shape for every memory kind,
// badge-distinguished for knowledge/skill (spec.md "Knowledge & Skills" —
// "skill and knowledge entries render together in one list, badge-
// distinguished"). Absent for an ordinary memory (kind undefined).
export function MemoryRow({
  memory,
  onToggleActive,
  onTogglePin,
  onDelete,
  onEdit,
}: {
  memory: Memory;
  onToggleActive: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onEdit: (label: string, body: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(memory.label);
  const [bodyDraft, setBodyDraft] = useState(memory.body);

  // Keep the edit form's draft in sync with the memory's current content
  // whenever we're not actively editing — otherwise reopening "Edit" after
  // the memory changed elsewhere (e.g. an accepted edit_memory suggestion)
  // would show stale text typed into a much earlier mount.
  if (!editing && (labelDraft !== memory.label || bodyDraft !== memory.body)) {
    setLabelDraft(memory.label);
    setBodyDraft(memory.body);
  }

  if (editing) {
    return (
      <li className="memory-row memory-row--editing">
        <input type="text" aria-label="Memory label" value={labelDraft} onChange={(e) => setLabelDraft(e.target.value)} />
        <textarea aria-label="Memory body" value={bodyDraft} onChange={(e) => setBodyDraft(e.target.value)} rows={2} />
        <div className="memory-row-actions">
          <button
            type="button"
            onClick={() => {
              onEdit(labelDraft, bodyDraft);
              setEditing(false);
            }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setLabelDraft(memory.label);
              setBodyDraft(memory.body);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li className={`memory-row${memory.active ? "" : " memory-row--inactive"}`}>
      <div className="memory-row-main">
        <div className="memory-row-title-row">
          {(memory.kind === "knowledge" || memory.kind === "skill") && (
            <span className={`memory-kind-badge memory-kind-badge--${memory.kind}`}>
              {memory.kind === "knowledge" ? "Knowledge" : "Skill"}
            </span>
          )}
          <strong>{memory.label}</strong>
        </div>
        <span>{memory.body}</span>
      </div>
      <div className="memory-row-actions">
        <label className="memory-toggle">
          <input type="checkbox" checked={memory.active} onChange={onToggleActive} />
          active
        </label>
        <button
          type="button"
          className={`icon-button${memory.pinRank !== null ? " icon-button--active" : ""}`}
          onClick={onTogglePin}
          aria-label={memory.pinRank === null ? "Pin" : "Unpin"}
          title={memory.pinRank === null ? "Pin" : "Unpin"}
        >
          <span className="icon-emoji">📌</span>
        </button>
        <button type="button" className="icon-button" onClick={() => setEditing(true)} aria-label="Edit" title="Edit">
          <span className="icon-emoji">📝</span>
        </button>
        <button type="button" className="icon-button" onClick={onDelete} aria-label="Delete" title="Delete">
          <span className="icon-emoji">🗑️</span>
        </button>
      </div>
    </li>
  );
}
