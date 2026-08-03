import type { ContextSheetDB } from "./db";
import { db as defaultDb } from "./db";
import type { CodeVersion } from "./types";

// spec.md "Code-diff lane" — the same parent-linked-chain-plus-head-pointer
// pattern store.ts uses for Sheet versions, applied to code snapshots.
// Deliberately no ensureInitialized/skeleton equivalent: a Sheet always has
// a version, but a sheet has no CodeVersion at all until its first coding
// pass creates one (PersistedMessage.codeVersionId stays undefined for
// pure text-output passes) — "no code yet" is a real, valid state here,
// unlike Sheet's skeleton-on-first-read.

export async function getCodeHeadVersion(sheetId: string, db: ContextSheetDB = defaultDb): Promise<CodeVersion | undefined> {
  const headRecord = await db.codeHead.get(sheetId);
  if (!headRecord) return undefined;
  return db.codeVersions.get(headRecord.versionId);
}

// Creates a new code version as a child of the current code head (if any,
// else the chain's root) and advances codeHead to it — mirrors store.ts's
// createVersion. files is a full snapshot (spec.md: "path -> full content,
// snapshot not patch"), not a partial update over the parent's files.
export async function createCodeVersion(
  files: Record<string, string>,
  chatMessageId: string,
  sheetId: string,
  db: ContextSheetDB = defaultDb,
): Promise<CodeVersion> {
  const head = await getCodeHeadVersion(sheetId, db);
  const version: CodeVersion = {
    id: crypto.randomUUID(),
    sheetId,
    parentId: head?.id ?? null,
    createdAt: new Date().toISOString(),
    chatMessageId,
    files,
  };

  await db.codeVersions.add(version);
  await db.codeHead.put({ id: sheetId, versionId: version.id });
  return version;
}

// Moves codeHead back to versionId, undoing a createCodeVersion call —
// same "move the pointer, versions themselves are append-only" mechanic as
// store.ts's revertToVersion. versionId === null is the one case Sheet
// never has to handle: undoing a chain's very first CodeVersion has no
// prior version to point at, so codeHead is removed entirely, restoring
// "no code yet" rather than pointing at nothing.
export async function revertCodeHead(sheetId: string, versionId: string | null, db: ContextSheetDB = defaultDb): Promise<void> {
  if (versionId === null) {
    await db.codeHead.delete(sheetId);
  } else {
    await db.codeHead.put({ id: sheetId, versionId });
  }
}
