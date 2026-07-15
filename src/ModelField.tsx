import { useState } from "react";
import { getStoredModel, KNOWN_MODELS, setStoredModel } from "./settingsStorage";

// replaces an earlier <datalist>-backed text input, which
// turned out to be broken in a way live testing (not just checking the DOM
// for the right <option> elements) caught — a native datalist filters its
// suggestions against the *current* input value, and since the field
// starts pre-filled with a complete, valid value ("claude-sonnet-5"), the
// browser filtered out every other option that doesn't match it, showing
// only the one already selected. A <select> doesn't have that problem —
// it always lists every option regardless of the current value — but a
// strict <select> alone would reintroduce the exact problem the datalist
// was chosen to avoid: providers/anthropic.ts forwards the model string to
// the API with zero validation, so a fixed option list would go stale the
// moment Anthropic ships a new model. "Other…" is the escape hatch: pick
// it and a plain text input appears for typing any model id, known or not.
export function ModelField() {
  const [model, setModel] = useState(getStoredModel());
  const [isCustom, setIsCustom] = useState(!KNOWN_MODELS.includes(getStoredModel()));

  return (
    <label className="modal-field">
      <span>Model</span>
      <select
        aria-label="Model"
        value={isCustom ? "custom" : model}
        onChange={(e) => {
          if (e.target.value === "custom") {
            setIsCustom(true);
          } else {
            setIsCustom(false);
            setModel(e.target.value);
            setStoredModel(e.target.value);
          }
        }}
      >
        {KNOWN_MODELS.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
        <option value="custom">Other…</option>
      </select>
      {isCustom && (
        <input
          type="text"
          aria-label="Custom model"
          placeholder="Model id"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setStoredModel(e.target.value);
          }}
        />
      )}
    </label>
  );
}
