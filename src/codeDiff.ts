import { diffLines, type Change } from "diff";
import type { CodeVersion } from "./types";

export interface FileDiff {
  path: string;
  status: "added" | "removed" | "modified";
  changes: Change[];
}

// spec.md "Code-diff lane" — computed on demand from two full-file
// snapshots, same "compute, don't store" note as versionDiff.ts's
// diffSheets, using the `diff` package's Myers diff (diffLines) rather than
// hand-rolling one. parent === null only for a chain's first version, where
// every file in `version` reads as "added". Files identical between parent
// and version are omitted entirely — same "only what changed" convention as
// `git diff`.
export function diffCode(parent: CodeVersion | null, version: CodeVersion): FileDiff[] {
  const parentFiles = parent?.files ?? {};
  const paths = new Set([...Object.keys(parentFiles), ...Object.keys(version.files)]);

  const diffs: FileDiff[] = [];
  for (const path of paths) {
    const before = parentFiles[path];
    const after = version.files[path];
    if (before === after) continue;

    if (before === undefined) {
      diffs.push({ path, status: "added", changes: diffLines("", after) });
    } else if (after === undefined) {
      diffs.push({ path, status: "removed", changes: diffLines(before, "") });
    } else {
      diffs.push({ path, status: "modified", changes: diffLines(before, after) });
    }
  }

  return diffs.sort((a, b) => a.path.localeCompare(b.path));
}
