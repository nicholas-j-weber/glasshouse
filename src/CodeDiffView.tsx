import type { Change } from "diff";
import { useState } from "react";
import { diffCode, type FileDiff } from "./codeDiff";
import { db } from "./db";

// spec.md "Code-diff lane" — a coding pass's expandable diff view. Same
// lazy-disclosure pattern as ReasoningTrace.tsx: the version (and its
// parent, needed to diff against) aren't loaded from Dexie, and the diff
// itself isn't computed, until first expanded. Loaded once and cached in
// local state.
export function CodeDiffView({ versionId }: { versionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [diffs, setDiffs] = useState<FileDiff[] | null>(null);

  async function toggle() {
    if (!expanded && !diffs) {
      const version = await db.codeVersions.get(versionId);
      const parent = version?.parentId ? await db.codeVersions.get(version.parentId) : undefined;
      setDiffs(version ? diffCode(parent ?? null, version) : []);
    }
    setExpanded((prev) => !prev);
  }

  return (
    <div className="code-diff-view">
      <button type="button" className="chat-suggestions-toggle" onClick={() => void toggle()}>
        <span className={`chat-suggestions-caret${expanded ? " chat-suggestions-caret--flipped" : ""}`} aria-hidden="true">
          ⌃
        </span>
        {diffs ? `${diffs.length} file${diffs.length === 1 ? "" : "s"} changed` : "Code diff"}
      </button>
      {expanded && diffs && (
        <div className="code-diff-files">
          {diffs.length === 0 ? (
            <p className="code-diff-empty">No file changes.</p>
          ) : (
            diffs.map((file) => <CodeFileDiff key={file.path} file={file} />)
          )}
        </div>
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
