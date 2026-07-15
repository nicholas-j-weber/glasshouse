import { useEffect, useState } from "react";
import { ModelField } from "./ModelField";
import { useModalFocus } from "./useModalFocus";
import {
  getStoredApiKey,
  getStoredAutoApply,
  getStoredCollapseHistoryByDefault,
  getStoredCollapseSuggestionsByDefault,
  getStoredCollapseTurnsByDefault,
  getStoredRecommendCompression,
  setStoredApiKey,
  setStoredAutoApply,
  setStoredCollapseHistoryByDefault,
  setStoredCollapseSuggestionsByDefault,
  setStoredCollapseTurnsByDefault,
  setStoredRecommendCompression,
} from "./settingsStorage";

// §9.2: API key/model config, moved out of the always-visible header into a
// modal — "set once, rarely revisit" config, unlike the chat/context panels
// which are used constantly (a deliberately different treatment from the
// chats/details sidebars, which stay visible-by-default). This is also
// where later settings land — Addendum AA's auto-apply toggle, Addendum
// AC's collapse-by-default toggle, Addendum AL's compression-recommendation
// toggle, and Addendum AR's This Chat/History collapse-by-default toggles.
export function SettingsModal({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState(getStoredApiKey());
  const [autoApply, setAutoApply] = useState(getStoredAutoApply());
  const [collapseSuggestions, setCollapseSuggestions] = useState(getStoredCollapseSuggestionsByDefault());
  const [recommendCompression, setRecommendCompression] = useState(getStoredRecommendCompression());
  const [collapseTurns, setCollapseTurns] = useState(getStoredCollapseTurnsByDefault());
  const [collapseHistory, setCollapseHistory] = useState(getStoredCollapseHistoryByDefault());
  const panelRef = useModalFocus<HTMLDivElement>(true);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal"
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="settings-modal-title">Settings</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="modal-field-row">
            <label className="modal-field">
              <span>Anthropic API key</span>
              <input
                type="password"
                aria-label="Anthropic API key"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setStoredApiKey(e.target.value);
                }}
              />
            </label>
            <ModelField />
          </div>
          <label className="modal-field modal-field--checkbox">
            <input
              type="checkbox"
              aria-label="Auto-apply context updates while chatting"
              checked={autoApply}
              onChange={(e) => {
                setAutoApply(e.target.checked);
                setStoredAutoApply(e.target.checked);
              }}
            />
            <span>Auto-apply context updates while chatting</span>
          </label>
          <p className="modal-field-hint">
            {autoApply
              ? "On (default): context updates apply immediately as you chat."
              : "Off: context updates wait for manual Accept/Reject/Revise"}
          </p>
          <label className="modal-field modal-field--checkbox">
            <input
              type="checkbox"
              aria-label="Collapse suggestion details by default"
              checked={collapseSuggestions}
              onChange={(e) => {
                setCollapseSuggestions(e.target.checked);
                setStoredCollapseSuggestionsByDefault(e.target.checked);
              }}
            />
            <span>Collapse suggestion details by default</span>
          </label>
          <p className="modal-field-hint">
            {collapseSuggestions
              ? "On: each message's conversation/memory changes start collapsed to a summary — click to expand."
              : "Off (default): changes show in full. Any message can still be collapsed on its own."}
          </p>
          <label className="modal-field modal-field--checkbox">
            <input
              type="checkbox"
              aria-label="Recommend compression when context grows large"
              checked={recommendCompression}
              onChange={(e) => {
                setRecommendCompression(e.target.checked);
                setStoredRecommendCompression(e.target.checked);
              }}
            />
            <span>Recommend compression when context grows large</span>
          </label>
          <p className="modal-field-hint">
            {recommendCompression
              ? "On (default): a banner appears next to Context size once it grows large, offering to compress older turns and prune stale memories."
              : "Off: no banner — nothing changes on its own."}
          </p>
          <label className="modal-field modal-field--checkbox">
            <input
              type="checkbox"
              aria-label="Collapse conversation turns and summaries by default"
              checked={collapseTurns}
              onChange={(e) => {
                setCollapseTurns(e.target.checked);
                setStoredCollapseTurnsByDefault(e.target.checked);
              }}
            />
            <span>Collapse conversation turns and summaries by default</span>
          </label>
          <p className="modal-field-hint">
            {collapseTurns
              ? "On: This Chat's turns and summaries start collapsed to one line — click any row to expand it."
              : "Off (default): turns and summaries show in full. Any row can still be collapsed on its own."}
          </p>
          <label className="modal-field modal-field--checkbox">
            <input
              type="checkbox"
              aria-label="Collapse History entries by default"
              checked={collapseHistory}
              onChange={(e) => {
                setCollapseHistory(e.target.checked);
                setStoredCollapseHistoryByDefault(e.target.checked);
              }}
            />
            <span>Collapse History entries by default</span>
          </label>
          <p className="modal-field-hint">
            {collapseHistory
              ? "On: each History entry's change list starts collapsed to a count — click to expand."
              : "Off (default): changes show in full. Any entry can still be collapsed on its own."}
          </p>
        </div>
      </div>
    </div>
  );
}
