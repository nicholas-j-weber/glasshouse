import { useState } from "react";

// Shared by SheetPanel (turn/summary rows), SuggestionSessionView
// (per-message suggestion blocks), and VersionHistory (per-version diff
// lists) — each keeps a per-item override for a collapse/expand toggle,
// falling back to a live global default (from settingsStorage) for
// anything the user hasn't explicitly touched. "Live" matters: flipping
// the global setting should visibly affect items already on screen, not
// just future ones, which is why the fallback is a function call at read
// time rather than a value captured once.
export function useCollapsedOverrides<T extends { id: string }>(getDefault: (item: T) => boolean) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  function isCollapsed(item: T): boolean {
    return overrides[item.id] ?? getDefault(item);
  }

  function toggle(item: T) {
    setOverrides((prev) => ({ ...prev, [item.id]: !isCollapsed(item) }));
  }

  return { isCollapsed, toggle };
}
