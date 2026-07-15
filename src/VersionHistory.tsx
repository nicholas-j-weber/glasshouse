import { useState } from "react";
import { getStoredCollapseHistoryByDefault } from "./settingsStorage";
import { resetOverlay } from "./sheetOverlayStore";
import { revertToVersion } from "./store";
import { useActiveLineage } from "./useActiveLineage";
import { diffSheets } from "./versionDiff";
import type { Version, VersionAttribution } from "./types";

function formatAttribution(attribution: VersionAttribution): string {
  switch (attribution.kind) {
    case "manual_edit":
      return "Manual edit";
    case "ai_suggestion_accepted":
      return "AI suggestion accepted";
    case "ai_suggestion_auto_applied":
      // Addendum Z: chat mode auto-applies suggestions (toast + undo,
      // rather than a manual Accept click) — History should say so, not
      // imply every version came from a click.
      return "AI suggestion auto-applied";
    case "sheet_editor_session":
      // Attribution kind predates the "Manage with AI" rename (was "Sheet
      // Editor") — the internal kind string stays as-is (a stored value,
      // not user-facing), but the label shown here should match the
      // feature's current name.
      return "Manage with AI session";
  }
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

// §4.4: linear undo — "Revert to version N" moves head back; nothing is
// deleted. §1.1's core claim ("the full history of what the AI has known...
// is reconstructable, inspectable, and reversible") is what this makes true
// in the UI rather than just in the store.
export function VersionHistory({ sheetId }: { sheetId: string }) {
  const lineage = useActiveLineage(sheetId); // oldest first, head last
  // Addendum AR: per-version override for the diff-line list's collapse
  // state — versionId -> explicit collapsed state, same live-default-
  // fallback pattern as Addendum AC's collapsedOverrides and SheetPanel's
  // collapsedRowOverrides (Addendum AR): flipping the setting should
  // visibly affect entries already on screen, not just future ones.
  const [collapsedOverrides, setCollapsedOverrides] = useState<Record<string, boolean>>({});

  function isVersionCollapsed(versionId: string): boolean {
    return collapsedOverrides[versionId] ?? getStoredCollapseHistoryByDefault();
  }

  function toggleVersionCollapsed(versionId: string) {
    setCollapsedOverrides((prev) => ({ ...prev, [versionId]: !isVersionCollapsed(versionId) }));
  }

  async function handleRevert(versionId: string) {
    await revertToVersion(versionId, sheetId);
    // Addendum A 4.2.1: pending overlay is discarded on revert, not carried back.
    resetOverlay();
  }

  const entries = lineage.map((version, index) => ({
    version,
    diffLines: diffSheets(index > 0 ? lineage[index - 1].sheet : null, version.sheet),
  }));
  const newestFirst = [...entries].reverse();
  const headId = lineage[lineage.length - 1]?.id;

  return (
    <div className="version-history">
      <ul className="version-list">
        {newestFirst.map(({ version, diffLines }: { version: Version; diffLines: ReturnType<typeof diffSheets> }) => {
          const isHead = version.id === headId;
          return (
            <li key={version.id} className={`version-row${isHead ? " version-row--head" : ""}`}>
              <div className="version-row-meta">
                <span>{formatTimestamp(version.createdAt)}</span>
                <span>{formatAttribution(version.attribution)}</span>
                {isHead && <span className="version-current-badge">current</span>}
              </div>
              <button
                type="button"
                className="version-diff-toggle"
                onClick={() => toggleVersionCollapsed(version.id)}
              >
                <span
                  className={`version-diff-caret${isVersionCollapsed(version.id) ? "" : " version-diff-caret--flipped"}`}
                  aria-hidden="true"
                >
                  ⌃
                </span>
                {diffLines.length} change{diffLines.length === 1 ? "" : "s"}
              </button>
              {!isVersionCollapsed(version.id) && (
                <ul className="version-diff">
                  {diffLines.map((line, i) => (
                    <li key={i}>
                      <strong>{line.status}</strong>
                      {line.detail && `: ${line.detail}`}
                    </li>
                  ))}
                </ul>
              )}
              {!isHead && (
                <button type="button" onClick={() => handleRevert(version.id)}>
                  Revert to here
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
