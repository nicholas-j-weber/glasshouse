import type { Change } from "diff";
import { useEffect, useState } from "react";
import { diffCode, type FileDiff } from "./codeDiff";
import { db } from "./db";

// spec.md "Code-diff lane" — a coding pass's diff data. Fetched fresh each
// time versionId changes (and reset to null when undefined) — PassTriage.tsx
// mounts this fresh per open rather than keeping it cached across opens, an
// acceptable tradeoff for a local IndexedDB read.
export function useCodeDiff(versionId: string | undefined): FileDiff[] | null {
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);

  useEffect(() => {
    if (!versionId) {
      setDiffs(null);
      return;
    }
    let cancelled = false;
    void db.codeVersions.get(versionId).then(async (version) => {
      const parent = version?.parentId ? await db.codeVersions.get(version.parentId) : undefined;
      if (!cancelled) setDiffs(version ? diffCode(parent ?? null, version) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [versionId]);

  return diffs;
}

// Pure renderer — the file-list body, same markup the old standalone toggle
// widget used, minus the toggle itself.
export function CodeDiffFiles({ diffs }: { diffs: FileDiff[] | null }) {
  if (!diffs) return null;
  return (
    <div className="code-diff-files">
      {diffs.length === 0 ? (
        <p className="code-diff-empty">No file changes.</p>
      ) : (
        diffs.map((file) => <CodeFileDiff key={file.path} file={file} />)
      )}
    </div>
  );
}

function CodeFileDiff({ file }: { file: FileDiff }) {
  return (
    <div className="code-diff-file">
      <div className="code-diff-file-header">
        <span className={`code-diff-file-status code-diff-file-status--${file.status}`}>{file.status}</span>
        <span className="code-diff-file-path">{file.path}</span>
      </div>
      <pre className="code-diff-file-body">
        {file.changes.flatMap((change, changeIndex) =>
          linesFor(change).map((line, lineIndex) => (
            <div
              key={`${changeIndex}-${lineIndex}`}
              className={`code-diff-line${change.added ? " code-diff-line--added" : change.removed ? " code-diff-line--removed" : ""}`}
            >
              {change.added ? "+" : change.removed ? "-" : " "}
              {line}
            </div>
          )),
        )}
      </pre>
    </div>
  );
}

// diffLines' Change.value can bundle several consecutive same-status lines
// into one block — split for per-line rendering, dropping the trailing
// empty string a trailing newline produces.
function linesFor(change: Change): string[] {
  const lines = change.value.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
