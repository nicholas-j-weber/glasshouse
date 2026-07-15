import { useRef, useState } from "react";
import { exportSheetWithGlobalPool, importSheetWithGlobalPool } from "./globalMemories";
import { parseSheetExport } from "./sheetExportValidation";
import { resetOverlay } from "./sheetOverlayStore";

// "Core PoC feature, not a stretch goal" — the full sheet, exportable
// and importable as a single JSON file, so a user can inspect their own
// context outside the app (legibility rationale). Also
// exports/imports the global memory pool alongside the local sheet, so the
// file reflects everything the model actually saw, not a partial view.
export function ExportImportControls({ sheetId }: { sheetId: string }) {
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    const data = await exportSheetWithGlobalPool(sheetId);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `context-chat-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      const parsed = parseSheetExport(JSON.parse(text));
      await importSheetWithGlobalPool(parsed, sheetId);
      // The old overlay may reference memory ids that no longer exist in
      // the freshly-imported chain — discard it, same as on revert.
      resetOverlay();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import file.");
    }
  }

  return (
    <div className="export-import">
      <div className="export-import-buttons">
        <button
          type="button"
          onClick={() => void handleExport()}
          title="Export the AI's current context — memories, tone, and conversation summary — as a file"
        >
          Export Context
        </button>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Import context — memories, tone, and conversation summary — from a file"
        >
          Import Context
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = ""; // allow re-importing the same filename later
          }}
        />
      </div>
      {error && <p className="export-import-error">{error}</p>}
    </div>
  );
}
